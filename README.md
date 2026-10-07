# V60 Brew Timer

An interactive pour-over brew timer that runs as a web app / phone PWA. Pick a method
(Balanced, Hoffmann, Kasuya, or a custom recipe), set your coffee dose, and it walks you
through the pours with a timer, ring, and prompts. It also has an **AI Barista** chat for
troubleshooting your cup ("too sour", "draining too fast", etc.).

The whole app is a single `index.html` file, hosted free on GitHub Pages.

## Brew with CoffeeScale

1. Install the V60 integration firmware from the CoffeeScale repo on the scale,
   and calibrate it with a known weight. Put your Android phone and scale on the
   same WiFi network.
2. For the initial pairing, choose **WiFi scale**, tap **Find scale**, and select
   **CoffeeScale** from Android Chrome's Bluetooth picker. The app reads the
   scale's WiFi address automatically, disconnects Bluetooth, and connects over
   WiFi. Allow local network access when Chrome asks. No IP copying is needed.
3. Select your recipe and dose, then tap **Prepare scale brew**. Put the **whole
   setup** on the scale: server/cup, V60, rinsed filter and ground coffee. All the
   poured water must stay supported by the scale, including water in the server.
4. Let it settle and tap **Zero scale & get ready**. When the screen says
   **Start pouring**, pour gently: the scale starts its timer automatically.
5. Follow one instruction at a time. **Water on scale** is your live reading;
   **Pour to** is the cumulative target. **Stop pouring** replaces the pour
   instruction at the target and shows a countdown to the next pour. After the
   final pour, **Let it drain** guides drawdown. Expand **View recipe** for the
   full schedule. Missed targets stay active until reached. Tap
   **Finish brew** after drawdown; **Cancel** or leaving for Settings also ends
   the board session. A slow brew continues past the recipe's suggested finish.

After that, **turn on the scale and open the app**. It remembers the pairing and
automatically reconnects over WiFi. It never opens the Bluetooth picker during
ordinary startup or reconnection. If the scale is still starting, the app waits
and retries. It tries both the last address and the stable `coffeescale.local`
name; after a DHCP address change, a successful local-name connection updates
the remembered IP. Modern Android supports `.local` resolution, but the router
must allow local multicast for that recovery path. The scale's persistent device
ID prevents another scale at an old IP from supplying your brew readings.
Address entry is available inside **Connection troubleshooting** if needed.

The board owns pour detection and elapsed time. The app polls one request at a
time, waits 200ms between successful readings, and shows a connection error instead
of stale weight. After a connection gap it catches up to the scale's timer. Keep
the PWA open during brewing. Use a current Chrome on Android; older browsers may
block an HTTPS page from reaching the HTTP scale. If permission was denied, allow
local network access for `https://ocoomber.github.io` in Chrome's site settings.
Bluetooth is used only for initial discovery, not live weight or timer control.
Close the scale's other live weight page while using V60 to avoid competing polls.
The firmware permits this GitHub Pages origin; hosting elsewhere requires updating
the origin allowlist in CoffeeScale. **Manual timer** remains available.

The integration uses `GET /api/weight`, `POST /api/pour/arm` (tare and arm) and
`POST /api/pour/end`. It does not change the scale's saved espresso mode.

App logic checks: `node --test tests/scale.test.cjs`. These simulate the scale API
and Bluetooth picker. Android pairing, permission handling, physical pour detection and live WiFi reliability
still need testing with the flashed scale. After an app update, reload
`https://ocoomber.github.io/v60/` in Chrome and reopen the PWA.

---

## How it all works (in plain language)

Think of the AI Barista as a little **coffee-advice hotline**.

- **The app on your phone = the phone in your hand.** Just buttons and a chat box. It
  can't *think* — it shows things and passes your question along.
- **Google's Gemini AI = a world-expert barista in a back office.** This is the bit that
  actually knows things and writes the answers. It lives on Google's computers, not your
  phone. You never talk to it directly.
- **The Cloudflare Worker = a trusted receptionist sitting in between.** Every question
  goes to her first; she walks over to the expert, asks, and brings the answer back.

### Why the receptionist (Worker) exists
To talk to the expert you need a **secret pass** (the *API key*) — like a membership card
that bills questions to your account. But the app is *public*: anyone can read its code,
like a menu in a shop window. If the key were in the app, it'd be like writing your PIN on
that menu — strangers could copy it and use your membership.

So the key lives **with the receptionist, behind a locked door**. Your phone never sees it.
The receptionist also:
1. **Only takes calls from your app** (ignores strangers ringing direct) — *"CORS"*.
2. **Clips the house rules to every question**: *"You're a coffee expert. Only answer
   coffee questions; politely decline anything else."* That's why it says "sorry, just
   coffee." We keep this rule on her side so nobody can erase it.

### Where each piece lives (all free)
- The app page → **GitHub Pages**
- The receptionist → **Cloudflare** (`barista-worker/`)
- The expert → **Google Gemini**

Your phone → GitHub (the page) → Cloudflare (the receptionist) → Google (the expert), and
the answer comes back down the same chain.

---

## What the free limit actually is

The limit is counted in **requests per day**, not words. Roughly:

| Limit | Number | In plain terms |
|---|---|---|
| Requests per **day** | ~1,500 | One chat message = one request. So ~1,500 questions a day, shared across everyone using the app. |
| Requests per **minute** | ~15 | You can't fire more than ~15 in a single minute (you'd never hit this by hand). |
| Tokens per **minute** | ~1,000,000 | "Tokens" are chunks of words (~¾ of a word each). A short Q&A is a few hundred tokens, so this ceiling is effectively unreachable for chat. |

**In practice:** for you and a few friends, you'll never get close. If a busy day ever did
use up the ~1,500, the Barista just says "come back later" and the count resets the next
day. Because there's **no card on the account (free tier)**, hitting the limit costs
nothing — it pauses, it never bills.

---

## Is the "coffee only" rule unbreakable?

Short answer: it's a **strong lock, not a vault.**

The house rule (the system prompt) is what makes the bot refuse non-coffee questions, and
modern models follow it well — your "ignore all previous instructions" attempt bounced off,
which is the model doing its job. But tricking a chatbot into ignoring its instructions is a
known, unsolved cat-and-mouse game called **prompt injection** / *jailbreaking*. A
determined person with clever enough wording can sometimes get *any* chatbot to slip. No
system prompt is 100% guaranteed.

**Why we don't lose sleep over it here:** even in the worst case where someone jailbreaks
it, the damage is tiny —
- they **can't** see or steal your API key (it's behind the locked door),
- they **can't** run up a bill (free tier — no card),
- the only thing they could do is waste some of the daily free question-tickets.

So the blast radius is "a stranger wasted a few of today's free questions," which resets
overnight. For a personal brew app that's a fine trade-off. If it ever became a public app
with real traffic, we'd add stronger guards (rate limits, a separate "is this coffee?"
check, etc.) — but that's a bridge for later.

---

## Setup / deploy notes
- The Barista proxy and its one-time setup steps live in [`barista-worker/`](barista-worker/README.md).
- The app is just `index.html` — open it in a browser, or it auto-updates on GitHub Pages
  when changes are pushed.
