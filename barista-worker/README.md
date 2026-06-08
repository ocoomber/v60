# AI Barista — proxy setup (one-time)

The brew app's chatbot talks to this small Cloudflare Worker, and the Worker talks to
Google Gemini. The API key lives **only** in the Worker (as a secret), never in the
public app. You set this up once; the people using your app never need accounts.

It's free: Cloudflare Workers and Gemini Flash both have free tiers with no credit
card. Worst case if it's overused is the daily limit pauses the chat — never a bill.

## 1. Get a free Gemini API key
1. Go to https://aistudio.google.com/ and sign in with a Google account.
2. Click **Get API key** → **Create API key**. Copy it (starts with `AIza...`).
3. While there, check the current free model name (e.g. `gemini-2.5-flash`). If it
   differs from the `MODEL` constant at the top of `worker.js`, update that line.

## 2. Create the Worker
1. Go to https://dash.cloudflare.com/ and make a free account.
2. Left sidebar → **Workers & Pages** → **Create application** → **Create Worker**.
3. Name it something like `v60-barista`, click **Deploy** (the placeholder code is fine).
4. Click **Edit code**, delete everything, and paste the full contents of `worker.js`.
   Click **Deploy** again.

## 3. Add your key as a secret
1. On the Worker's page → **Settings** → **Variables and Secrets**.
2. Add a **Secret** named exactly `GEMINI_API_KEY`, value = the key from step 1. Save.
   (A *secret*, not a plain variable — it stays hidden.)

## 4. Point it at your app
1. In `worker.js`, confirm `ALLOWED_ORIGINS` includes your app's address
   (e.g. `https://ocoomber.github.io`). Edit + redeploy if your URL differs.
2. Copy the Worker's URL from its page — it looks like
   `https://v60-barista.<your-name>.workers.dev`.

## 5. Tell the app where to find it
In `index.html`, set the `BARISTA_URL` constant (near the top of the `<script>`) to the
Worker URL from step 4, then commit/push. That's it.

## Test it (optional)
```sh
curl -X POST "https://v60-barista.<your-name>.workers.dev" \
  -H "Content-Type: application/json" \
  -d '{"message":"my brew finished in 2:10 and tastes sour, help?","brew":{"method":"Kasuya","dose":20,"water":300,"ratio":15}}'
```
You should get a short coffee answer. Asking it something off-topic ("write me a Python
script") should get a polite refusal.

## Notes
- **Changing model/provider:** the model is one constant (`MODEL`); switching provider
  (e.g. to Groq) means editing just the `callModel()` function.
- **Scaling:** the free Gemini tier is ~1,500 messages/day shared across everyone using
  your app. Fine for you + friends. For a big public app you'd move to a paid tier or
  add per-user limits.
