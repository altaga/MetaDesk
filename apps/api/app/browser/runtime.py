"""Living Chromium sessions for the desk, run on one dedicated thread.

The desk drives a real browser on the board: it opens pages, clicks and types,
and turns what it sees into screenshots under ``.desk/browser``. A single warm
session is reused across views so the first look is not a cold launch.

``playwright.sync_api`` binds greenlets to the thread that created them, so
every call is funnelled through :func:`_on_worker` and the async routes only
await a queue round-trip.
"""

from __future__ import annotations

import base64
import logging
import queue
import threading
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, TypeVar

from ..edge.files import fs_root, resolve_path

log = logging.getLogger(__name__)

#: Where screenshots and demo recordings land, relative to the desk root.
ARTIFACTS_REL = ".desk/browser"

T = TypeVar("T")

#: The worker thread and its job queue. ``sync_playwright`` must stay here.
_JOBS: "queue.Queue" = queue.Queue()
_WORKER: threading.Thread | None = None
_WORKER_LOCK = threading.Lock()

#: Actions that answer inside a couple of seconds; anything else may be slow.
_QUICK_ACTIONS = frozenset({"preview", "warm", "interact"})

#: Viewport bounds shared by the preview and the demo recorder.
VIEW_MIN, VIEW_MAX = 240, 1920

#: Keys the Live preview is allowed to press (keeps the desk from typing into
#: browser chrome or firing accelerators it did not intend).
PRESSABLE_KEYS = frozenset(
    {
        "Enter", "Backspace", "Tab", "Escape", "Delete", "Home", "End",
        "PageUp", "PageDown", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space",
    }
)


def _worker_loop() -> None:
    while True:
        item = _JOBS.get()
        if item is None:
            return
        fn, args, kwargs, out = item
        try:
            out.put(("ok", fn(*args, **kwargs)))
        except BaseException as exc:  # noqa: BLE001 - the caller re-raises
            out.put(("err", exc))


def _ensure_worker() -> None:
    global _WORKER
    with _WORKER_LOCK:
        if _WORKER is not None and _WORKER.is_alive():
            return
        _WORKER = threading.Thread(target=_worker_loop, name="desk-browser", daemon=True)
        _WORKER.start()


def _on_worker(fn: Callable[..., T], *args: Any, timeout: float = 120.0, **kwargs: Any) -> T:
    """Run ``fn`` on the browser thread and hand back its result or error."""

    _ensure_worker()
    out: "queue.Queue" = queue.Queue(maxsize=1)
    _JOBS.put((fn, args, kwargs, out))
    try:
        status, payload = out.get(timeout=timeout)
    except queue.Empty as exc:
        raise TimeoutError("the browser worker did not answer in time") from exc
    if status == "err":
        raise payload
    return payload


def playwright_available() -> tuple[bool, str]:
    """Is the optional Playwright runtime importable on this board?"""

    try:
        import playwright  # noqa: F401
        from playwright.sync_api import sync_playwright  # noqa: F401
    except ImportError:
        return False, "Playwright is not installed. Run: pip install -r requirements-browser.txt && playwright install chromium"
    return True, "ok"


@dataclass
class Session:
    """One warm Chromium owned by the desk."""

    id: str
    run_dir: Path
    headed: bool = False
    created_at: float = field(default_factory=time.monotonic)
    last_url: str = ""
    last_shot: str | None = None
    guard: threading.Lock = field(default_factory=threading.Lock)
    _pw: Any = None
    _browser: Any = None
    _page: Any = None


#: One shared session: several callers reuse the same warm Chromium.
_SESSION: Session | None = None
_SESSION_LOCK = threading.Lock()


def artifacts_root() -> Path:
    root = resolve_path(ARTIFACTS_REL)
    root.mkdir(parents=True, exist_ok=True)
    return root


_ARTIFACT_SUFFIXES = frozenset({".png", ".jpg", ".jpeg", ".webm", ".zip", ".json"})


