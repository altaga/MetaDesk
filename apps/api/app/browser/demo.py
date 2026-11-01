"""Screen recordings and rendered stills, produced on the board's Chromium.

``record`` opens a URL in a fresh recording context, plays a short scripted
sequence with a visible cursor, and saves the clip under ``Demos/``.
``render`` turns a snippet of HTML or SVG into a PNG/JPEG under the desk root,
which is handy for thumbnails, diagrams and mockups.
"""

from __future__ import annotations

import logging
import re
import shutil
import subprocess
import threading
import time
import uuid
from dataclasses import dataclass
from pathlib import Path

from ..edge.files import fs_root, resolve_path
from . import runtime

log = logging.getLogger(__name__)

DEMOS_REL = "Demos"
IMAGES_REL = "Images"

MAX_STEPS = 40
MAX_RECORD_SECONDS = 120
MAX_WAIT_SECONDS = 10.0
MAX_TYPE_CHARS = 300
MAX_HTML_CHARS = 200_000
STEP_GAP_MS = 450
FFMPEG_TIMEOUT = 180
_DIM_MIN, _DIM_MAX = 240, 1920

SIZES: dict[str, tuple[int, int]] = {
    "720p": (1280, 720),
    "1080p": (1920, 1080),
    "mobile": (390, 844),
    "square": (1080, 1080),
}
FORMATS = ("webm", "mp4", "gif")
OPS = ("wait", "click", "hover", "type", "press", "scroll", "goto")

_KEY_RE = re.compile(r"^[A-Za-z0-9+]{1,24}$")
_KV_RE = re.compile(r"^([A-Za-z_][\w-]*)\s*:\s*(.*)$")
_WEB_URL_RE = re.compile(r"^https?://\S+$")

#: Recording competes with the local model and any dev server for RAM, so one
#: recording runs at a time.
_RECORD_LOCK = threading.Lock()

#: Playwright videos carry no pointer, so a small overlay is injected to make
#: the movement legible to whoever watches the demo.
CURSOR_JS = """
(() => {
  if (window.__deskPointer) return;
  window.__deskPointer = true;
  const mount = () => {
    const dot = document.createElement('div');
    dot.style.cssText =
      'position:fixed;left:0;top:0;width:16px;height:16px;margin:-8px 0 0 -8px;' +
      'border-radius:50%;background:rgba(15,15,15,.6);border:2px solid #fff;' +
      'box-shadow:0 1px 4px rgba(0,0,0,.5);z-index:2147483647;pointer-events:none;' +
      'transform:translate(-80px,-80px)';
    document.documentElement.appendChild(dot);
    let x = -80, y = -80;
    const place = (scale) => { dot.style.transform = `translate(${x}px,${y}px) scale(${scale})`; };
    addEventListener('mousemove', (e) => { x = e.clientX; y = e.clientY; place(1); }, true);
    addEventListener('mouseup', () => place(1), true);
    addEventListener('mousedown', () => {
      place(0.65);
      const ring = document.createElement('div');
      ring.style.cssText =
        `position:fixed;left:${x - 18}px;top:${y - 18}px;width:36px;height:36px;` +
        'border-radius:50%;border:2px solid rgba(80,160,255,.9);z-index:2147483646;' +
        'pointer-events:none;transition:transform .4s ease,opacity .4s ease;' +
        'transform:scale(.3);opacity:1';
      document.documentElement.appendChild(ring);
      requestAnimationFrame(() => { ring.style.transform = 'scale(1.3)'; ring.style.opacity = '0'; });
      setTimeout(() => ring.remove(), 480);
    }, true);
  };
  if (document.documentElement) mount();
  else addEventListener('DOMContentLoaded', mount);
})();
"""


@dataclass
class Step:
    op: str
    target: str = ""
    text: str = ""
    seconds: float = 0.0
    dy: float = 0.0


@dataclass
class RecordPlan:
    url: str
    width: int
    height: int
    fmt: str
    name: str
    steps: list[Step]
    errors: list[str]
    step_errors: list[str]


@dataclass
class RenderPlan:
    html: str
    width: int
    height: int
    scale: int
    out: str
    errors: list[str]


def _short(exc: BaseException) -> str:
    text = str(exc).strip()
    return (text.splitlines()[0] if text else type(exc).__name__)[:200]


def _is_web_url(url: str) -> bool:
    return bool(_WEB_URL_RE.match(url or ""))


def parse_size(raw: str | None, default: str = "720p") -> tuple[int, int] | None:
    """Accept a named size, or an explicit ``WxH``."""

    text = (raw or default).strip().lower()
    if text in SIZES:
        return SIZES[text]
    found = re.fullmatch(r"(\d{3,4})\s*[x×]\s*(\d{3,4})", text)
    if not found:
        return None
    width, height = int(found.group(1)), int(found.group(2))
    return max(_DIM_MIN, min(_DIM_MAX, width)), max(_DIM_MIN, min(_DIM_MAX, height))


