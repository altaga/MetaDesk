#!/bin/sh
# Boot one emulated board: the board API on the container's loopback, then the
# agent. Unpaired, the agent answers /setup for the desk wizard; once paired it
# dials out to the relay and proxies the desk to the API.
set -eu

STATE="$HOME/.config/metadesk"
mkdir -p "$STATE" "$HOME/data" "$HOME/workspace"

# Per-board secrets, generated once and kept on the board's volume. Never the
# defaults: the API signs operator tokens with JWT_SECRET, and the agent signs
# its proxied requests with the same one.
secret() {
  file="$STATE/$1"
  if [ ! -s "$file" ]; then
    python -c "import secrets; print(secrets.token_hex(32))" > "$file"
    chmod 600 "$file"
  fi
  cat "$file"
}
export JWT_SECRET="$(secret jwt-secret)"
export BOOTSTRAP_PASSWORD="$(secret operator-password)"

export STATE_DIR="$STATE"
export METADESK_STATE_DIR="$STATE"
export DATABASE_URL="sqlite:///$HOME/data/metadesk.db"
export DESK_ROOT="$HOME/workspace"
export LLM_MODE="${LLM_MODE:-cloud_only}"
export METADESK_BOARD_EMU=true
export METADESK_BOARD_URL="http://127.0.0.1:8000"
# Inside the container /setup listens on all interfaces; docker-compose only
# publishes it on the host's loopback (127.0.0.1:1800x), never on the LAN.
export METADESK_SETUP_HOSTS="0.0.0.0"

cd /opt/api
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 &
API_PID=$!
trap 'kill "$API_PID" 2>/dev/null || true' EXIT INT TERM

i=0
until python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=1)" 2>/dev/null; do
  i=$((i + 1))
  if [ "$i" -gt 60 ]; then
    echo "board API did not start" >&2
    exit 1
  fi
  sleep 0.5
done
echo "board API ready; starting the agent" >&2

cd /opt/agent
exec python -m metadesk_agent run
