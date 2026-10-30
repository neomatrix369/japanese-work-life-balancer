# Makefile — Japanese Work-Life Balancer
# All targets run from the project root.
#
# Toolchain overrides (command-line or environment):
#   make model JAVA_HOME=/opt/homebrew/opt/openjdk@21
#   make model MVN=/usr/local/bin/mvn
#   make mcp MODEL_URL=http://localhost:8083

MVN        ?= mvn
ENTERPRISE ?=
MVN_FLAGS  := $(if $(ENTERPRISE),-Denterprise,)

# Export JAVA_HOME so Maven picks it up when overridden on the command line.
ifneq ($(JAVA_HOME),)
  export JAVA_HOME
endif

.DEFAULT_GOAL := help
.PHONY: help check setup data model ui mcp demo test clean

# ── help (default) ────────────────────────────────────────────────────────────

help:
	@printf '\nJapanese Work-Life Balancer — Makefile targets\n'
	@printf '===============================================\n'
	@printf '  check   verify JDK>=21, Maven>=3.9, Node>=20, Python3>=3.11, free ports,\n'
	@printf '          Timefold license + ElevenLabs key status (installs nothing)\n'
	@printf '  setup   check, then install npm + Python deps (safe to re-run after a pull)\n'
	@printf '  data    generate synthetic JSON scenarios -> data-gen/out/\n'
	@printf '  model   start Quarkus solver on :8083  (keep terminal open)\n'
	@printf '  ui      start Vite dev server on :5173  (keep terminal open)\n'
	@printf '  mcp     start MCP server on :8765       (keep terminal open)\n'
	@printf '  demo    data + model + ui + mcp; Ctrl-C stops all\n'
	@printf '  test    run model unit tests (model must NOT be running)\n'
	@printf '  clean   remove build outputs and data-gen/out/\n'
	@printf '\nToolchain overrides:\n'
	@printf '  make model JAVA_HOME=/opt/homebrew/opt/openjdk@21\n'
	@printf '  make model MVN=/usr/local/bin/mvn\n'
	@printf '  make mcp MODEL_URL=http://localhost:8083\n'
	@printf '  make demo ENTERPRISE=1    Timefold Enterprise (needs a license; also: make model ENTERPRISE=1)\n'
	@printf '\nTour voice (optional): ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, ELEVENLABS_MODEL_ID\n'
	@printf '  put them in ui/.env.local — see docs/external-services.md\n\n'

# ── setup ─────────────────────────────────────────────────────────────────────

INSTALL_HELP := see docs/install-tools.md

# ── check (versions, ports, optional services — installs nothing) ─────────────

