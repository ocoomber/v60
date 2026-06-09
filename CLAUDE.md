# CLAUDE.md — working notes for this project

## What this is
An interactive V60 pour-over **brew timer**, shipped as a single-page web app / phone PWA.
The entire app is one file: **`index.html`** (HTML + inline `<style>` + inline `<script>`,
plus a minified NoSleep.js library and base64-encoded manifest/icons). There is **no build
step, no framework, no dependencies, and no test suite.** Edit `index.html` directly.

Hosted free on **GitHub Pages** (auto-deploys on push to `main`; CDN cache ~10 min).

## Workflow conventions
- **Branch:** work on `main`. I commit **and push**; the user only ever **pulls** (they
  don't push from their end). Commit + push when a change is complete.
- **Keep it one file.** Do not split `index.html` into separate JS/CSS files — being a
  single self-contained file is a deliberate feature (simple hosting, offline-friendly).
- **Style:** match the surrounding code — terse helpers, `const $ = id => document.getElementById(id)`,
  `innerHTML` templates for rendering, CSS custom properties (`var(--green)` etc.). Reuse
  existing helpers (`saveSettings`, `applySettings`, `showScreen`, `buildCues`, `fmt`,
  `totalWater`) rather than adding parallel ones.

## How to verify (no live browser here)
- Extract the app script and syntax-check it:
  `awk '/^<script>$/{n++} n==2 && !/^<script>$/ && !/^<\/script>$/{print}' index.html > /tmp/app.js && node --check /tmp/app.js`
  (the file has two `<script>` blocks; block 2 is the app — block 1 is NoSleep.js).
- I **cannot** run the app or hit the network here, so reason through logic and flag that
  real-device testing is still needed. The user tests on their phone after pulling.

## Domain model (the important mental model)
- **Dose is the single user input.** Each method owns its `ratio` and a suggested `dose`.
- `METHODS` registry: `balanced` (13g, 16:1), `hoffmann` (15g, 16.7:1), `kasuya` (20g, 15:1),
  `custom`. Each has a `build(dose, ratio)` returning timed **cues** `{at, action, detail,
  water, phase}`. `water` is cumulative.
- `totalWater()` = dose × method ratio (for custom = sum of the pours).
- **Brew-step wording is standardised to cumulative scale targets:** every pour cue's
  `action` reads **`Pour to ${water}g`** (pour until the scale reads X — the user tares once
  and watches a running total). `water` is cumulative for all methods. Do NOT phrase steps
  as increments ("add Xg") in the brew cues. (The Custom *editor* is the exception: there you
  allocate a per-pour gram **budget**, shown with a cumulative "→ Xg total" hint.)
- **Custom = a water budget.** `dose × customRatio` is the budget; `customPours` are
  per-pour gram **increments** (`{at, g}`) that should sum to it. The editor shows a budget
  bar (under/ok/over) and **locks Start brew until it balances**.
- **Saved recipes:** `settings.savedRecipes = [{name, dose, ratio, pours}]`, loaded/saved in
  the Custom editor.
- **Persistence:** all of `settings` is JSON in `localStorage['v60-settings']`. `loadSettings()`
  migrates old shapes (e.g. defaults `savedRecipes` to `[]`, repairs `customPours`). When
  changing the settings shape, add a migration there.

## Screens & navigation
Four `.screen` divs — `screenSettings`, `screenBrew`, `screenHelp` (the Guide, collapsible
`<details>`), `screenBarista` (chat). `showScreen(name)` toggles `.active`.

## AI Barista (chat)
- Client: `BARISTA_URL` const points at a **Cloudflare Worker**; `sendBarista()` POSTs
  `{message, history, brew}` (brew = `currentBrewContext()`). Degrades gracefully offline.
- Proxy: **`barista-worker/worker.js`** holds the Gemini API key (as a Worker secret),
  restricts CORS to the Pages origin, injects a **hard coffee-only system prompt**, and
  calls **Google Gemini Flash (free tier)**. Provider/model isolated to `MODEL` + `callModel()`.
- See `barista-worker/README.md` for one-time deploy steps. The worker is deployed
  separately (not served by Pages); it lives in the repo for version control.

## Gotchas
- `RING_CIRC = 552.9` is the SVG progress-ring circumference (2π·88) — used in JS and as a
  literal in the SVG markup; keep them in sync.
- Two `<script>` blocks (NoSleep.js, then the app).
