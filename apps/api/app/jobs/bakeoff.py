"""Light provider bakeoff — latency and error rate for configured endpoints."""

from __future__ import annotations

import json
import time

import httpx

from ..edge.files import resolve_path, write_file

BAKEOFF_REL = ".desk/bakeoff.json"
REPORT_REL = ".desk/bakeoff-report.md"


def load_targets() -> list[dict]:
    path = resolve_path(BAKEOFF_REL)
    if not path.is_file():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    raw = data if isinstance(data, list) else (data.get("targets") or [])
    targets: list[dict] = []
    for item in raw:
        if isinstance(item, str):
            targets.append({"name": item, "url": item})
        elif isinstance(item, dict) and item.get("url"):
            targets.append({"name": str(item.get("name") or item["url"]), "url": str(item["url"])})
    return targets


def write_default_bakeoff(targets: list[dict] | None = None) -> None:
    path = resolve_path(BAKEOFF_REL)
    path.parent.mkdir(parents=True, exist_ok=True)
    body = {"targets": targets or [{"name": "example", "url": "https://example.com"}]}
    path.write_text(json.dumps(body, indent=2) + "\n", encoding="utf-8")


def run_bakeoff(*, repeats: int = 3, timeout_s: float = 8.0) -> dict:
    """Hit each target ``repeats`` times and summarise latency/errors."""

    targets = load_targets()
    repeats = max(1, min(int(repeats), 20))
    if not targets:
        return {
            "ok": False,
            "error": f"No targets. Create {BAKEOFF_REL} with {{\"targets\": [{{\"name\":…,\"url\":…}}]}}.",
            "results": [],
        }

    results = []
    with httpx.Client(timeout=timeout_s, follow_redirects=True) as client:
        for target in targets:
            latencies: list[float] = []
            errors = 0
            last_status = None
            for _ in range(repeats):
                start = time.monotonic()
                try:
                    response = client.get(target["url"])
                    last_status = response.status_code
                    latencies.append((time.monotonic() - start) * 1000)
                    if response.status_code >= 500:
                        errors += 1
                except httpx.HTTPError:
                    errors += 1
                    latencies.append((time.monotonic() - start) * 1000)
            average = round(sum(latencies) / len(latencies), 1) if latencies else None
            results.append(
                {
                    "name": target["name"],
                    "url": target["url"],
                    "repeats": repeats,
                    "errors": errors,
                    "error_rate": round(errors / repeats, 4),
                    "avg_latency_ms": average,
                    "last_status": last_status,
                }
            )

    lines = [
        "# Bakeoff report",
        "",
        f"Repeats per target: {repeats}",
        "",
        "| Name | Avg ms | Errors | Last status |",
        "|---|---:|---:|---:|",
    ]
    for row in results:
        lines.append(f"| {row['name']} | {row['avg_latency_ms']} | {row['errors']}/{row['repeats']} | {row['last_status']} |")
    write_file(REPORT_REL, "\n".join(lines) + "\n")
    return {"ok": True, "results": results, "report": REPORT_REL}
