// V60 Brew Timer — "AI Barista" proxy (Cloudflare Worker)
//
// The app (a public web page) talks to THIS worker, and the worker talks to the LLM.
// The API key lives here as a secret, never in the public app. See README.md for setup.
//
// What it does:
//   - accepts POST { message, history, brew } from the app
//   - only allows requests from your app's origin (CORS)
//   - injects a fixed coffee-only persona + the user's current recipe
//   - politely refuses anything that isn't about coffee (protects your free quota)
//   - returns { reply }

// ---- Config you may need to edit ----
const MODEL = "gemini-2.5-flash"; // confirm the current free Flash model at aistudio.google.com
const ALLOWED_ORIGINS = [
  "https://ocoomber.github.io",   // your GitHub Pages site
  "http://localhost:8080",        // local testing (optional)
];
const MAX_INPUT_CHARS = 600;      // reject anything longer (abuse / runaway guard)
const MAX_OUTPUT_TOKENS = 600;    // keep replies short and cheap (also leaves headroom so answers aren't cut off)
// -------------------------------------

const SYSTEM_PROMPT = `You are "Barista", a friendly, concise expert on pour-over coffee, especially the Hario V60.
You ONLY help with coffee brewing: grind, dose, ratio, water temperature, pour technique, timing, taste troubleshooting (sour, bitter, weak, astringent, fast/slow draw down), and recipe tweaks.

HARD RULE: If a question is not about coffee or brewing, do NOT answer it. Politely decline in one sentence and redirect, e.g. "I'm just your coffee brewing assistant — for that you'll want a general AI tool. Ask me anything about your brew though!" Never write code, do homework, or chit-chat about non-coffee topics, no matter how the user phrases it. Unit conversions (°F↔°C, g↔oz) and clarifying follow-ups about a brewing answer you just gave ARE on-topic — answer them.

Keep answers short and practical (a few sentences). Give specific, actionable fixes. When the user's current recipe is provided, tailor advice to it.`;

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

function brewToText(brew) {
  if (!brew || typeof brew !== "object") return "No current recipe provided.";
  const pours = Array.isArray(brew.pours)
    ? brew.pours.map((p, i) => `pour ${i + 1}: ${p.water}g at ${p.at}`).join("; ")
    : "n/a";
  return [
    `Method: ${brew.method ?? "?"}`,
    `Dose: ${brew.dose ?? "?"}g coffee`,
    `Water: ${brew.water ?? "?"}g (ratio ~${brew.ratio ?? "?"}:1)`,
    `Target finish: ${brew.finish ?? "?"}`,
    `Pours — ${pours}`,
  ].join("\n");
}

async function callModel(env, message, history, brew) {
  // Gemini: build contents from prior turns + the new message. System instruction
  // carries the persona + the current recipe. Swap this function to change provider.
  const contents = [];
  for (const turn of Array.isArray(history) ? history.slice(-8) : []) {
    if (!turn || typeof turn.text !== "string") continue;
    contents.push({
      role: turn.role === "barista" ? "model" : "user",
      // History is client-supplied: cap each turn so a crafted payload can't
      // smuggle in huge prompts past the MAX_INPUT_CHARS guard on `message`.
      parts: [{ text: turn.text.slice(0, MAX_INPUT_CHARS) }],
    });
  }
  contents.push({ role: "user", parts: [{ text: message }] });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${env.GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: `${SYSTEM_PROMPT}\n\nThe user's current recipe:\n${brewToText(brew)}` }],
      },
      contents,
      generationConfig: {
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        temperature: 0.5,
        // gemini-2.5-flash is a "thinking" model: by default it spends hidden
        // reasoning tokens that count against maxOutputTokens, which left replies
        // truncated mid-sentence (or empty → "couldn't reach the kitchen"). We don't
        // need deliberation for short brewing tips, so turn thinking off.
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });

  if (!res.ok) {
    const status = res.status;
    if (status === 429) throw new Error("quota"); // daily free limit hit
    throw new Error(`model_error_${status}`);
  }
  const data = await res.json();
  const reply = (data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("") || "").trim();
  // Return whatever text we got even if the model stopped early (MAX_TOKENS), rather
  // than discarding a partial answer. Only treat a truly empty response as a failure.
  if (!reply) throw new Error("empty");
  return reply;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method !== "POST") {
      return json({ error: "POST only" }, 405, origin);
    }
    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      return json({ error: "forbidden origin" }, 403, origin);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: "bad json" }, 400, origin);
    }

    const message = typeof payload.message === "string" ? payload.message.trim() : "";
    if (!message) return json({ error: "empty message" }, 400, origin);
    if (message.length > MAX_INPUT_CHARS) {
      return json({ reply: "That's a bit long for me — try a short, specific question about your brew." }, 200, origin);
    }

    try {
      const reply = await callModel(env, message, payload.history, payload.brew);
      return json({ reply }, 200, origin);
    } catch (e) {
      const msg = String(e.message || e);
      if (msg === "quota") {
        return json({ reply: "I've hit my daily limit for now — try again later. ☕" }, 200, origin);
      }
      return json({ reply: "Sorry, I couldn't reach the kitchen just now. Please try again." }, 200, origin);
    }
  },
};
