#!/usr/bin/env python3
"""
MetaDesk 4DOF Robotic Arm - Standalone Serial Driver & CLI
Communicates with the robotic arm controller over USB Serial CDC (/dev/ttyACM0).

HARD MECHANICAL SAFETY LOCK:
  - Elbow is physically restricted to [90.0, 180.0] degrees. Never command below 90.0 deg.
  - Base, Shoulder, Wrist limits: [0.0, 180.0] degrees.
  - Gripper limits: [0.0, 100.0]% (0% = Closed, 100% = Open).
"""

import sys
import os
import time
import json
import argparse
from typing import Optional, Dict, Any, Tuple

# Ensure UTF-8 output
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

try:
    import serial
    import serial.tools.list_ports
except ImportError:
    print("[ERROR] pyserial is required. Install with: pip install pyserial", file=sys.stderr)
    sys.exit(1)

LIMIT_BASE = (0.0, 180.0)
LIMIT_SHOULDER = (0.0, 180.0)
LIMIT_ELBOW = (90.0, 180.0)  # HARD MECHANICAL INTERLOCK
LIMIT_WRIST = (0.0, 180.0)
LIMIT_CLAW = (0.0, 100.0)

PRESETS = ["COBRA", "GIMMEFIVE", "HTL", "HOME", "PARK"]
EXERCISES = ["BICEP", "REACH", "WRIST", "EXTEND", "COMPOUND"]
DEFAULT_PORT = "/dev/ttyACM0" if sys.platform != "win32" else "COM8"