def safe_name(raw: str | None, default: str = "demo") -> str:
    """A filesystem-safe stem for a produced artifact."""

    name = re.sub(r"[^\w.-]+", "-", (raw or "").strip()).strip(".-")
    name = re.sub(r"\.(webm|mp4|gif|png|jpe?g)$", "", name, flags=re.I)
    return name[:60] or default


def parse_steps(raw: str) -> tuple[list[Step], list[str]]:
    steps: list[Step] = []
    errors: list[str] = []
    for line_number, line in enumerate((raw or "").splitlines(), 1):
        text = re.sub(r"^[-*]\s*", "", line.strip())
        if not text or text.startswith("#"):
            continue
        if len(steps) >= MAX_STEPS:
            errors.append(f"only the first {MAX_STEPS} steps were run")
            break
        op, _, rest = text.partition(" ")
        op, rest = op.lower().rstrip(":"), rest.strip()
        if op not in OPS:
            errors.append(f"step {line_number}: unknown '{op}' (use {'|'.join(OPS)})")
            continue
        try:
            steps.append(_build_step(op, rest))
        except ValueError as exc:
            errors.append(f"step {line_number}: {exc}")
    return steps, errors


def _build_step(op: str, rest: str) -> Step:
    if op == "wait":
        return Step(op, seconds=max(0.0, min(MAX_WAIT_SECONDS, float(rest or 1))))
    if op == "scroll":
        return Step(op, dy=max(-5000.0, min(5000.0, float(rest or 600))))
    if op == "press":
        if not _KEY_RE.match(rest):
            raise ValueError("press needs a key such as Enter or Control+A")
        return Step(op, target=rest)
    if op == "goto":
        if not _is_web_url(rest):
            raise ValueError("goto needs an http(s) URL")
        return Step(op, target=rest)
    if op == "type":
        target, sep, text = rest.partition(" :: ")
        if not sep or not target.strip():
            raise ValueError("type needs 'selector :: text'")
        return Step(op, target=target.strip(), text=text[:MAX_TYPE_CHARS])
    if not rest:
        raise ValueError(f"{op} needs a selector")
    return Step(op, target=rest)


def _split_options(body: str, payload_start: re.Pattern[str]) -> tuple[dict[str, str], str]:
    """Leading ``key: value`` lines are options; the rest is the payload."""

    options: dict[str, str] = {}
    lines = (body or "").splitlines()
    for index, line in enumerate(lines):
        if payload_start.match(line.strip()):
            rest = lines[index + 1 :] if line.strip().lower() in ("---", "steps:") else lines[index:]
            return options, "\n".join(rest)
        found = _KV_RE.match(line.strip())
        if found:
            options[found.group(1).lower()] = found.group(2).strip()
    return options, ""


_STEPS_START = re.compile(rf"^(steps:|---|[-*]\s|(?:{'|'.join(OPS)})(?:\s|$))", re.I)


def parse_record_plan(body: str) -> RecordPlan:
    options, rest = _split_options(body, _STEPS_START)
    errors: list[str] = []

    url = options.get("url", "")
    if not _is_web_url(url):
        errors.append("record needs url: http(s)://…")

    size = parse_size(options.get("size"))
    if size is None:
        errors.append("size must be 720p|1080p|mobile|square or WxH")
        size = SIZES["720p"]

    fmt = (options.get("format") or "webm").lower().lstrip(".")
    if fmt not in FORMATS:
        errors.append(f"format must be {'|'.join(FORMATS)}")
        fmt = "webm"

    steps, step_errors = parse_steps(rest)
    if not steps and not step_errors:
        steps = [Step("wait", seconds=3.0)]

    return RecordPlan(url, size[0], size[1], fmt, safe_name(options.get("name")), steps, errors, step_errors)


def parse_render_plan(body: str) -> RenderPlan:
    options, html = _split_options(body, re.compile(r"^(---|<)"))
    errors: list[str] = []
    html = html.strip()
    if not html:
        errors.append("render needs HTML or SVG after the options (or after ---)")
    if len(html) > MAX_HTML_CHARS:
        errors.append(f"the HTML is too long (max {MAX_HTML_CHARS} characters)")
    if html.lower().startswith("<svg"):
        html = f"<!doctype html><html><body style='margin:0'>{html}</body></html>"

    size = parse_size(options.get("size"), default="1200x630")
    if size is None:
        errors.append("size must be WxH (such as 1200x630) or 720p|1080p|mobile|square")
        size = (1200, 630)

    scale = 2 if (options.get("scale") or "").strip().lower() in ("2", "2x") else 1

    out = (options.get("out") or "").strip()
    if out and not re.search(r"\.(png|jpe?g)$", out, re.I):
        errors.append("out must end in .png or .jpg")

    return RenderPlan(html, size[0], size[1], scale, out, errors)


