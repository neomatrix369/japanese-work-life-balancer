# Design system: Work-Life Balancer

The one source for colour, type, spacing, elevation and motion in `ui/`.
Values live as CSS custom properties in `ui/src/theme.css` (loaded last, after `ui/src/index.css`).
Component files never hard-code hex values; they use the tokens below.

Visual target: none committed yet (the dashboard at commit `feat/ui-design` is the reference).

## Direction

- **Calm and trustworthy.** A planning tool about people's health in a Japanese company. Warm paper
  background, near-black ink, one deep indigo accent (藍, *ai-iro*). Nothing shouts.
- **Data first.** KPI numbers are the largest type on screen and use tabular figures. Labels are small
  and quiet. Status colour is used only for status (healthy, caution, at risk, holiday), never for decoration.
- **Dense but breathable.** A 4 px spacing grid, hairline rules instead of heavy borders, subtle elevation,
  and crisp focus rings on every control.

## Plain-CSS stack (deliberate)

The build spec (Phase 3) asks for plain CSS with no component library. We keep that: no Tailwind,
shadcn or MUI. Icons are Lucide (`lucide-react`, named imports only). Fonts are the system UI stack:
no web-font download, so the demo works offline and has no layout shift.

## Colour tokens

Named by meaning, not hue. Contrast ratios are WCAG 2.x, measured with the formula in the
WCAG spec (`scratchpad/contrast.py` during the design pass).

| Token | Role | Light | Dark |
|---|---|---|---|
| `--surface` | page background | `#f6f5f1` | `#121316` |
| `--surface-raised` | cards, top bar, dialogs | `#ffffff` | `#1a1c21` |
| `--surface-sunken` | table heads, wells, idle cells | `#efede7` | `#16181c` |
| `--ink` | body text, numbers | `#1b1d23` | `#ebeae6` |
| `--ink-muted` | labels, captions | `#585d6b` | `#a2a6b2` |
| `--rule` | hairlines, borders | `#e2dfd7` | `#2c2f37` |
| `--rule-strong` | table head underline, input borders | `#cfcbc1` | `#3a3e48` |
| `--accent` | the one accent: primary fill, selection, links | `#3f51b5` | `#8c9af0` |
| `--accent-ink` | accent used as small text | `#3446a6` | `#a3aef5` |
| `--accent-on` | text on an accent fill | `#ffffff` | `#11131a` |
| `--accent-soft` | tinted accent background (tour button, selected chip) | `#eceffa` | `#232846` |
| `--signal-good` / `-bg` | healthy (1 to 2 days in a row), profit up | `#276f44` / `#e2f1e7` | `#74cf98` / `#173022` |
| `--signal-warn` / `-bg` | caution (day 3), unassigned | `#8f5a00` / `#fbeed3` | `#e7b453` / `#33270f` |
| `--signal-bad` / `-bg` | at risk (day 4+), hard break | `#b3362b` / `#fbe4df` | `#f28b80` / `#3b1b18` |
| `--holiday` / `-bg` | approved holiday, info chips | `#2f6684` / `#e1edf3` | `#86bddb` / `#15293a` |
| `--focus` | focus ring colour | `= --accent` | `= --accent` |
| `--scrim` | overlay behind side panel and tour | `rgba(17,19,26,.45)` | `rgba(0,0,0,.6)` |

### Measured contrast (text on its usual background)

| Pair | Light | Dark |
|---|---|---|
| ink on surface / raised / sunken | 15.4 / 16.9 / 14.4 | 15.4 / 14.2 / 14.8 |
| ink-muted on surface / raised / sunken | 6.0 / 6.6 / 5.6 | 7.6 / 7.0 / 7.3 |
| ink-muted on rule (holiday hatch) | 4.9 | 5.5 |
| accent on raised (accent passes as text) | 6.9 | 6.5 |
| accent-ink on raised / accent-soft | 8.2 / 7.1 | 8.1 / 6.8 |
| accent-on on accent (primary button) | 6.9 | 7.1 |
| signal-good on its bg / on raised | 5.2 / 6.1 | 7.5 / 9.0 |
| signal-warn on its bg / on raised | 5.0 / 5.8 | 7.7 / 9.0 |
| signal-bad on its bg / on raised | 5.0 / 6.0 | 6.5 / 7.1 |
| holiday on its bg / on raised | 5.3 / 6.3 | 7.3 / 8.4 |

Every text pair is at least 4.5:1. The accent passes as text in both themes; `--accent-ink` is a
slightly deeper variant for 11.5 to 13 px text.

Colour is never the only signal: run cells show the hours number, at-risk rows carry an "at risk" badge,
public holidays are hatched as well as tinted, and the legend names every colour.

## Legacy token map (index.css → semantic)

`index.css` keeps its original names so no component changes are needed. `theme.css` points each one
at a semantic token.

