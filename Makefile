# Japanese Work-Life Balancer — one-command targets.
# Skeleton from Phase 0/1: `model` and `test` work now; the rest are filled in Phase 5.

# Maven needs JDK 21+. Override if your default java is older, e.g.
#   make model JAVA_HOME=/opt/homebrew/opt/openjdk@25 MVN=/opt/homebrew/bin/mvn
MVN ?= mvn
# Set ENTERPRISE=1 to use the licensed edition (needs $$TIMEFOLD_LICENSE_PATH). Community works without it.
ENTERPRISE ?=
MVN_FLAGS := $(if $(ENTERPRISE),-Denterprise,)

.PHONY: setup data model ui mcp demo test clean

setup:
	@echo "TODO(Phase 5): check java>=21, mvn, node>=20, python3>=3.11; npm install in ui/; create mcp env"

data:
	@echo "TODO(Phase 5): python3 data-gen/generate.py --seed 42 --out data-gen/out && cp data-gen/out/tiny.json model/src/test/resources/"

model:
	cd model && $(MVN) $(MVN_FLAGS) quarkus:dev

ui:
	@echo "TODO(Phase 5): cd ui && npm run dev"

mcp:
	@echo "TODO(Phase 5): run the MCP server on :8765"

demo:
	@echo "TODO(Phase 5): scripts/dev.sh (data, model, wait for /demo-data, ui, mcp; trap on Ctrl-C)"

test:
	cd model && $(MVN) $(MVN_FLAGS) test

clean:
	rm -rf model/target data-gen/out