def _unique(path: Path) -> Path:
    if not path.exists():
        return path
    for n in range(2, 1000):
        candidate = path.with_name(f"{path.stem}-{n}{path.suffix}")
        if not candidate.exists():
            return candidate
    return path.with_name(f"{path.stem}-{uuid.uuid4().hex[:6]}{path.suffix}")


def _rel(path: Path) -> str:
    return path.relative_to(fs_root()).as_posix()


# --- recording ---------------------------------------------------------------------


def _aim_at(page: object, selector: str, cursor: list[float]) -> tuple[float, float]:
    locator = page.locator(selector).first  # type: ignore[union-attr]
    locator.scroll_into_view_if_needed(timeout=8_000)
    box = locator.bounding_box(timeout=8_000)
    if not box:
        raise RuntimeError(f"{selector} is not visible")
    x = box["x"] + box["width"] / 2
    y = box["y"] + box["height"] / 2
    page.mouse.move(x, y, steps=18)  # type: ignore[union-attr]
    cursor[:] = [x, y]
    page.wait_for_timeout(180)  # type: ignore[union-attr]
    return x, y


def _play_step(page: object, step: Step, cursor: list[float]) -> None:
    if step.op == "wait":
        page.wait_for_timeout(step.seconds * 1000)  # type: ignore[union-attr]
    elif step.op in ("click", "hover"):
        x, y = _aim_at(page, step.target, cursor)
        if step.op == "click":
            page.mouse.click(x, y)  # type: ignore[union-attr]
    elif step.op == "type":
        x, y = _aim_at(page, step.target, cursor)
        page.mouse.click(x, y)  # type: ignore[union-attr]
        page.keyboard.type(step.text, delay=55)  # type: ignore[union-attr]
    elif step.op == "press":
        page.keyboard.press(step.target)  # type: ignore[union-attr]
    elif step.op == "scroll":
        notches = max(1, int(abs(step.dy) // 100))
        each = step.dy / notches
        for _ in range(notches):
            page.mouse.wheel(0, each)  # type: ignore[union-attr]
            page.wait_for_timeout(30)  # type: ignore[union-attr]
    elif step.op == "goto":
        page.goto(step.target, wait_until="domcontentloaded", timeout=25_000)  # type: ignore[union-attr]
        runtime._wait_for_paint(page)


def _record_clip(plan: RecordPlan, tmp: Path) -> dict:
    session = runtime._open_session()
    size = {"width": plan.width, "height": plan.height}
    context = session._browser.new_context(  # type: ignore[union-attr]
        viewport=size, record_video_dir=str(tmp), record_video_size=size
    )
    context.add_init_script(CURSOR_JS)
    page = context.new_page()

    errors: list[str] = []
    ran = 0
    started = time.monotonic()
    cursor = [plan.width / 2, plan.height / 2]
    opened = False
    try:
        page.goto(plan.url, wait_until="domcontentloaded", timeout=25_000)
        runtime._wait_for_paint(page)
        opened = True
        page.mouse.move(*cursor)
        page.wait_for_timeout(700)
        for step in plan.steps:
            if time.monotonic() - started > MAX_RECORD_SECONDS:
                errors.append(f"stopped at the {MAX_RECORD_SECONDS}s limit")
                break
            try:
                _play_step(page, step, cursor)
                ran += 1
            except Exception as exc:  # noqa: BLE001 - keep recording, report the step
                errors.append(f"{step.op} {step.target}: {_short(exc)}".strip())
            page.wait_for_timeout(STEP_GAP_MS)
        page.wait_for_timeout(900)
    except Exception as exc:  # noqa: BLE001
        errors.append(f"open {plan.url}: {_short(exc)}")

    final_url = page.url
    video = page.video
    context.close()  # flushes the video file to disk
    raw = Path(video.path()) if video and opened else None
    return {
        "raw": str(raw) if raw else None,
        "seconds": round(time.monotonic() - started, 1),
        "steps_run": ran,
        "errors": errors,
        "final_url": final_url,
    }


def _ffmpeg_exe() -> str | None:
    # Prefer the static imageio-ffmpeg build: a board's distro ffmpeg is often
    # NVENC-only, which cannot encode the mp4/gif variants we ask for.
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:  # noqa: BLE001 - optional dependency
        return shutil.which("ffmpeg")


def _convert(raw: Path, out: Path, fmt: str) -> str | None:
    """Encode ``raw`` with ffmpeg. Returns an error string, or None on success."""

    ffmpeg = _ffmpeg_exe()
    if not ffmpeg:
        return "ffmpeg is not installed"
    if fmt == "mp4":
        args = [
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "26",
            "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an",
        ]
    else:
        args = [
            "-vf", "fps=12,scale='min(960,iw)':-2:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse",
            "-loop", "0",
        ]
    try:
        done = subprocess.run(  # noqa: S603 - fixed argv, paths inside the desk root
            [ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-i", str(raw), *args, str(out)],
            capture_output=True, text=True, timeout=FFMPEG_TIMEOUT, check=False,
        )
    except subprocess.TimeoutExpired:
        return f"ffmpeg took longer than {FFMPEG_TIMEOUT}s"
    if done.returncode != 0 or not out.is_file():
        return (done.stderr or "ffmpeg failed").strip().splitlines()[-1][:200]
    return None


def _finalize_video(raw: Path, plan: RecordPlan) -> tuple[Path, str, str | None]:
    folder = resolve_path(DEMOS_REL)
    folder.mkdir(parents=True, exist_ok=True)
    note: str | None = None
    if plan.fmt != "webm":
        target = _unique(folder / f"{plan.name}.{plan.fmt}")
        problem = _convert(raw, target, plan.fmt)
        if problem is None:
            return target, plan.fmt, None
        target.unlink(missing_ok=True)
        note = f"kept webm ({problem})"
    target = _unique(folder / f"{plan.name}.webm")
    shutil.move(str(raw), target)
    return target, "webm", note


def record_demo(body: str) -> dict:
    """Blocking: call through ``asyncio.to_thread``. Holds the browser thread."""

    plan = parse_record_plan(body)
    base = {"kind": "record", "url": plan.url, "format": plan.fmt}
    if plan.errors:
        return {**base, "ok": False, "error": "; ".join(plan.errors)}
    if not _RECORD_LOCK.acquire(blocking=False):
        return {**base, "ok": False, "error": "another recording is already running on this board"}

    tmp = resolve_path(f"{runtime.ARTIFACTS_REL}/rec-{uuid.uuid4().hex[:8]}")
    tmp.mkdir(parents=True, exist_ok=True)
    try:
        played = runtime._on_worker(_record_clip, plan, tmp, timeout=MAX_RECORD_SECONDS + 90)
        errors = plan.step_errors + played["errors"]
        if not played["raw"]:
            return {**base, "ok": False, "error": "; ".join(errors) or "no video was produced"}
        out, fmt, note = _finalize_video(Path(played["raw"]), plan)
        rel = _rel(out)
        return {
            **base,
            "ok": True,
            "path": rel,
            "format": fmt,
            "bytes": out.stat().st_size,
            "seconds": played["seconds"],
            "steps_run": played["steps_run"],
            "steps_total": len(plan.steps),
            "final_url": played["final_url"],
            "step_errors": errors[:10],
            "note": note,
            "media": {"type": "video", "path": rel},
        }
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
        _RECORD_LOCK.release()


# --- rendering ---------------------------------------------------------------------


def _render_impl(plan: RenderPlan, jpeg: bool) -> bytes:
    session = runtime._open_session()
    context = session._browser.new_context(  # type: ignore[union-attr]
        viewport={"width": plan.width, "height": plan.height}, device_scale_factor=plan.scale
    )
    try:
        page = context.new_page()
        page.set_content(plan.html, wait_until="load", timeout=15_000)
        page.wait_for_timeout(150)
        if jpeg:
            return page.screenshot(type="jpeg", quality=88, full_page=False)
        return page.screenshot(type="png", full_page=False)
    finally:
        context.close()


def render_image(body: str) -> dict:
    """Blocking: call through ``asyncio.to_thread``."""

    plan = parse_render_plan(body)
    base = {"kind": "render", "width": plan.width, "height": plan.height}
    if plan.errors:
        return {**base, "ok": False, "error": "; ".join(plan.errors)}

    if plan.out:
        target = resolve_path(plan.out)
    else:
        target = _unique(resolve_path(IMAGES_REL) / f"render-{time.strftime('%Y%m%d-%H%M%S')}.png")
    if target.is_dir():
        return {**base, "ok": False, "error": "out points at a folder"}

    jpeg = target.suffix.lower() in (".jpg", ".jpeg")
    data = runtime._on_worker(_render_impl, plan, jpeg, timeout=40)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    rel = _rel(target)
    return {
        **base,
        "ok": True,
        "path": rel,
        "bytes": len(data),
        "scale": plan.scale,
        "media": {"type": "image", "path": rel},
    }
