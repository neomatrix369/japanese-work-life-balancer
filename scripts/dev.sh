#!/usr/bin/env bash
# scripts/dev.sh — start model, ui, and mcp together.
# Called by `make demo` after `make data` has already run.
# Press Ctrl-C to stop all services.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOGS_DIR="$PROJECT_ROOT/.logs"
mkdir -p "$LOGS_DIR"

MODEL_PID=""
UI_PID=""
MCP_PID=""

MVN="${MVN:-mvn}"
ENTERPRISE="${ENTERPRISE:-}"
# shellcheck disable=SC2086
MVN_FLAGS="${ENTERPRISE:+-Denterprise}"
MODEL_PORT="${MODEL_PORT:-8083}"
UI_PORT=5173
MCP_PORT=8765

# ── pre-flight: refuse to start a second copy ─────────────────────────────────
# Without this, Vite quietly moves to :5174 and the model/MCP fail, while the old copy
# keeps answering — two UIs, one stale backend.

busy=0
for port in "${MODEL_PORT}" "${UI_PORT}" "${MCP_PORT}"; do
  pids="$(lsof -ti "tcp:${port}" -sTCP:LISTEN 2>/dev/null || true)"
  [ -z "${pids}" ] && continue
  busy=1
  for pid in ${pids}; do
    printf 'ERROR: port %s is already in use by PID %s: %s\n' "${port}" "${pid}" \
      "$(ps -o command= -p "${pid}" 2>/dev/null | cut -c1-110)"
  done
done
if [ "${busy}" -eq 1 ]; then
  printf '       Another copy of the app (or something else) is running. Stop it with:  make stop\n'
  exit 1
fi

# ── cleanup ────────────────────────────────────────────────────────────────────

# npm, mvn and uv start the real servers (vite, java, python) as child processes;
# killing only the launcher leaves those holding the ports. Kill the whole tree.
kill_tree() {
  local sig="$1" pid="$2" child
  for child in $(pgrep -P "${pid}" 2>/dev/null || true); do
    kill_tree "${sig}" "${child}"
  done
  kill "-${sig}" "${pid}" 2>/dev/null || true
}

cleanup() {
  trap - EXIT INT TERM
  printf '\nStopping services...\n'
  for pid in "${MODEL_PID}" "${UI_PID}" "${MCP_PID}"; do
    [ -n "${pid}" ] && kill_tree TERM "${pid}"
  done
  # Give processes a moment; force-kill stragglers.
  sleep 2
  for pid in "${MODEL_PID}" "${UI_PID}" "${MCP_PID}"; do
    [ -n "${pid}" ] && kill_tree KILL "${pid}"
  done
  printf 'Stopped.\n'
}
trap cleanup EXIT INT TERM

# ── start model ───────────────────────────────────────────────────────────────

printf '==> Starting model (Quarkus on :%s)...\n' "${MODEL_PORT}"
(
  cd "${PROJECT_ROOT}/model"
  # shellcheck disable=SC2086
  exec ${MVN} ${MVN_FLAGS} quarkus:dev
) > "${LOGS_DIR}/model.log" 2>&1 &
MODEL_PID=$!

# ── wait for model ────────────────────────────────────────────────────────────

printf '==> Waiting for model to be ready (up to 120 s)...\n'
ELAPSED=0
TIMEOUT=120
while ! curl -sf "http://localhost:${MODEL_PORT}/demo-data" >/dev/null 2>&1; do
  sleep 2
  ELAPSED=$((ELAPSED + 2))
  if [ "${ELAPSED}" -ge "${TIMEOUT}" ]; then
    printf '\nERROR: Model did not respond after %d s.\n' "${TIMEOUT}"
    printf '       Check the log:\n'
    printf '         tail -50 %s/model.log\n' "${LOGS_DIR}"
    exit 1
  fi
  printf '  ... %d s (waiting for Quarkus)\r' "${ELAPSED}"
done
printf '\n==> Model is ready.\n'

# ── start ui ──────────────────────────────────────────────────────────────────

printf '==> Starting UI (Vite on :5173)...\n'
(
  cd "${PROJECT_ROOT}/ui"
  exec npm run dev
) > "${LOGS_DIR}/ui.log" 2>&1 &
UI_PID=$!

# ── start mcp ─────────────────────────────────────────────────────────────────

printf '==> Starting MCP server (on :8765)...\n'
(
  cd "${PROJECT_ROOT}/mcp"
  if command -v uv >/dev/null 2>&1; then
    exec uv run python server.py
  else
    exec .venv/bin/python server.py
  fi
) > "${LOGS_DIR}/mcp.log" 2>&1 &
MCP_PID=$!

# ── report ────────────────────────────────────────────────────────────────────

cat <<'BANNER'

================================================
  All services are running.

  UI:    http://localhost:5173
  Model: http://localhost:8083  (REST API)
  MCP:   http://localhost:8765/mcp

  Logs (tail -f .logs/*.log):
    .logs/model.log
    .logs/ui.log
    .logs/mcp.log

  Register MCP with Claude Code (once):
    claude mcp add --transport http jwlb http://localhost:8765/mcp

  Ctrl-C to stop all services.
================================================

BANNER

# ── keep alive ────────────────────────────────────────────────────────────────

# Wait for the model process. If it exits unexpectedly the EXIT trap cleans up.
wait "${MODEL_PID}" || true
