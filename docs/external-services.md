# Setting up the external services

The app runs fully offline with no accounts at all: the solver uses Timefold's free Community Edition and the
guided tour falls back to your browser's built-in voice. This page covers the two **optional** services that live
outside this repo, what each one adds, and exactly how to set it up.

[← Back to the main README](../README.md)

| Service | Needed? | What it adds | Cost |
|---|---|---|---|
| [ElevenLabs](#elevenlabs-premium-tour-voice) | Optional | A natural narrator voice for the **▶ Play demo** tour | Free tier works for a demo; [paid plans](https://elevenlabs.io/pricing) for more characters or commercial use |
| [Gemini](#gemini-tour-voices) | Optional | Two more tour voices: Gemini TTS, and Gemini Argon commentary | Billed per use on the Gemini API ([pricing](https://ai.google.dev/pricing)); cached lines cost nothing |
| [Timefold Enterprise](#timefold-solver-community-or-enterprise) | Optional | Exact per-constraint match counts in **Broken constraints** (Community shows "–") | Free time-limited trial; licence needs a company email |

---

## ElevenLabs (premium tour voice)

The tour works without ElevenLabs: if no key is set, or ElevenLabs fails or takes longer than 4 s, your browser's own
British voice reads the tour and the tour controls show a small "browser voice" note.

### 1. Create an account

Sign up at [elevenlabs.io](https://elevenlabs.io/). The free tier gives a monthly character allowance, which is
enough for several runs of the tour. Audio is cached on disk (see [Cost and caching](#cost-and-caching)), so replays
cost only the lines that read live numbers. Before publishing any recorded audio (e.g. a demo video), check the
free-tier attribution and commercial-use terms on the [pricing page](https://elevenlabs.io/pricing).

### 2. Create an API key with the right permissions

1. Open **[API keys](https://elevenlabs.io/app/api/api-keys)** in the dashboard and click **Create API key**.
2. Give it a name such as `work-life-balancer-local`.
3. Restrict it to what the app needs:

   | Permission | Why |
   |---|---|
   | **Text to Speech** | Required — the only endpoint the app calls |
   | **Voices: Read** | Recommended — lets you list voices with `curl` (below) |
   | Models: Read, User: Read | Optional |
   | Everything else | Leave off |

4. Optionally set a **credit limit** on the key so a runaway loop can't drain your quota
   ([key restrictions](https://elevenlabs.io/docs/api-reference/authentication)).
5. Copy the key. It is shown only once.

### 3. Pick a voice (optional)

The default voice is **Lily** (`pFZP5JQG7iQjIQuC4Bku`), a warm British narrator. To use another:

1. Browse the **[Voice Library](https://elevenlabs.io/app/voice-library)**. A Japanese-accented English voice suits this app.
2. Click **Add to my voices**. A Library voice must be in **My Voices** before the API can use it.
3. Open the voice's **⋯** menu and choose **Copy voice ID**.

Or list the voices your key can use (needs **Voices: Read**):

```bash
curl -s -H "xi-api-key: $ELEVENLABS_API_KEY" https://api.elevenlabs.io/v1/voices \
  | jq '.voices[] | {name, voice_id}'
```

The default model is `eleven_multilingual_v2`, which pronounces Japanese names well. Other models are listed in
the [models guide](https://elevenlabs.io/docs/models).

### 4. Tell the app

Create **`ui/.env.local`** (git ignores it; never commit a key):

```dotenv
ELEVENLABS_API_KEY=sk_your_key_here
# Optional — defaults shown
# ELEVENLABS_VOICE_ID=pFZP5JQG7iQjIQuC4Bku
# ELEVENLABS_MODEL_ID=eleven_multilingual_v2
```

Where the app looks, highest priority first:

1. Shell environment (`export ELEVENLABS_API_KEY=…` in `~/.zshrc`, or `ELEVENLABS_VOICE_ID=… make demo`)
2. `ui/.env.local`
3. `ui/.env`
4. Built-in defaults (Lily, `eleven_multilingual_v2`, no key)

### 5. Restart and check

The voice and model are read **once when the UI server starts**, so restart `make demo` (or `make ui`) after any change.
Then confirm what the server picked up:

```bash
grep '\[tts\]' .logs/ui.log          # e.g. [tts] voice=pFZP5JQG7iQjIQuC4Bku model=eleven_multilingual_v2 apiKey=present
curl -s localhost:5173/tts            # {"voiceId":"…","modelId":"…"}
```

`apiKey=MISSING` means the key wasn't found in any of the four places above.

**Test the key end to end** (speaks one word, about 5 characters of quota):

```bash
curl -s -X POST localhost:5173/tts -H 'Content-Type: application/json' -d '{"text":"Hello"}' \
  -o /tmp/tts-test.mp3 -w '%{http_code} %{content_type}\n'
```

`200 audio/mpeg` means the key, voice and model all work; open `/tmp/tts-test.mp3` to hear the voice. Any other
answer is JSON with an error code, explained in the table below.

### Troubleshooting ElevenLabs

| Symptom | Likely cause | Fix |
|---|---|---|
| Tour says "browser voice" | No key, wrong key, or ElevenLabs slow/unreachable | Check `elevenLabsKey=present` in `.logs/ui.log`; check the [status page](https://status.elevenlabs.io/) |
| Wrong voice plays after changing `ELEVENLABS_VOICE_ID` | UI server still running with the old setting, or an exported shell variable overrides `ui/.env.local` | Restart `make demo`; run `echo $ELEVENLABS_VOICE_ID` to spot a shell override |
| `[tts] upstream 401 invalid_api_key` in `.logs/ui.log` | Key revoked, mistyped, or has stray quotes/spaces | Create a new key and paste it again |
| `[tts] upstream 401` with a permissions code | Key lacks **Text to Speech** | Edit the key's permissions on the [API keys page](https://elevenlabs.io/app/api/api-keys) |
| `[tts] upstream 404 voice_not_found` | Voice ID typo, or a Library voice not added to **My Voices** | Add it to My Voices, re-copy the ID |
| `[tts] upstream 400 model_not_found` | `ELEVENLABS_MODEL_ID` typo | Remove it to use the default, or pick one from the [models guide](https://elevenlabs.io/docs/models) |
| `[tts] upstream 429` or a quota code | Monthly characters used up, or too many requests | Wait for the reset or [upgrade](https://elevenlabs.io/pricing); cached lines still play |

The 401, 404 and 400 lines above are the real responses (checked against the live API). The permission and quota
rows follow ElevenLabs' documented behaviour but were not triggered here.

### Cost and caching

Each spoken line is cached as an MP3 in `ui/.tts-cache/` (git-ignored), keyed by voice, model, voice settings and
text. On a replay, the fixed lines come from the cache; lines that read live solver numbers ("Right now: 22 people
at risk…") differ every run and are fetched again. Switching voices never replays old audio. Delete the folder to
free disk space or force fresh audio. The app also caps itself at 30 ElevenLabs calls per minute (cache hits don't count).

**The key never reaches the browser.** The browser posts text to `POST /tts` on the Vite dev server, and only the
server calls ElevenLabs. The key is not in the built bundle.

---

## Gemini (tour voices)

Adds two choices to the **Voice** dropdown (top bar, and next to 🔊 in the tour controls):

- **Gemini**: `gemini-3.8-flash-tts` reads the step text in the `Aoede` voice.
- **Gemini Argon**: `gemini-4-argon` first rewrites the step as one or two spoken sentences about wellbeing and rest,
  then Gemini TTS reads that. If Argon fails, the original step text is spoken instead.

ElevenLabs stays the default whenever its key is set; Gemini only speaks when picked (or when it is the only key, or
`TTS_PROVIDER=gemini`).

**Set-up.**

1. Create a key in [Google AI Studio → API keys](https://aistudio.google.com/apikey).
2. Put it in your shell (`export GEMINI_API_KEY=…`) or in `ui/.env.local` (git-ignored): `GEMINI_API_KEY=your_key_here`.
3. Restart `make demo` and check `.logs/ui.log` for `geminiKey=present`, or run `curl -s localhost:5173/tts`
   (Gemini shows `"configured":true`).

**Speed and rehearsal.** Measured on 2026-10-31: Gemini took ~3–4 s for a first-time line; Argon took 7–17 s (it
writes the line before speaking it). The tour waits up to 10 s for Gemini and 25 s for Argon before the browser voice
takes over. Every line is cached in `ui/.tts-cache/`, so **play the tour once per voice before the real demo** and the
second run is instant.

**The key never reaches the browser.** The server sends it in the `x-goog-api-key` header (never in a URL). Gemini
lines share the app's 30-lines-per-minute cap with ElevenLabs (cache hits don't count).

---

## Timefold Solver (Community or Enterprise)

The model uses [Timefold Solver](https://timefold.ai/) 2.7 inside [Quarkus](https://quarkus.io/), started from the
[employee-scheduling quickstart](https://github.com/TimefoldAI/timefold-quickstarts/tree/stable/use-cases/employee-scheduling).

### Community Edition (default — nothing to set up)

`make demo` and `make model` use the open-source Community Edition. No account, licence or Maven credentials are
needed. **A licence file has no effect in this mode.** The one visible difference from Enterprise: in
**Broken constraints**, the match count column shows "–", because
[score analysis](https://docs.timefold.ai/timefold-solver/latest/constraints-and-score/understanding-the-score.html)
match details are an Enterprise feature. The app works around it by re-scoring once per constraint.

You do need the toolchain: **JDK 21+** and **Maven 3.9+** (`make setup` checks both). On macOS:

```bash
brew install openjdk@21 maven       # or use SDKMAN: https://sdkman.io/
export JAVA_HOME=$(/usr/libexec/java_home -v 21)
```

### Enterprise Edition (optional)

1. **Get a licence.** Register at the **[Timefold License Manager](https://licenses.timefold.ai/)**. Registration
   needs a **company email** (Gmail, Hotmail, Yahoo and similar are refused). Every new account gets a free,
   time-limited Enterprise trial. Then go to **Licenses → Add license key → Download license key** to get a `.pem`
   file ([licence management guide](https://docs.timefold.ai/timefold-solver/latest/commercial-editions/license-management.html)).
   Hackathon organisers may hand out licences instead.
2. **Put the licence where Timefold looks** ([installation guide](https://docs.timefold.ai/timefold-solver/latest/commercial-editions/installation.html)),
   any one of:

   | Option | Example |
   |---|---|
   | File in your home folder | `~/timefold-license.pem` (exact name) |
   | Absolute path in an env var | `export TIMEFOLD_LICENSE_PATH=/Users/you/secrets/timefold-license.pem` |
   | Licence **contents** in an env var | `export TIMEFOLD_LICENSE="$(cat /path/to/timefold-license.pem)"` |

   `TIMEFOLD_LICENSE` holds the PEM text itself, not a path. Never commit the file; `.gitignore` already excludes `*.pem`.
3. **Run the Enterprise build:**

   ```bash
   make demo ENTERPRISE=1         # whole stack; or just the model: make model ENTERPRISE=1
   ```

   This turns on the `enterprise` Maven profile, which swaps in the `ai.timefold.solver.enterprise` artifacts. They
   come from Maven Central, so no extra Maven repository or credentials are needed. The same flag works for the
   whole stack: `make demo ENTERPRISE=1`.
4. **Check it worked.** `.logs/model.log` shows
   `Detected Timefold Solver Enterprise` and `Using Timefold Solver Enterprise Edition v2.7.0`. Solve any scenario:
   the **Broken constraints** match counts now show numbers instead of "–" (e.g. `overloaded`: 150 unassigned tasks).

> **Licence expiry.** Timefold logs `Timefold Solver will soon refuse to start, as the Timefold License is about to
> expire` in the weeks before. Once it expires, Enterprise **refuses to start**; there is no grace period. Renew in
> the [License Manager](https://licenses.timefold.ai/), or drop `ENTERPRISE=1` to fall back to Community.
> (A licensed run was checked on 2026-10-30: start, solve, match counts, expiry warning.)

### Useful Timefold links

- [Documentation home](https://docs.timefold.ai/timefold-solver/latest/introduction.html) ·
  [Quarkus integration](https://docs.timefold.ai/timefold-solver/latest/running-timefold-solver/library/quarkus.html) ·
  [FAQ (editions and licensing)](https://docs.timefold.ai/timefold-solver/latest/frequently-asked-questions.html)
- [Enterprise Edition features](https://docs.timefold.ai/timefold-solver/latest/commercial-editions/commercial-editions.html)
- [Upgrading from 1.x to 2.x](https://docs.timefold.ai/timefold-solver/latest/upgrading-timefold-solver/upgrade-from-v1.html)
  (this repo already uses the 2.x API, e.g. `HardMediumSoftScore`)
- Machine-readable docs index for AI assistants: [`docs.timefold.ai/llms.txt`](https://docs.timefold.ai/llms.txt)

---

## Claude (MCP client)

To ask Claude about plans, you need [Claude Code](https://docs.claude.com/en/docs/claude-code/overview) or another
MCP-capable client; no API key is set in this repo. Register the local server once (the model must be running):

```bash
claude mcp add --transport http jwlb http://localhost:8765/mcp
```

See [Use it from Claude](../README.md#use-it-from-claude) for the tools and example prompts, and the
[MCP docs](https://modelcontextprotocol.io/) for other clients.
