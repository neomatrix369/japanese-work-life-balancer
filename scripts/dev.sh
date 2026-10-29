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

# ── cleanup ────────────────────────────────────────────────────────────────────

cleanup() {
  printf '\nStopping services...\n'
  [ -n "${MODEL_PID:-}" ] && kill "${MODEL_PID}" 2>/dev/null || true
  [ -n "${UI_PID:-}"    ] && kill "${UI_PID}"    2>/dev/null || true
  [ -n "${MCP_PID:-}"   ] && kill "${MCP_PID}"   2>/dev/null || true
  # Give processes a moment; force-kill stragglers.
  sleep 1
  [ -n "${MODEL_PID:-}" ] && kill -9 "${MODEL_PID}" 2>/dev/null || true
  [ -n "${UI_PID:-}"    ] && kill -9 "${UI_PID}"    2>/dev/null || true
  [ -n "${MCP_PID:-}"   ] && kill -9 "${MCP_PID}"   2>/dev/null || true
  printf 'Stopped.\n'
}
trap cleanup EXIT INT TERM

# ── toolchain ─────────────────────────────────────────────────────────────────

MVN="${MVN:-mvn}"
ENTERPRISE="${ENTERPRISE:-}"
# shellcheck disable=SC2086
MVN_FLAGS="${ENTERPRISE:+-Denterprise}"
MODEL_PORT="${MODEL_PORT:-8083}"

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