check:
	@echo "==> Checking tool versions..."
	@# Java >=21 — use $JAVA_HOME/bin/java when JAVA_HOME is set ------------------
	@if [ -n "$${JAVA_HOME:-}" ]; then _jcmd="$$JAVA_HOME/bin/java"; else _jcmd="java"; fi; \
	if ! $$_jcmd -version 2>&1 | grep -qE '"(2[1-9]|[3-9][0-9])(\.|")'; then \
	  echo "ERROR: JDK 21+ required."; \
	  echo "       Found: $$($$_jcmd -version 2>&1 | head -1)"; \
	  echo "       Fix: export JAVA_HOME=\$$(/usr/libexec/java_home -v 21)   (macOS)"; \
	  echo "            sudo apt-get install -y openjdk-21-jdk                (Ubuntu/Debian)"; \
	  echo "       Or:  make setup JAVA_HOME=/path/to/jdk-21   ($(INSTALL_HELP))"; \
	  exit 1; \
	fi; \
	echo "  java:    OK ($$($$_jcmd -version 2>&1 | head -1))"
	@# Maven >=3.9 -------------------------------------------------------------
	@$(MVN) -version >/dev/null 2>&1 \
	  || { echo "ERROR: Maven not found (looked for '$(MVN)'). Install Maven 3.9+ ($(INSTALL_HELP))."; exit 1; }
	@$(MVN) -version 2>&1 | grep -qE 'Apache Maven (3\.(9|[1-9][0-9])|[4-9])\.' \
	  || { echo "ERROR: Maven 3.9+ required. Found: $$($(MVN) -version 2>&1 | head -1)"; \
	       echo "       Other mvn on PATH: $$(which -a mvn 2>/dev/null | tr '\n' ' ')"; \
	       echo "       Fix: put a newer one first on PATH, or pass it:  make setup MVN=/path/to/mvn   ($(INSTALL_HELP))"; exit 1; }
	@echo "  mvn:     OK ($$($(MVN) -version 2>&1 | awk '/Apache Maven/{print $$3}'))"
	@# Node >=20 ---------------------------------------------------------------
	@node --version 2>/dev/null | grep -qE '^v(2[0-9]|[3-9][0-9])\.' \
	  || { echo "ERROR: Node 20+ required. Found: $$(node --version 2>/dev/null || echo 'not found')   ($(INSTALL_HELP))"; exit 1; }
	@echo "  node:    OK ($$(node --version))"
	@# Python >=3.11 -----------------------------------------------------------
	@python3 --version 2>&1 | grep -qE 'Python 3\.(1[1-9]|[2-9][0-9])\.' \
	  || { echo "ERROR: Python 3.11+ required. Found: $$(python3 --version 2>&1)   ($(INSTALL_HELP))"; exit 1; }
	@echo "  python3: OK ($$(python3 --version 2>&1))"
	@command -v uv >/dev/null 2>&1 && echo "  uv:      OK ($$(uv --version))" \
	  || echo "  uv:      not found — optional; setup falls back to python3 -m venv"
	@# Ports — a leftover demo makes Vite move to 5174 and breaks the UI's /api proxy
	@for p in 8083 5173 5174 8765; do \
	  if curl -s -o /dev/null -m 1 "http://localhost:$$p/"; then \
	    echo "  port $$p: IN USE — fine if your demo is running; otherwise stop it (docs/maintaining.md#ports-and-stale-processes)"; \
	  fi; \
	done
	@# Optional services — report only, never fail -----------------------------
	@# TIMEFOLD_LICENSE holds the PEM text itself (never echoed); the others are file paths.
	@_lic=""; \
	[ -n "$${TIMEFOLD_LICENSE_PATH:-}" ] && [ -f "$$TIMEFOLD_LICENSE_PATH" ] && _lic="TIMEFOLD_LICENSE_PATH ($$TIMEFOLD_LICENSE_PATH)"; \
	[ -z "$$_lic" ] && [ -n "$${TIMEFOLD_LICENSE:-}" ] && _lic="TIMEFOLD_LICENSE (PEM contents)"; \
	[ -z "$$_lic" ] && [ -f "$$HOME/timefold-license.pem" ] && _lic="$$HOME/timefold-license.pem"; \
	if [ -n "$$_lic" ]; then \
	  echo "  Timefold license: found in $$_lic"; \
	  echo "           Only used by the Enterprise build:  make demo ENTERPRISE=1"; \
	else \
	  echo "  Timefold license: none — fine, the default Community edition needs none."; \
	  echo "           (Broken-constraints match counts show '-' in the UI.) Enterprise: docs/external-services.md"; \
	fi
	@if [ -n "$${ELEVENLABS_API_KEY:-}" ] || grep -qs '^ELEVENLABS_API_KEY=.' ui/.env.local ui/.env; then \
	  echo "  ElevenLabs key: set — the tour uses the premium voice"; \
	else \
	  echo "  ElevenLabs key: none — fine, the tour uses your browser's voice. Premium voice: docs/external-services.md"; \
	fi

# ── setup ─────────────────────────────────────────────────────────────────────

setup: check
	@echo ""
	@echo "==> Installing ui/ npm dependencies..."
	cd ui && npm install
	@echo ""
	@echo "==> Installing mcp/ Python dependencies..."
	@if command -v uv >/dev/null 2>&1; then \
	  cd mcp && uv sync; \
	else \
	  echo "  uv not found — falling back to venv + pip"; \
	  python3 -m venv mcp/.venv; \
	  mcp/.venv/bin/pip install -q \
	    "httpx>=0.27.0" "mcp>=2.0.0,<3.0.0" \
	    "pytest>=8.0.0" "pytest-asyncio>=0.23.0"; \
	fi
	@echo ""
	@echo "==> Setup complete. Run:  make demo   (then open http://localhost:5173)"

# ── data ──────────────────────────────────────────────────────────────────────
#
# NOTE: The generated tiny.json is NOT copied to model/src/test/resources/.
# That file is a hand-written fixture (8 employees, ~40 tasks, 1 pinned) that
# the ConstraintVerifier and integration tests depend on. Silently overwriting
# it would break tests. The generated tiny.json lives only in data-gen/out/.
#
# To replace the test fixture intentionally (review the diff first!):
#   cp data-gen/out/tiny.json model/src/test/resources/tiny.json

data:
	@mkdir -p data-gen/out
	python3 data-gen/generate.py --seed 42 --out data-gen/out
	@echo ""
	@echo "Scenarios written to data-gen/out/"
	@echo "NOTE: model/src/test/resources/tiny.json is unchanged (hand-written test fixture)."

# ── model ─────────────────────────────────────────────────────────────────────

model:
	cd model && $(MVN) $(MVN_FLAGS) quarkus:dev

# ── ui ────────────────────────────────────────────────────────────────────────

ui:
	cd ui && npm run dev

# ── mcp ───────────────────────────────────────────────────────────────────────

mcp:
	@if command -v uv >/dev/null 2>&1; then \
	  cd mcp && uv run python server.py; \
	else \
	  cd mcp && .venv/bin/python server.py; \
	fi

# ── demo ──────────────────────────────────────────────────────────────────────

demo: data
	@bash scripts/dev.sh

# ── test ──────────────────────────────────────────────────────────────────────

test:
	cd model && $(MVN) $(MVN_FLAGS) test

# ── clean ─────────────────────────────────────────────────────────────────────

clean:
	rm -rf model/target ui/dist data-gen/out
	@echo "Cleaned: model/target  ui/dist  data-gen/out"