def list_artifacts(limit: int = 40) -> list[dict]:
    """The newest browser artifacts, newest first."""

    root = artifacts_root()
    found: list[Path] = []
    runs = sorted((p for p in root.iterdir() if p.is_dir()), key=lambda p: p.stat().st_mtime, reverse=True)
    for run in runs:
        for child in sorted(run.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
            if child.is_file() and child.suffix.lower() in _ARTIFACT_SUFFIXES:
                found.append(child)
        if len(found) >= limit:
            break

    out: list[dict] = []
    for path in found[:limit]:
        out.append(
            {
                "path": path.relative_to(fs_root()).as_posix(),
                "name": path.name,
                "run": path.parent.name,
                "bytes": path.stat().st_size,
                "mtime": path.stat().st_mtime,
                "kind": path.suffix.lstrip(".").lower(),
            }
        )
    return out


_MEDIA = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webm": "video/webm",
    ".zip": "application/zip",
    ".json": "application/json",
}


def artifact_bytes(rel: str) -> tuple[bytes, str]:
    """Read one artifact, refusing anything outside the browser folder."""

    path = resolve_path(rel)
    if not path.is_file():
        raise FileNotFoundError(rel)
    root = artifacts_root().resolve()
    resolved = path.resolve()
    if root != resolved and root not in resolved.parents:
        raise PermissionError("not a browser artifact")
    return path.read_bytes(), _MEDIA.get(path.suffix.lower(), "application/octet-stream")


def status_for(_user_id: int) -> dict:
    """What the desk needs to render the Preview panel."""

    ok, detail = playwright_available()
    with _SESSION_LOCK:
        sess = _SESSION
    return {
        "playwright": ok,
        "detail": detail,
        "session_id": sess.id if sess else None,
        "url": sess.last_url if sess else None,
        "last_shot": sess.last_shot if sess else None,
        "headed": bool(sess.headed) if sess else False,
        "artifacts": list_artifacts(12),
    }


def _open_session(*, headed: bool = False) -> Session:
    """Start Chromium, or reuse the warm one when a headless session suffices."""

    global _SESSION

    ok, detail = playwright_available()
    if not ok:
        raise RuntimeError(detail)

    with _SESSION_LOCK:
        current = _SESSION
    # A warm headless session serves an ordinary request; only a headed request
    # forces a relaunch (there is nowhere to show a window on a headless board).
    if current is not None and current._page is not None and not (headed and not current.headed):
        return current

    from playwright.sync_api import sync_playwright

    run_id = time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6]
    run_dir = artifacts_root() / run_id
    run_dir.mkdir(parents=True, exist_ok=True)

    pw = sync_playwright().start()
    try:
        # Board tuning: less shared memory, no GPU, sandbox off inside the container.
        browser = pw.chromium.launch(
            headless=not headed,
            args=["--disable-dev-shm-usage", "--no-sandbox", "--disable-gpu"],
        )
        # A small viewport keeps each preview frame a light JPEG on the relay.
        page = browser.new_page(viewport={"width": 960, "height": 540})
    except Exception:
        pw.stop()
        raise

    session = Session(id=run_id, run_dir=run_dir, headed=headed)
    session._pw = pw
    session._browser = browser
    session._page = page

    with _SESSION_LOCK:
        previous = _SESSION
        _SESSION = session
    if previous is not None and previous is not session:
        _shutdown(previous)
    return session


def _shutdown(session: Session) -> None:
    with session.guard:
        try:
            if session._browser is not None:
                session._browser.close()
        except Exception:  # noqa: BLE001 - teardown must never raise
            pass
        try:
            if session._pw is not None:
                session._pw.stop()
        except Exception:  # noqa: BLE001
            pass
        session._browser = None
        session._page = None
        session._pw = None


def _close_impl() -> dict:
    global _SESSION
    with _SESSION_LOCK:
        session = _SESSION
        _SESSION = None
    if session is None:
        return {"ok": True, "closed": False}
    _shutdown(session)
    return {"ok": True, "closed": True, "session_id": session.id}


