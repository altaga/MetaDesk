#!/usr/bin/env python3
"""
Armic 4DOF Robot Arm - Standalone Serial Driver & Interactive CLI
Communicates with the Arduino UNO Q board (STM32U585 + QRB2210 Linux MPU)
over USB Serial CDC (e.g. COM8 on Windows, /dev/ttyGS0 on Linux).

SAFETY INTERLOCKS:
  - Elbow is mechanically locked to [90.0, 180.0] degrees. Never drops below 90.0 deg.
  - Base, Shoulder, Wrist limits: [0.0, 180.0] degrees.
  - Gripper: [0.0, 100.0]% (0% = Closed [PWM 236], 100% = Open [PWM 440]).
  - All kinematics interpolation and S-curve timing are executed on-board.
"""

import sys
import os
import time
import json
import argparse
from typing import Optional, Dict, Any, List, Tuple

# Ensure UTF-8 output on Windows terminal
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
    print("[ERROR] pyserial is required. Install with: pip install pyserial")
    sys.exit(1)

try:
    from colorama import init, Fore, Style
    init(autoreset=True)
    COLOR_ENABLED = True
except ImportError:
    COLOR_ENABLED = False
    class Fore:
        GREEN = RED = YELLOW = CYAN = BLUE = MAGENTA = WHITE = RESET = ""
    class Style:
        BRIGHT = NORMAL = RESET_ALL = ""


# Canonical SSoT Limits
LIMIT_BASE = (0.0, 180.0)
LIMIT_SHOULDER = (0.0, 180.0)
LIMIT_ELBOW = (90.0, 180.0)  # HARD MECHANICAL SAFETY LOCK
LIMIT_WRIST = (0.0, 180.0)
LIMIT_CLAW = (0.0, 100.0)

PRESETS = ["COBRA", "GIMMEFIVE", "HTL", "HOME", "PARK"]
EXERCISES = ["BICEP", "REACH", "WRIST", "EXTEND", "COMPOUND"]