class RoboticArmClient:
    """Serial communication client for the 4DOF Robotic Arm."""

    def __init__(self, port: Optional[str] = None, baudrate: int = 9600, timeout: float = 2.0):
        self.port = port or self.find_port()
        self.baudrate = baudrate
        self.timeout = timeout
        self.ser: Optional[serial.Serial] = None
        self.connect()

    @staticmethod
    def find_port() -> str:
        """Find active serial port or return platform default."""
        ports = list(serial.tools.list_ports.comports())
        for p in ports:
            desc = (p.description or "").lower()
            mfg = (p.manufacturer or "").lower()
            if "arduino" in desc or "arduino" in mfg or "dedq" in desc or "cdc" in desc:
                return p.device
        return DEFAULT_PORT

    def connect(self):
        """Establish serial connection with DTR/RTS assertion."""
        if self.ser and self.ser.is_open:
            try:
                self.ser.close()
            except Exception:
                pass

        try:
            self.ser = serial.Serial(self.port, self.baudrate, timeout=self.timeout)
            self.ser.dtr = True
            self.ser.rts = True
            time.sleep(0.3)
            self.ser.reset_input_buffer()
        except serial.SerialException as exc:
            print(f"[ERROR] Could not open serial port '{self.port}': {exc}", file=sys.stderr)
            sys.exit(1)

    def close(self):
        """Close serial connection cleanly."""
        if self.ser and self.ser.is_open:
            try:
                self.ser.close()
            except Exception:
                pass
            self.ser = None

    def send_raw(self, cmd: str, timeout_s: Optional[float] = None) -> str:
        """Send a raw text command and collect the response."""
        if not self.ser or not self.ser.is_open:
            raise ConnectionError("Robotic arm serial port not open.")

        clean_cmd = cmd.strip()
        self.ser.reset_input_buffer()
        self.ser.write((clean_cmd + "\n").encode("utf-8"))
        self.ser.flush()

        timeout = timeout_s if timeout_s is not None else self.timeout
        start = time.time()
        reply_lines = []

        while time.time() - start < timeout:
            raw_line = self.ser.readline()
            if not raw_line:
                time.sleep(0.05)
                continue
            line = raw_line.decode("utf-8", errors="ignore").strip()
            if line:
                if line == ">":
                    continue
                reply_lines.append(line)
                if (line.startswith("OK:") or line.startswith("ERR:") or 
                    line == "PONG" or (line.startswith("{") and line.endswith("}"))):
                    break

        return "\n".join(reply_lines) if reply_lines else ""

    def ping(self) -> bool:
        """Ping the robotic arm."""
        res = self.send_raw("PING", timeout_s=1.0)
        return "PONG" in res

    def get_status(self) -> Dict[str, Any]:
        """Query live telemetry status."""
        res = self.send_raw("STATUS", timeout_s=1.5)
        for line in res.splitlines():
            line = line.strip()
            if line.startswith("{") and line.endswith("}"):
                try:
                    return json.loads(line)
                except json.JSONDecodeError:
                    pass
        return {}

    def gripper(self, pct: float) -> Tuple[bool, str]:
        """
        Set gripper opening percentage.
        0.0 = Fully closed, 100.0 = Fully open.
        """
        pct = max(0.0, min(100.0, float(pct)))
        res = self.send_raw(f"GRIP {pct:.1f}", timeout_s=3.0)
        return res.startswith("OK:"), res

    def grip_open(self) -> Tuple[bool, str]:
        """Open gripper completely (100%)."""
        return self.gripper(100.0)

    def grip_close(self) -> Tuple[bool, str]:
        """Close gripper completely (0%)."""
        return self.gripper(0.0)

    def joints(self, base: float, shoulder: float, elbow: float, wrist: float) -> Tuple[bool, str]:
        """
        Move joints with strict hardware angle validation.
        """
        if not (LIMIT_BASE[0] <= base <= LIMIT_BASE[1]):
            raise ValueError(f"Base angle {base:.1f}° out of range [{LIMIT_BASE[0]}, {LIMIT_BASE[1]}]")
        if not (LIMIT_SHOULDER[0] <= shoulder <= LIMIT_SHOULDER[1]):
            raise ValueError(f"Shoulder angle {shoulder:.1f}° out of range [{LIMIT_SHOULDER[0]}, {LIMIT_SHOULDER[1]}]")
        if not (LIMIT_ELBOW[0] <= elbow <= LIMIT_ELBOW[1]):
            raise ValueError(
                f"SAFETY INTERLOCK BLOCKED: Elbow angle {elbow:.1f}° is below minimum safe angle {LIMIT_ELBOW[0]}°! "
                f"Elbow is physically restricted to [90.0°, 180.0°] to prevent mechanical breakage."
            )
        if not (LIMIT_WRIST[0] <= wrist <= LIMIT_WRIST[1]):
            raise ValueError(f"Wrist angle {wrist:.1f}° out of range [{LIMIT_WRIST[0]}, {LIMIT_WRIST[1]}]")

        res = self.send_raw(f"JOINTS {base:.1f} {shoulder:.1f} {elbow:.1f} {wrist:.1f}", timeout_s=4.0)
        return res.startswith("OK:"), res

    def home(self) -> Tuple[bool, str]:
        """Move arm to safe home position (Base 90°, Shoulder 90°, Elbow 95°, Wrist 90°, Claw 100%)."""
        res = self.send_raw("HOME", timeout_s=3.0)
        return res.startswith("OK:"), res

    def preset(self, name: str) -> Tuple[bool, str]:
        """Execute a predefined motion protocol."""
        name_clean = name.strip().upper()
        res = self.send_raw(f"PRESET {name_clean}", timeout_s=5.0)
        return res.startswith("OK:"), res

    def exercise(self, name: str, reps: int = 3) -> Tuple[bool, str]:
        """Execute a predefined exercise movement."""
        reps = max(1, min(6, int(reps)))
        name_clean = name.strip().upper()
        res = self.send_raw(f"EXERCISE {name_clean} {reps}", timeout_s=6.0)
        return res.startswith("OK:"), res

    def estop(self) -> Tuple[bool, str]:
        """Trigger emergency stop."""
        res = self.send_raw("ESTOP", timeout_s=1.0)
        return res.startswith("OK:"), res

    def release(self) -> Tuple[bool, str]:
        """Release servo torque."""
        res = self.send_raw("RELEASE", timeout_s=1.0)
        return res.startswith("OK:"), res


def print_status_card(st: Dict[str, Any]):
    """Pretty-print telemetry status."""
    if not st:
        print("[WARN] Could not retrieve telemetry status.")
        return

    mode = st.get("mode", "unknown")
    angles = st.get("angles", [0, 0, 0, 0])
    pwms = st.get("pwm", [0, 0, 0, 0])
    claw = st.get("claw", 0.0)
    dry = st.get("dry_run", False)
    loaded = st.get("loaded", False)

    claw_str = f"OPEN ({claw:.0f}%)" if claw >= 90 else f"CLOSED ({claw:.0f}%)" if claw <= 10 else f"{claw:.1f}%"

    print("\n+--- ROBOTIC ARM TELEMETRY -------------------------------+")
    print(f"| Mode: {mode.upper():<10} | Dry Run: {'YES' if dry else 'NO':<5} | Loaded: {'YES' if loaded else 'NO':<5}   |")
    print("+---------------------------------------------------------+")
    if len(angles) >= 4 and len(pwms) >= 4:
        print(f"|  Base     : {angles[0]:>5.1f} deg  (PWM: {pwms[0]:>3})                        |")
        print(f"|  Shoulder : {angles[1]:>5.1f} deg  (PWM: {pwms[1]:>3})                        |")
        print(f"|  Elbow    : {angles[2]:>5.1f} deg  (PWM: {pwms[2]:>3}) [Lock >= 90.0 deg]     |")
        print(f"|  Wrist    : {angles[3]:>5.1f} deg  (PWM: {pwms[3]:>3})                        |")
    print("+---------------------------------------------------------+")
    print(f"|  Gripper  : {claw_str:<44}|")
    print("+---------------------------------------------------------+\n")


