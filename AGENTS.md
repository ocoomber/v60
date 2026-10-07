# AGENTS.md — quick reference for AI coding sessions

## Repo at a glance
- **One file, no build.** The entire app is `index.html` (HTML + inline CSS + inline JS + base64 assets). No framework, no package.json, no bundler. Scale integration checks live in `tests/scale.test.cjs` and run directly with Node.
- **`barista-worker/`** is a separate Cloudflare Worker (`worker.js`). Deployed independently, not served by Pages. See `barista-worker/README.md` for setup.
- Hosted on **GitHub Pages** — auto-deploys on push to `main`.

## Verify before you push
No linter or typecheck. Run `node --test tests/scale.test.cjs` for scale changes, plus a JS syntax check:
```sh
awk 'n==1 && /^<\/script>$/{exit} /^<script>$/{n=1; next} n==1{print}' index.html > /tmp/app.js && node --check /tmp/app.js
```
- Two `<script>` blocks in the file: NoSleep.js opens as `<script>/*!...` on one line; the app block is the only one alone on a line. The awk extraction relies on this.
- Sanity-check `/tmp/app.js` is non-empty before running `node --check` (empty file passes silently).
- You **cannot** run the app or hit the network here. Flag that real-device testing is still needed.

## Branch policy
- **Default to `main`.** Push to `main` unless the user says otherwise.
- Commit + push when a change is complete; the user only pulls.

## PWA & testing
- **Primarily Android-tested.** The app is used as a PWA via Chrome on Android. After pushing, the phone may serve a cached version — force an update by opening `https://ocoomber.github.io/v60/` in Chrome (not the PWA standalone window) and hard-reloading. Then reopen the PWA.

## Code constraints
- **Keep it one file.** Do not split `index.html` into separate JS/CSS files. Single self-contained file is a deliberate feature.
- **Code style:** terse helpers, `const $ = id => document.getElementById(id)`, `innerHTML` templates, CSS custom properties. Reuse existing helpers (`saveSettings`, `applySettings`, `showScreen`, `buildCues`, `fmt`, `totalWater`) rather than adding parallel ones.
- **Ring circumference:** `RING_CIRC = 552.9` (2pi*88) — used in JS and as a literal in SVG markup. Keep them in sync if either changes.
- **Version bump:** Update `APP_VERSION` in `index.html` to today's date (add a `.2`, `.3` … suffix if multiple commits in one day, e.g. `2026-07-02.2`). Start each day at `.1`.

## Brew-step wording (important)
- Cue objects and manual prompts use **cumulative scale targets**: `Pour to `${water}g`. The scale phase view displays the increment for that phase as **added / required grams**, plus the cumulative scale reading below. The user still tares only once.
- The Custom *editor* is the exception: it shows per-pour gram budgets with a cumulative hint.
- `water` in cue objects is always cumulative for all methods.

## CoffeeScale pairing
- Initial **Find scale** uses Web Bluetooth in Android Chrome to read the WiFi address and persistent device ID; it disconnects Bluetooth immediately afterward. Brewing stays on WiFi.
- Remember the pairing and reconnect automatically over WiFi on app startup and after a dropped connection. Never open a Bluetooth picker on these paths.
- Retry the cached IP and `coffeescale.local`; successful local-name recovery learns the new DHCP IP. Modern Android supports `.local`, but multicast availability remains network-dependent.
- Match the paired `device_id` before accepting readings. Bluetooth service/characteristic UUIDs must match CoffeeScale firmware. Commands and polls remain serialized.

## Scale brew screen
- This is a phase tracker, not a V60 tutorial. No preparation checklist or pouring-technique prose in the scale brew view.
- Show **Phase water: added / required grams** and **Phase time: elapsed / allotted time** equally prominently. Keep cumulative weight and total brew time as secondary readings.
- A phase occupies the whole interval between its recipe cue and the next cue. Reaching the water target changes Pour to Wait; the phase timer keeps running until the next boundary. Reset both phase counters for the next pour. Never skip an unfinished pour to satisfy the clock; show its elapsed time exceeding its budget.
- Timer-only ring, prompt and upcoming cards are hidden in scale mode. The complete recipe sits inside **View recipe**. Preserve deliberate actions such as Hoffmann's stir/swirl.
- Start uses **Tare & start**; the board still owns tare, first-pour detection and timing. Avoid repeatedly updating unchanged live-region instructions while polling. Drawdown remains active beyond the suggested finish until the user ends the brew.

## Deeper domain model
See **CLAUDE.md** for the full `METHODS` registry, `customPours` budget model, `savedRecipes` shape, `localStorage` persistence, and migration rules.
