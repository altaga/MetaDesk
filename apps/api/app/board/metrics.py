"""Best-effort host telemetry for the operator desk.

CPU, memory and disk come from ``psutil``. Thermal zones and the Jetson GPU
load are read directly from ``/sys``. Every probe is defensive: anything that
cannot be read is reported as ``None`` instead of raising.
"""

from __future__ import annotations

import glob
import platform
import socket
from pathlib import Path
from typing import Any

import psutil

from ..config import desk_root_abs

_THERMAL_GLOB = "/sys/devices/virtual/thermal/thermal_zone*/temp"
_GPU_LOAD_PATH = "/sys/devices/gpu.0/load"
_GPU_MODEL_PATH = "/proc/device-tree/model"

_MB = 1024 * 1024
_GB = 1024 * 1024 * 1024


def _read_text(path: str) -> str | None:
    try:
        return Path(path).read_text(encoding="utf-8", errors="replace").strip("\x00 \n\t")
    except OSError:
        return None


def read_thermal_temp_c() -> float | None:
    """Return the highest readable thermal zone temperature in Celsius."""

    readings: list[float] = []
    for zone in glob.glob(_THERMAL_GLOB):
        raw = _read_text(zone)
        if raw is None:
            continue
        try:
            readings.append(int(raw.strip()) / 1000.0)
        except ValueError:
            continue
    if not readings:
        return None
    return round(max(readings), 1)


def read_gpu() -> dict[str, Any] | None:
    """Best-effort Jetson GPU snapshot; ``None`` when no GPU node exists."""

    load_raw = _read_text(_GPU_LOAD_PATH) if Path(_GPU_LOAD_PATH).exists() else None
    if load_raw is None:
        return None

    util_pct: float | None = None
    try:
        # The Tegra node reports a per-mille (0-1000) load value.
        util_pct = round(int(load_raw) / 1000.0 * 100.0, 1)
    except ValueError:
        util_pct = None

    name = _read_text(_GPU_MODEL_PATH) or "NVIDIA Jetson GPU"
    return {
        "name": name,
        "util_pct": util_pct,
        "mem_used_mb": None,
        "mem_total_mb": None,
        "temp_c": read_thermal_temp_c(),
    }


def board_info() -> dict[str, Any]:
    """Static-ish description of the host running the board."""

    return {
        "ok": True,
        "hostname": socket.gethostname(),
        "platform": platform.platform(),
        "python": platform.python_version(),
        "desk_root": str(desk_root_abs()),
    }


def board_health() -> dict[str, Any]:
    """Live telemetry for the board."""

    virtual = psutil.virtual_memory()
    try:
        disk = psutil.disk_usage(str(desk_root_abs()))
        disk_payload: dict[str, Any] | None = {
            "total_gb": round(disk.total / _GB, 2),
            "used_gb": round(disk.used / _GB, 2),
            "percent": round(disk.percent, 1),
        }
    except OSError:
        disk_payload = None

    return {
        "ok": True,
        "cpu": {
            "percent": psutil.cpu_percent(interval=0.1),
            "count": psutil.cpu_count(logical=True) or 0,
        },
        "ram": {
            "total_mb": round(virtual.total / _MB, 1),
            "used_mb": round(virtual.used / _MB, 1),
            "percent": round(virtual.percent, 1),
        },
        "disk": disk_payload,
        "temp_c": read_thermal_temp_c(),
        "gpu": read_gpu(),
    }
