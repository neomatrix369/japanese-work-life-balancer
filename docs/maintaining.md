# Maintaining the Work-Life Balancer

Practical notes for people changing the code: the checks to run, the files to regenerate, and the traps the build
has already fallen into once. For first-time setup see the [README](../README.md#quick-start); for ElevenLabs and
Timefold accounts see [external-services.md](external-services.md).

## Toolchain traps

| Trap | Symptom | Fix |
|---|---|---|
| An old Maven earlier on `PATH` (e.g. `/opt/apache-maven-3.6.3`) | `make setup` stops with "Maven 3.9+ required" and lists every `mvn` it found | Put Homebrew's first on `PATH`, or pass `MVN=/opt/homebrew/bin/mvn` to every `make setup` / `demo` / `model` / `test` |
| Pulled new commits, then `npm run build` or the UI fails on a missing module | A dependency was added (e.g. `@types/node`) | Re-run `make setup` after every pull; it is safe to repeat |
| Ubuntu/Debian `apt install maven nodejs` | `make check` reports Maven 3.8.x or Node 18.x | apt's versions are too old; use the official downloads in [install-tools.md](install-tools.md#linux-ubuntu-2404--debian) |
| JDK 21 installed by IntelliJ in `~/.jdks/` | `/usr/libexec/java_home -v 21` finds nothing, because macOS only lists JDKs in `/Library/Java/JavaVirtualMachines` | `make setup JAVA_HOME=$HOME/.jdks/<jdk-21-folder>/Contents/Home`, or install with `brew install openjdk@21` |
| `make test` while the demo runs | Tests (on port 8084) recompile into the same `model/target/` that the running dev-mode model hot-reloads from | Stop `make demo` first, run `make test`, then start the demo again |

## Ports and stale processes

`make demo` writes logs to `.logs/model.log`, `.logs/ui.log` and `.logs/mcp.log`. Before starting, it checks
:8083, :5173 and :8765; if any is busy it prints the PID and command holding it and exits, rather than starting a
second UI on :5174 next to a stale backend. Vite also runs with `strictPort`. Ctrl-C stops the whole process tree
(`npm`/`mvn`/`uv` *and* the vite/java/python servers they start, which used to be left behind).

`make stop` frees all three ports. Two copies usually mean a second `make demo` from another terminal or IDE
(for example Antigravity) in the same folder. Find who started one with `ps -o pid,ppid,lstart,command -p <PID>`,
following the parent PIDs up the chain.

## Before merging a UI change

```bash
cd ui && npm test && npx tsc --noEmit && npm run build
```

Then look at it in a real browser at **1280 px** and **390 px** wide, especially the tour overlay and the solver
replay bar. Visual changes go in [`ui/src/theme.css`](../ui/src/theme.css) (loaded last, overrides only) using the
tokens in [`design-system/MASTER.md`](../design-system/MASTER.md); no hex values in components. Markup changes belong
in the component.

## Working on the UI without breaking the live demo

Do UI work in a **git worktree**, not in the folder the demo runs from; hot reload and half-saved files otherwise hit
whoever is presenting.

```bash
git worktree add ../jwlb-ui-work -b fix/my-change main
cd ../jwlb-ui-work/ui && npm install          # gives the worktree its own node_modules
npx vite --port 5180 --strictPort             # proxies /api to the running model on :8083
```

If you symlink `ui/node_modules` from the main checkout instead, `npm install` in the worktree replaces the link with
a real folder, so the two copies drift. Either way, stage explicit paths (`git add ui/src/...`), never `git add -A`,
so a stray `node_modules` link is never committed. Remove the worktree with `git worktree remove ../jwlb-ui-work`.

## Regenerating generated files

| What | When | How |
|---|---|---|
| Scenario data (`data-gen/out/*.json`) | Generator changed | `make data` (seeded, so output is repeatable) |
| Tour fallback fixtures (`ui/src/tour/fixtures/`) | Model, scenarios or KPIs changed | Model running, then `cd ui && node scripts/record-tour-fixtures.mjs`; commit the fixtures with the change |
| UI screenshots (`docs/screenshots/02-…05-*/`) | Visible UI changed | Demo running, then `uv run --no-project --with playwright python scripts/capture-gallery.py`; check the images, update captions in [`docs/screenshots/README.md`](screenshots/README.md) if the numbers changed |
| CLI screenshots (`docs/screenshots/01-cli/`) | `make help` or the REST output changed | `freeze --execute "make help" --window -o docs/screenshots/01-cli/01-make-help.png` ([freeze](https://github.com/charmbracelet/freeze)) |
| Spoken tour audio (`ui/.tts-cache/`) | Never committed | Delete the folder to force fresh audio |

## Automated browser checks

Headless Chrome on macOS speaks through the real speakers. Any Playwright or Puppeteer script must stub
`window.speechSynthesis` and block `/tts` (see the top of [`scripts/capture-gallery.py`](../scripts/capture-gallery.py)).
The app stores its theme in `localStorage`, not the OS setting, so emulating `prefers-color-scheme: dark` does nothing;
click the **Dark theme** button instead.

## Secrets

- ElevenLabs and Gemini keys: `ui/.env.local` or your shell, never a committed file. `.env`, `.env.local` and `*.pem` are git-ignored.
- Timefold license: outside the repo (`~/timefold-license.pem`, `TIMEFOLD_LICENSE_PATH` or `TIMEFOLD_LICENSE`).
- Commits are scanned by gitleaks when the local pre-commit hook is installed.

## Looking things up

- Timefold API questions: [`docs.timefold.ai/llms.txt`](https://docs.timefold.ai/llms.txt) indexes every Solver page;
  more links in [external-services.md](external-services.md#useful-timefold-links).
- Why the model is shaped the way it is: [`model/README.md`](../model/README.md) and the build spec in
  [`docs/plan/claude-code-prompt.md`](plan/claude-code-prompt.md), which wins where it differs from the PRD.
