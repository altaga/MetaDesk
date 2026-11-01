"""Probe pack — answer 'is it me or the service?' from the board's network."""

from __future__ import annotations

import socket
import ssl
import time
from urllib.parse import urlparse

import httpx

Verdict = str  # local_network | remote_service | auth | unknown | ok


def _host_port(target: str) -> tuple[str, int, str]:
    raw = (target or "").strip()
    if "://" not in raw:
        if ":" in raw and not raw.startswith("["):
            host, _, port = raw.partition(":")
            try:
                return host, int(port or 443), "tcp"
            except ValueError:
                return raw, 443, "https"
        return raw, 443, "https"
    parsed = urlparse(raw)
    host = parsed.hostname or ""
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    return host, port, parsed.scheme or "https"


def probe_target(target: str, *, timeout_s: float = 8.0) -> dict:
    """Walk DNS → TCP → TLS → HTTP and name where it broke."""

    host, port, scheme = _host_port(target)
    out: dict = {
        "target": (target or "").strip(),
        "host": host,
        "port": port,
        "scheme": scheme,
        "dns_ok": False,
        "tcp_ok": False,
        "tls_ok": None,
        "http_status": None,
        "latency_ms": None,
        "verdict": "unknown",
        "detail": "",
    }
    if not host:
        out["detail"] = "empty host"
        return out

    start = time.monotonic()
    try:
        socket.getaddrinfo(host, port)
        out["dns_ok"] = True
    except OSError as exc:
        out["detail"] = f"dns failed: {exc}"
        out["verdict"] = "local_network"
        out["latency_ms"] = int((time.monotonic() - start) * 1000)
        return out

    try:
        with socket.create_connection((host, port), timeout=timeout_s):
            out["tcp_ok"] = True
    except OSError as exc:
        out["detail"] = f"tcp failed: {exc}"
        out["verdict"] = "remote_service"
        out["latency_ms"] = int((time.monotonic() - start) * 1000)
        return out

    if scheme in ("https", "tls"):
        try:
            context = ssl.create_default_context()
            with socket.create_connection((host, port), timeout=timeout_s) as sock:
                with context.wrap_socket(sock, server_hostname=host):
                    out["tls_ok"] = True
        except OSError as exc:
            out["tls_ok"] = False
            out["detail"] = f"tls failed: {exc}"
            out["verdict"] = "remote_service"
            out["latency_ms"] = int((time.monotonic() - start) * 1000)
            return out

    if scheme in ("http", "https"):
        url = out["target"] if "://" in out["target"] else f"{scheme}://{host}:{port}/"
        try:
            with httpx.Client(timeout=timeout_s, follow_redirects=True) as client:
                response = client.get(url)
            out["http_status"] = response.status_code
            out["latency_ms"] = int((time.monotonic() - start) * 1000)
            if response.status_code in (401, 403):
                out["verdict"] = "auth"
            elif response.status_code >= 400:
                out["verdict"] = "remote_service"
            else:
                out["verdict"] = "ok"
            out["detail"] = f"HTTP {response.status_code}"
            return out
        except httpx.HTTPError as exc:
            out["detail"] = f"http failed: {exc}"
            out["verdict"] = "remote_service"
            out["latency_ms"] = int((time.monotonic() - start) * 1000)
            return out

    out["latency_ms"] = int((time.monotonic() - start) * 1000)
    out["verdict"] = "ok"
    out["detail"] = "tcp ok"
    return out