| Legacy token | Now means |
|---|---|
| `--bg` | `--surface` |
| `--bg-surface` | `--surface-raised` |
| `--bg-muted`, `--neutral-bg`, `--surface-2` | `--surface-sunken` |
| `--fg`, `--text` | `--ink` |
| `--fg-muted`, `--text-muted` | `--ink-muted` |
| `--border` | `--rule` |
| `--primary`, `--accent` | `--accent` |
| `--primary-fg`, `--accent-fg` | `--accent-on` |
| `--green`, `--good`, `--chart-4` | `--signal-good` |
| `--green-bg`, `--good-bg` | `--signal-good-bg` |
| `--amber`, `--warn`, `--chart-2` | `--signal-warn` |
| `--amber-bg`, `--warn-bg` | `--signal-warn-bg` |
| `--red`, `--bad`, `--chart-3` | `--signal-bad` |
| `--red-bg`, `--bad-bg` | `--signal-bad-bg` |
| `--blue`, `--holiday-blue` | `--holiday` |
| `--blue-bg`, `--holiday-blue-bg` | `--holiday-bg` |
| `--chart-1` | `--chart-bar` (neutral slate, so the accent stays for interaction) |
| `--focus-ring` | `--focus` |
| `--overlay` | `--scrim` |
| `--card-shadow` | `--elev-1` |
| `--radius` | `--radius-md` |
| `--font`, `--font-mono` | `--font-sans`, `--font-mono` |
| `--surface` (old alias, unused) | redefined as the page background |

## Type

System UI stack: `-apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", system-ui,
"Hiragino Sans", "Noto Sans JP", Roboto, "Helvetica Neue", Arial, sans-serif`.
Mono: `ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace` (scores only).

| Step | Size / line height | Weight | Use |
|---|---|---|---|
| `--text-label` | 11.5 / 16 px, +0.06 em tracking, uppercase | 600 | group labels, table heads |
| `--text-caption` | 12 / 16 px | 400 | sub-lines, legends, hints |
| `--text-small` | 13 / 18 px | 500 | controls, table cells |
| `--text-body` | 14 / 20 px | 400 | body, narration |
| `--text-title` | 15 / 20 px | 650 | card titles, app name |
| `--text-kpi` | 28 / 32 px, -0.02 em | 650 | KPI numerals (tabular-nums) |
| `--text-kpi-sm` | 22 / 28 px | 650 | retention numerals |

Body never goes below 14 px and labels never below 11.5 px. All numbers use
`font-variant-numeric: tabular-nums` so columns of yen and hours line up.

## Spacing, radii, elevation

- Spacing: 4 px base. `--space-1` 4, `--space-2` 8, `--space-3` 12, `--space-4` 16, `--space-5` 20, `--space-6` 24, `--space-8` 32.
- Radii: `--radius-sm` 6 px (chips, inputs, buttons), `--radius-md` 10 px (cards), `--radius-lg` 14 px (dialogs, sheets), `--radius-pill` 999 px.
- Elevation: `--elev-0` none (flat wells), `--elev-1` hairline + 1 px soft shadow (cards), `--elev-2` 8 px soft shadow (sticky top bar), `--elev-3` 24 px shadow (dialogs, side panel).
- Control height: 32 px (36 px at 600 px wide and below, for touch).

## Motion

| Tier | Duration | Easing | Use |
|---|---|---|---|
| micro | 150 ms | `cubic-bezier(0.23, 1, 0.32, 1)` | hover, press, colour |
| ui | 200 ms | ease-out | chevrons, toggles, spotlight moves |
| entrance | 450 ms | `cubic-bezier(0.23, 1, 0.32, 1)` | panels and dialogs appearing |

Exits are shorter than entrances. `prefers-reduced-motion: reduce` switches every animation and
transition off (CSS kill-switch in `theme.css`), including the skeleton shimmer and view transitions.

## Components (class names stay as they are)

- **Top bar:** raised surface, sticky with `--elev-2`, controls 32 px high, labels in `--ink-muted`.
- **Buttons:** `.btn` neutral outline; `.btn-primary` accent fill; `.btn-danger` bad-signal outline;
  `.btn-tour` accent-soft fill. Hover never removes the label colour.
- **KPI cards:** label (caption) → number (`--text-kpi`) → delta → sub-line. Status colour on the number only.
- **Week grid:** sunken head, hairline cells, run colours from the signal tokens, public holidays hatched,
  highlighted column outlined in the accent.
- **Tables:** sunken head with a strong rule under it, hairline rows, hover in sunken.
- **Focus:** every interactive element shows a 2 px `--focus` ring with 2 px offset on `:focus-visible`.

## Copy rules

No em dashes, emoji or exclamation marks in UI strings or tour narration. Numbers over adjectives.
Icons are SVG (Lucide), decorative ones are `aria-hidden`, icon-only buttons keep an `aria-label`.
