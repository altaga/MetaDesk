#!/usr/bin/env bash
# The "broken app" demo on an emulated board.
#
#   ./demo/hero.sh setup   copy the Todo app into the board workspace and serve it
#                          on the board at http://127.0.0.1:5173 (Machine → Preview)
#   ./demo/hero.sh break   reintroduce the bug, ready for the next take
#   ./demo/hero.sh status  is it served, and is it broken?
#
# Run from apps/board-emu. CONTAINER defaults to emu-1's container.
set -euo pipefail

CONTAINER="${CONTAINER:-board-emu-emu-1-1}"
# Git Bash on Windows: keep container paths as written, and give docker cp a
# Windows path for this folder (pwd -W); elsewhere plain pwd.
export MSYS_NO_PATHCONV=1
HERE="$(cd "$(dirname "$0")" && (pwd -W 2>/dev/null || pwd))"
APP_DIR="/home/jetson/workspace/Projects/todo-app"
SERVE="/home/jetson/.local/share/metadesk-demo/serve.py"
PORT=5173

in_board() { docker exec -u jetson "$CONTAINER" bash -c "$1"; }

serve() {
  in_board "pkill -f '[m]etadesk-demo/serve.py' || true"
  docker exec -d -u jetson "$CONTAINER" python3 "$SERVE" "$APP_DIR" "$PORT"
}

break_app() {
  in_board "sed -i 's/^let items = saveItems(loadItems());/let items = saveItemz(loadItems());/' '$APP_DIR/app.js'"
}

case "${1:-}" in
  setup)
    in_board "mkdir -p '$APP_DIR' \"\$(dirname '$SERVE')\""
    docker cp "$HERE/todo-app/." "$CONTAINER:$APP_DIR/"
    docker cp "$HERE/serve.py" "$CONTAINER:$SERVE"
    docker exec -u 0 "$CONTAINER" chown -R jetson:jetson "$APP_DIR" "$(dirname "$SERVE")"
    break_app
    serve
    echo "Todo app (broken) served on the board at http://127.0.0.1:$PORT"
    ;;
  break)
    break_app
    in_board "pgrep -f '[m]etadesk-demo/serve.py' >/dev/null" || serve
    echo "Broken again: app.js calls saveItemz."
    ;;
  status)
    served=$(in_board "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$PORT/ || python3 -c \"import urllib.request;print(urllib.request.urlopen('http://127.0.0.1:$PORT/').status)\"" 2>/dev/null || echo down)
    broken=$(in_board "grep -c 'saveItemz' '$APP_DIR/app.js' || true")
    echo "served: $served  broken: $([ "$broken" -gt 0 ] && echo yes || echo no)"
    ;;
  *)
    echo "usage: $0 setup|break|status" >&2
    exit 2
    ;;
esac