def close_session() -> dict:
    if threading.current_thread() is _WORKER:
        return _close_impl()
    return _on_worker(_close_impl)


def _warm_impl() -> dict:
    session = _open_session(headed=False)
    return {"ok": True, "warm": True, "session_id": session.id}


def warm_session() -> dict:
    if threading.current_thread() is _WORKER:
        return _warm_impl()
    return _on_worker(_warm_impl)


def _capture_png(session: Session, label: str) -> str:
    name = f"{int(time.time() * 1000)}-{label}.png"
    path = session.run_dir / name
    session._page.screenshot(path=str(path), full_page=False)
    rel = path.relative_to(fs_root()).as_posix()
    session.last_shot = rel
    return rel


def _capture_jpeg(session: Session, label: str) -> tuple[str, str]:
    """A compact JPEG plus its base64, so a preview is one relay round-trip."""

    raw = session._page.screenshot(type="jpeg", quality=52, full_page=False)
    name = f"{int(time.time() * 1000)}-{label}.jpg"
    path = session.run_dir / name
    path.write_bytes(raw)
    rel = path.relative_to(fs_root()).as_posix()
    session.last_shot = rel
    return rel, base64.b64encode(raw).decode("ascii")


def _same_url(left: str, right: str) -> bool:
    a, b = (left or "").strip().rstrip("/"), (right or "").strip().rstrip("/")
    return bool(a) and a == b


def _wait_for_paint(page: Any) -> None:
    """Give a client-rendered app a moment to paint its first view."""

    try:
        page.wait_for_function(
            """() => {
              const root = document.querySelector('#root, #app, [data-reactroot]');
              if (!root) return (document.body?.innerText || '').trim().length > 12;
              return root.childElementCount > 0 || (root.textContent || '').trim().length > 0;
            }""",
            timeout=5_000,
        )
    except Exception:  # noqa: BLE001 - a plain static page never satisfies this
        page.wait_for_timeout(400)


def _apply_viewport(page: Any, params: dict) -> None:
    width, height = params.get("width"), params.get("height")
    if not isinstance(width, int) or not isinstance(height, int):
        return
    width = max(VIEW_MIN, min(VIEW_MAX, width))
    height = max(VIEW_MIN, min(VIEW_MAX, height))
    current = page.viewport_size or {}
    if current.get("width") != width or current.get("height") != height:
        page.set_viewport_size({"width": width, "height": height})


def _interact(page: Any, params: dict) -> str | None:
    """Apply one Live preview input. Returns an error string, or None."""

    kind = str(params.get("input") or "").strip().lower()
    if kind == "click":
        x, y = params.get("x"), params.get("y")
        if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
            return "x and y are required"
        size = page.viewport_size or {"width": 960, "height": 540}
        page.mouse.click(max(0.0, min(1.0, float(x))) * size["width"], max(0.0, min(1.0, float(y))) * size["height"])
        return None
    if kind == "scroll":
        dy = params.get("dy")
        if not isinstance(dy, (int, float)):
            return "dy is required"
        page.mouse.wheel(0, max(-4000.0, min(4000.0, float(dy))))
        return None
    if kind == "key":
        key = str(params.get("key") or "")
        if key not in PRESSABLE_KEYS:
            return f"unsupported key {key[:20]}"
        page.keyboard.press(key)
        return None
    if kind == "text":
        text = str(params.get("text") or "")[:500]
        if not text:
            return "text is required"
        page.keyboard.insert_text(text)
        return None
    return f"unknown input {kind[:20]}"


def run_action(action: str, params: dict) -> dict:
    """Run one browser action on the worker thread."""

    kind = (action or "").strip().lower()
    # A live preview must answer well inside the relay's request timeout.
    timeout = 22.0 if kind in _QUICK_ACTIONS else 120.0
    return _on_worker(_run_action, action, params, timeout=timeout)