def parse_args():
    parser = argparse.ArgumentParser(description="MetaDesk 4DOF Robotic Arm CLI")
    parser.add_argument("--port", "-p", default=None, help=f"Serial port (default: {DEFAULT_PORT})")
    parser.add_argument("--baud", "-b", default=9600, type=int, help="Baud rate (default: 9600)")
    parser.add_argument("--status", action="store_true", help="Print live robotic arm status")
    parser.add_argument("--json", action="store_true", help="Output status as raw JSON")
    parser.add_argument("--ping", action="store_true", help="Ping robotic arm")
    parser.add_argument("--home", action="store_true", help="Move arm to safe home position")
    parser.add_argument("--grip", type=str, default=None, help="Set gripper: open | close | 0-100")
    parser.add_argument("--joints", nargs=4, type=float, metavar=("BASE", "SHOULDER", "ELBOW", "WRIST"),
                        help="Set joint angles in degrees (Elbow strictly >= 90.0 deg)")
    parser.add_argument("--preset", type=str, default=None, help=f"Execute preset: {', '.join(PRESETS)}")
    parser.add_argument("--exercise", nargs="+", metavar=("NAME", "[REPS]"),
                        help=f"Execute exercise: {', '.join(EXERCISES)} [reps]")
    parser.add_argument("--estop", action="store_true", help="Emergency stop")
    parser.add_argument("--release", action="store_true", help="Release servo torque")
    parser.add_argument("--cmd", "-c", type=str, default=None, help="Send raw command string")
    return parser.parse_args()


def main():
    args = parse_args()
    client = RoboticArmClient(port=args.port, baudrate=args.baud)

    try:
        if args.status:
            st = client.get_status()
            if args.json:
                print(json.dumps(st))
            else:
                print_status_card(st)
            return

        if args.ping:
            ok = client.ping()
            print("PONG (OK)" if ok else "NO RESPONSE")
            return

        if args.home:
            ok, msg = client.home()
            print(msg if msg else ("OK: HOME" if ok else "FAILED"))
            return

        if args.grip is not None:
            g = args.grip.strip().lower()
            if g == "open":
                ok, msg = client.grip_open()
            elif g == "close":
                ok, msg = client.grip_close()
            else:
                try:
                    pct = float(g)
                    ok, msg = client.gripper(pct)
                except ValueError:
                    print(f"[ERROR] Invalid grip value '{args.grip}', must be open|close|0-100", file=sys.stderr)
                    sys.exit(2)
            print(msg if msg else ("OK: GRIP" if ok else "FAILED"))
            return

        if args.joints is not None:
            b, s, e, w = args.joints
            try:
                ok, msg = client.joints(b, s, e, w)
                print(msg if msg else ("OK: JOINTS" if ok else "FAILED"))
            except ValueError as err:
                print(f"[SAFETY ERROR] {err}", file=sys.stderr)
                sys.exit(2)
            return

        if args.preset is not None:
            ok, msg = client.preset(args.preset)
            print(msg if msg else ("OK: PRESET" if ok else "FAILED"))
            return

        if args.exercise is not None:
            ex_name = args.exercise[0]
            reps = int(args.exercise[1]) if len(args.exercise) > 1 and args.exercise[1].isdigit() else 3
            ok, msg = client.exercise(ex_name, reps)
            print(msg if msg else ("OK: EXERCISE" if ok else "FAILED"))
            return

        if args.estop:
            ok, msg = client.estop()
            print(msg if msg else ("OK: ESTOP" if ok else "FAILED"))
            return

        if args.release:
            ok, msg = client.release()
            print(msg if msg else ("OK: RELEASE" if ok else "FAILED"))
            return

        if args.cmd is not None:
            reply = client.send_raw(args.cmd)
            print(reply if reply else "(no reply)")
            return

        # Default action when run with no arguments: show status
        st = client.get_status()
        print_status_card(st)

    finally:
        client.close()


if __name__ == "__main__":
    main()
