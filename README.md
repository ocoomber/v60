# V60 Brew Timer

An interactive pour-over brew timer that runs as a web app / phone PWA. Pick a method
(Balanced, Hoffmann, Kasuya, or a custom recipe), set your coffee dose, and it walks you
through the pours with a timer, ring, and prompts. It also has an **AI Barista** chat for
troubleshooting your cup ("too sour", "draining too fast", etc.).

The whole app is a single `index.html` file, hosted free on GitHub Pages.

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