def _run_action(action: str, params: dict) -> dict:
    action = (action or "").strip().lower()
    headed = bool(params.get("headed"))

    if action in ("close", "stop"):
        return {"ok": True, "action": "close", **_close_impl()}
    if action == "warm":
        return {"ok": True, "action": "warm", **_warm_impl()}

    session = _open_session(headed=headed)
    with session.guard:
        page = session._page
        try:
            if action == "interact":
                _apply_viewport(page, params)
                problem = _interact(page, params)
                if problem:
                    return {"ok": False, "action": action, "error": problem}
                # Let handlers settle before the frame (no networkidle — HMR sockets stay open).
                page.wait_for_timeout(180)
                session.last_url = page.url
                shot, image_b64 = _capture_jpeg(session, "interact")
                return {
                    "ok": True,
                    "action": "interact",
                    "url": session.last_url,
                    "shot": shot,
                    "image_b64": image_b64,
                    "image_mime": "image/jpeg",
                }

            if action == "preview":
                url = str(params.get("url") or "").strip()
                if not url:
                    return {"ok": False, "action": action, "error": "url is required"}
                _apply_viewport(page, params)
                # Always hard-load, so a Refresh shows a repair the desk just made.
                if _same_url(session.last_url, url):
                    page.reload(wait_until="domcontentloaded", timeout=25_000)
                    reloaded = True
                else:
                    page.goto(url, wait_until="domcontentloaded", timeout=25_000)
                    reloaded = False
                _wait_for_paint(page)
                session.last_url = page.url
                shot, image_b64 = _capture_jpeg(session, "preview")
                return {
                    "ok": True,
                    "action": "preview",
                    "url": session.last_url,
                    "shot": shot,
                    "image_b64": image_b64,
                    "image_mime": "image/jpeg",
                    "reloaded": reloaded,
                }

            if action in ("navigate", "goto", "open"):
                url = str(params.get("url") or "").strip()
                if not url:
                    return {"ok": False, "action": action, "error": "url is required"}
                page.goto(url, wait_until="domcontentloaded", timeout=30_000)
                session.last_url = page.url
                return {"ok": True, "action": action, "url": session.last_url, "shot": _capture_png(session, "nav")}

            if action in ("screenshot", "shot"):
                return {"ok": True, "action": "screenshot", "url": page.url, "shot": _capture_png(session, "manual")}

            if action == "snapshot":
                return {
                    "ok": True,
                    "action": "snapshot",
                    "url": page.url,
                    "title": page.title(),
                    "text": page.inner_text("body")[:6000],
                    "shot": _capture_png(session, "snap"),
                }

            if action == "click":
                selector = str(params.get("selector") or "").strip()
                if not selector:
                    return {"ok": False, "action": action, "error": "selector is required"}
                page.click(selector, timeout=15_000)
                session.last_url = page.url
                return {
                    "ok": True,
                    "action": "click",
                    "selector": selector,
                    "url": session.last_url,
                    "shot": _capture_png(session, "click"),
                }

            if action == "type":
                selector = str(params.get("selector") or "").strip()
                if not selector:
                    return {"ok": False, "action": action, "error": "selector is required"}
                page.fill(selector, str(params.get("text") or ""), timeout=15_000)
                return {
                    "ok": True,
                    "action": "type",
                    "selector": selector,
                    "url": page.url,
                    "shot": _capture_png(session, "type"),
                }

            return {"ok": False, "action": action, "error": f"unknown action {action}"}
        except Exception as exc:  # noqa: BLE001 - surface the failure to the caller
            log.exception("browser action %s failed", action)
            try:
                shot = _capture_png(session, "error")
            except Exception:  # noqa: BLE001
                shot = session.last_shot
            return {
                "ok": False,
                "action": action,
                "error": f"{type(exc).__name__}: {exc}",
                "shot": shot,
                "url": getattr(page, "url", None),
            }


def shot_data_url(rel: str | None) -> str | None:
    """Inline a stored screenshot for an SSE payload."""

    if not rel:
        return None
    try:
        raw, _media = artifact_bytes(rel)
    except (OSError, FileNotFoundError, PermissionError):
        return None
    return "data:image/png;base64," + base64.b64encode(raw).decode("ascii")