class ArmicSerialClient:
    """High-level client for the Armic 4DOF Serial Interface."""

    def __init__(self, port: Optional[str] = None, baudrate: int = 9600, timeout: float = 2.0):
        self.baudrate = baudrate
        self.timeout = timeout
        self.port = port or self.find_port()
        self.ser: Optional[serial.Serial] = None
        self.connect()

    @staticmethod
    def find_port() -> str:
        """Auto-detect Arduino UNO Q or return COM8 default."""
        ports = list(serial.tools.list_ports.comports())
        for p in ports:
            desc = (p.description or "").lower()
            mfg = (p.manufacturer or "").lower()
            if "arduino" in desc or "arduino" in mfg or "gadget" in desc or "cdc" in desc:
                return p.device
        return "COM8" if sys.platform == "win32" else "/dev/ttyACM0"

    def connect(self):
        """Establish serial connection and clear initial buffer."""
        if self.ser and self.ser.is_open:
            self.ser.close()

        try:
            self.ser = serial.Serial(self.port, self.baudrate, timeout=self.timeout)
            self.ser.dtr = True
            self.ser.rts = True
            time.sleep(0.4)
            self.ser.reset_input_buffer()
        except serial.SerialException as exc:
            print(f"\n{Fore.RED}[ERROR] Could not connect to serial port '{self.port}':{Style.RESET_ALL} {exc}")
            print(f"{Fore.YELLOW}[TIP] Verify that the Arduino board is plugged in via USB-C and COM port matches.{Style.RESET_ALL}\n")
            sys.exit(1)

    def close(self):
        """Close serial port."""
        if self.ser and self.ser.is_open:
            self.ser.close()
            self.ser = None

    def send_raw(self, cmd: str, timeout_s: Optional[float] = None) -> str:
        """Send a raw command string and wait for a response."""
        if not self.ser or not self.ser.is_open:
            raise ConnectionError("Serial port not connected.")

        clean_cmd = cmd.strip()
        self.ser.write((clean_cmd + "\n").encode("utf-8"))
        self.ser.flush()

        timeout = timeout_s if timeout_s is not None else self.timeout
        start = time.time()
        reply_lines = []

        while time.time() - start < timeout:
            raw_line = self.ser.readline()
            if not raw_line:
                continue
            line = raw_line.decode("utf-8", errors="ignore").strip()
            if line:
                if line == ">":
                    continue
                reply_lines.append(line)
                if (line.startswith("OK:") or line.startswith("ERR:") or 
                    line == "PONG" or line.startswith("{")):
                    break

        return "\n".join(reply_lines) if reply_lines else ""

    def ping(self) -> bool:
        """Ping the arm driver."""
        res = self.send_raw("PING", timeout_s=1.0)
        return "PONG" in res

    def get_status(self) -> Dict[str, Any]:
        """Fetch current live state (joint angles, PWMs, claw percentage, mode)."""
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
        Set gripper / claw opening percentage.
        0.0 = Fully closed (PWM ~236)
        100.0 = Fully open (PWM ~440)
        """
        pct = max(0.0, min(100.0, float(pct)))
        res = self.send_raw(f"GRIP {pct:.1f}", timeout_s=3.0)
        ok = res.startswith("OK:")
        return ok, res

    def grip_open(self) -> Tuple[bool, str]:
        """Open gripper completely (100%)."""
        return self.gripper(100.0)

    def grip_close(self) -> Tuple[bool, str]:
        """Close gripper completely (0%)."""
        return self.gripper(0.0)

    def joints(self, base: float, shoulder: float, elbow: float, wrist: float) -> Tuple[bool, str]:
        """
        Move to explicit joint angles in degrees.
        
        CRITICAL SAFETY GUARDS:
          - Base: [0.0, 180.0]
          - Shoulder: [0.0, 180.0]
          - Elbow: LOCKED to [90.0, 180.0] - Mechanical interlock against gear breakage!
          - Wrist: [0.0, 180.0]
        """
        if not (LIMIT_BASE[0] <= base <= LIMIT_BASE[1]):
            raise ValueError(f"Base angle {base:.1f} deg out of range [{LIMIT_BASE[0]}, {LIMIT_BASE[1]}]")
        if not (LIMIT_SHOULDER[0] <= shoulder <= LIMIT_SHOULDER[1]):
            raise ValueError(f"Shoulder angle {shoulder:.1f} deg out of range [{LIMIT_SHOULDER[0]}, {LIMIT_SHOULDER[1]}]")
        if not (LIMIT_ELBOW[0] <= elbow <= LIMIT_ELBOW[1]):
            raise ValueError(
                f"SAFETY INTERLOCK TRIPPED: Elbow angle {elbow:.1f} deg is below safe minimum {LIMIT_ELBOW[0]} deg!\n"
                f"Elbow angle is physically restricted to [90.0, 180.0] to prevent mechanical damage."
            )
        if not (LIMIT_WRIST[0] <= wrist <= LIMIT_WRIST[1]):
            raise ValueError(f"Wrist angle {wrist:.1f} deg out of range [{LIMIT_WRIST[0]}, {LIMIT_WRIST[1]}]")

        res = self.send_raw(f"JOINTS {base:.1f} {shoulder:.1f} {elbow:.1f} {wrist:.1f}", timeout_s=4.0)
        ok = res.startswith("OK:")
        return ok, res

    def home(self) -> Tuple[bool, str]:
        """Return to safe home position (Base 90 deg, Shoulder 90 deg, Elbow 95 deg, Wrist 90 deg, Claw 100%)."""
        res = self.send_raw("HOME", timeout_s=3.0)
        ok = res.startswith("OK:")
        return ok, res

    def preset(self, name: str) -> Tuple[bool, str]:
        """Execute a predefined motion protocol (e.g. COBRA, GIMMEFIVE, HTL, HOME)."""
        name_clean = name.strip().upper()
        res = self.send_raw(f"PRESET {name_clean}", timeout_s=5.0)
        ok = res.startswith("OK:")
        return ok, res

    def exercise(self, name: str, reps: int = 3) -> Tuple[bool, str]:
        """Execute a rehab exercise routine (e.g. BICEP, REACH, WRIST, EXTEND, COMPOUND)."""
        reps = max(1, min(6, int(reps)))
        name_clean = name.strip().upper()
        res = self.send_raw(f"EXERCISE {name_clean} {reps}", timeout_s=6.0)
        ok = res.startswith("OK:")
        return ok, res

    def estop(self) -> Tuple[bool, str]:
        """Trigger emergency stop."""
        res = self.send_raw("ESTOP", timeout_s=1.0)
        return res.startswith("OK:"), res

    def release(self) -> Tuple[bool, str]:
        """De-energize all servo PWM outputs (arm goes limp)."""
        res = self.send_raw("RELEASE", timeout_s=1.0)
        return res.startswith("OK:"), res

    def set_dry_run(self, enable: bool) -> Tuple[bool, str]:
        """Enable or disable dry-run mode (simulates motion without PWM)."""
        arg = "ON" if enable else "OFF"
        res = self.send_raw(f"DRYRUN {arg}", timeout_s=1.0)
        return res.startswith("OK:"), res


def print_status_card(st: Dict[str, Any]):
    """Pretty-print telemetry status with clean ASCII framing."""
    if not st:
        print(f"{Fore.YELLOW}[WARN] Could not retrieve telemetry status.{Style.RESET_ALL}")
        return

    mode = st.get("mode", "unknown")
    angles = st.get("angles", [0, 0, 0, 0])
    pwms = st.get("pwm", [0, 0, 0, 0])
    claw = st.get("claw", 0.0)
    dry = st.get("dry_run", False)
    loaded = st.get("loaded", False)

    print(f"\n{Fore.CYAN}+--- ARMIC TELEMETRY -------------------------------------+{Style.RESET_ALL}")
    print(f"| {Fore.WHITE}Mode:{Style.RESET_ALL} {Fore.GREEN}{mode.upper():<10}{Style.RESET_ALL} | "
          f"{Fore.WHITE}Dry Run:{Style.RESET_ALL} {'YES' if dry else 'NO':<5} | "
          f"{Fore.WHITE}Loaded:{Style.RESET_ALL} {'YES' if loaded else 'NO':<5} |")
    print(f"+---------------------------------------------------------+")
    if len(angles) >= 4 and len(pwms) >= 4:
        print(f"|  Base     : {Fore.YELLOW}{angles[0]:>5.1f} deg{Style.RESET_ALL}  (PWM: {pwms[0]:>3})                        |")
        print(f"|  Shoulder : {Fore.YELLOW}{angles[1]:>5.1f} deg{Style.RESET_ALL}  (PWM: {pwms[1]:>3})                        |")
        print(f"|  Elbow    : {Fore.YELLOW}{angles[2]:>5.1f} deg{Style.RESET_ALL}  (PWM: {pwms[2]:>3}) [Lock >= 90.0 deg]     |")
        print(f"|  Wrist    : {Fore.YELLOW}{angles[3]:>5.1f} deg{Style.RESET_ALL}  (PWM: {pwms[3]:>3})                        |")
    print(f"+---------------------------------------------------------+")
    claw_state = "OPEN (100%)" if claw >= 95 else ("CLOSED (0%)" if claw <= 5 else f"{claw:.1f}%")
    print(f"|  Gripper  : {Fore.MAGENTA}{claw_state:<20}{Style.RESET_ALL}                    |")
    print(f"{Fore.CYAN}+---------------------------------------------------------+{Style.RESET_ALL}\n")


def interactive_cli(client: ArmicSerialClient):
    """Interactive command-line shell for controlling the arm."""
    print(f"\n{Fore.GREEN}{Style.BRIGHT}=== Armic 4DOF Robot Arm Serial Controller ==={Style.RESET_ALL}")
    print(f"Connected to port: {Fore.CYAN}{client.port}{Style.RESET_ALL} at 9600 baud")
    print(f"Type {Fore.YELLOW}help{Style.RESET_ALL} for command list, {Fore.YELLOW}exit{Style.RESET_ALL} to quit.\n")

    # Initial ping & status
    if client.ping():
        print(f"{Fore.GREEN}[OK] Hardware responsive (PONG received){Style.RESET_ALL}")
    st = client.get_status()
    print_status_card(st)

    while True:
        try:
            line = input(f"{Fore.BLUE}armic{Fore.WHITE}>{Style.RESET_ALL} ").strip()
        except (KeyboardInterrupt, EOFError):
            print("\nExiting.")
            break

        if not line:
            continue

        parts = line.split()
        cmd = parts[0].lower()
        args = parts[1:]

        if cmd in ("exit", "quit", "q"):
            print("Disconnecting...")
            break

        elif cmd == "help":
            print(f"""
{Fore.CYAN}Available Commands:{Style.RESET_ALL}
  {Fore.YELLOW}status / pos{Style.RESET_ALL}                   - Display current angles, PWMs, and claw state
  {Fore.YELLOW}home / park{Style.RESET_ALL}                    - Move safely to home pose (90 deg, 90 deg, 95 deg, 90 deg)
  {Fore.YELLOW}open{Style.RESET_ALL}                           - Fully open gripper (100%)
  {Fore.YELLOW}close{Style.RESET_ALL}                          - Fully close gripper (0%)
  {Fore.YELLOW}grip <0-100>{Style.RESET_ALL}                   - Set gripper percentage (e.g. grip 50)
  {Fore.YELLOW}joints <b> <s> <e> <w>{Style.RESET_ALL}         - Move joints in degrees (Elbow MUST be >= 90 deg)
  {Fore.YELLOW}cobra / gimmefive / htl{Style.RESET_ALL}        - Predefined motion protocols
  {Fore.YELLOW}preset <name>{Style.RESET_ALL}                  - Run named preset (cobra, gimmefive, htl, home)
  {Fore.YELLOW}exercise <name> [reps]{Style.RESET_ALL}        - Run rehab exercise (bicep, reach, wrist, extend)
  {Fore.YELLOW}estop{Style.RESET_ALL}                          - Immediate emergency stop
  {Fore.YELLOW}release{Style.RESET_ALL}                        - De-energize servo PWMs (free arm)
  {Fore.YELLOW}dryrun on/off{Style.RESET_ALL}                  - Enable/disable simulation mode
  {Fore.YELLOW}ping{Style.RESET_ALL}                           - Test serial link responsiveness
  {Fore.YELLOW}raw <command...>{Style.RESET_ALL}              - Send raw string to arm driver
""")

        elif cmd in ("status", "pos"):
            st = client.get_status()
            print_status_card(st)

        elif cmd in ("home", "park"):
            ok, msg = client.home()
            print(f"{Fore.GREEN if ok else Fore.RED}{msg}{Style.RESET_ALL}")

        elif cmd == "open":
            ok, msg = client.grip_open()
            print(f"{Fore.GREEN if ok else Fore.RED}{msg}{Style.RESET_ALL}")

        elif cmd == "close":
            ok, msg = client.grip_close()
            print(f"{Fore.GREEN if ok else Fore.RED}{msg}{Style.RESET_ALL}")

        elif cmd == "grip":
            if not args:
                print(f"{Fore.YELLOW}Usage: grip <open|close|0-100>{Style.RESET_ALL}")
                continue
            if args[0].lower() == "open":
                ok, msg = client.grip_open()
            elif args[0].lower() == "close":
                ok, msg = client.grip_close()
            else:
                try:
                    pct = float(args[0])
                    ok, msg = client.gripper(pct)
                except ValueError:
                    print(f"{Fore.RED}Invalid percentage: '{args[0]}'{Style.RESET_ALL}")
                    continue
            print(f"{Fore.GREEN if ok else Fore.RED}{msg}{Style.RESET_ALL}")

        elif cmd == "joints":
            if len(args) < 4:
                print(f"{Fore.YELLOW}Usage: joints <base> <shoulder> <elbow> <wrist>{Style.RESET_ALL}")
                continue
            try:
                b, s, e, w = float(args[0]), float(args[1]), float(args[2]), float(args[3])
                ok, msg = client.joints(b, s, e, w)
                print(f"{Fore.GREEN if ok else Fore.RED}{msg}{Style.RESET_ALL}")
            except ValueError as err:
                print(f"{Fore.RED}[SAFETY ERROR] {err}{Style.RESET_ALL}")

        elif cmd in [p.lower() for p in PRESETS]:
            ok, msg = client.preset(cmd)
            print(f"{Fore.GREEN if ok else Fore.RED}{msg}{Style.RESET_ALL}")

        elif cmd == "preset":
            if not args:
                print(f"{Fore.YELLOW}Usage: preset <name> (Allowed: {', '.join(PRESETS)}){Style.RESET_ALL}")
                continue
            ok, msg = client.preset(args[0])
            print(f"{Fore.GREEN if ok else Fore.RED}{msg}{Style.RESET_ALL}")

        elif cmd == "exercise":
            if not args:
                print(f"{Fore.YELLOW}Usage: exercise <name> [reps] (Allowed: {', '.join(EXERCISES)}){Style.RESET_ALL}")
                continue
            reps = 3
            if len(args) > 1:
                try:
                    reps = int(args[1])
                except ValueError:
                    print(f"{Fore.RED}Invalid reps: '{args[1]}'{Style.RESET_ALL}")
                    continue
            ok, msg = client.exercise(args[0], reps)
            print(f"{Fore.GREEN if ok else Fore.RED}{msg}{Style.RESET_ALL}")

        elif cmd == "estop":
            ok, msg = client.estop()
            print(f"{Fore.YELLOW}{msg}{Style.RESET_ALL}")

        elif cmd == "release":
            ok, msg = client.release()
            print(f"{Fore.YELLOW}{msg}{Style.RESET_ALL}")

        elif cmd == "dryrun":
            if not args or args[0].lower() not in ("on", "off"):
                print(f"{Fore.YELLOW}Usage: dryrun on|off{Style.RESET_ALL}")
                continue
            enable = args[0].lower() == "on"
            ok, msg = client.set_dry_run(enable)
            print(f"{Fore.GREEN if ok else Fore.RED}{msg}{Style.RESET_ALL}")

        elif cmd == "ping":
            ok = client.ping()
            print(f"{Fore.GREEN}PONG (OK){Style.RESET_ALL}" if ok else f"{Fore.RED}NO RESPONSE{Style.RESET_ALL}")

        elif cmd == "raw":
            raw_input = " ".join(args)
            reply = client.send_raw(raw_input)
            print(f"{Fore.WHITE}{reply}{Style.RESET_ALL}")

        else:
            reply = client.send_raw(line)
            if reply:
                print(f"{reply}")
            else:
                print(f"{Fore.RED}Unknown command: '{cmd}'. Type 'help' for commands.{Style.RESET_ALL}")

    client.close()


def main():
    parser = argparse.ArgumentParser(description="Armic 4DOF Serial Driver & CLI")
    parser.add_argument("--port", "-p", default=None, help="Serial port (default: auto-detect / COM8)")
    parser.add_argument("--baud", "-b", default=9600, type=int, help="Baud rate (default: 9600)")
    parser.add_argument("--cmd", "-c", default=None, help="Execute single command and exit")
    parser.add_argument("--status", action="store_true", help="Print status card and exit")
    parser.add_argument("--grip", type=str, default=None, help="Set gripper (open|close|0-100) and exit")
    args = parser.parse_args()

    client = ArmicSerialClient(port=args.port, baudrate=args.baud)

    if args.status:
        st = client.get_status()
        print_status_card(st)
        client.close()
        return

    if args.grip:
        if args.grip.lower() == "open":
            ok, msg = client.grip_open()
        elif args.grip.lower() == "close":
            ok, msg = client.grip_close()
        else:
            try:
                pct = float(args.grip)
                ok, msg = client.gripper(pct)
            except ValueError:
                print(f"[ERR] Invalid grip value: {args.grip}")
                client.close()
                sys.exit(1)
        print(msg)
        client.close()
        return

    if args.cmd:
        reply = client.send_raw(args.cmd)
        print(reply)
        client.close()
        return

    # Run interactive REPL
    interactive_cli(client)


if __name__ == "__main__":
    main()
