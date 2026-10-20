import "dotenv/config";

// Put the model that works for you first; the others are fallbacks
const MODELS = ["gemini-2.5-flash", "gemini-2.0-flash"];

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function callModel(model, systemPrompt, userPrompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": process.env.GEMINI_API_KEY,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    }),
  });

  const data = await response.json();
  if (data.error) {
    const err = new Error(data.error.message);
    err.code = data.error.code;
    throw err;
  }
  return data.candidates[0].content.parts[0].text;
}

export async function askLLM(systemPrompt, userPrompt) {
  let lastError;
  for (const model of MODELS) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        return await callModel(model, systemPrompt, userPrompt);
      } catch (err) {
        lastError = err;
        if (err.code === 404) break;                    // wrong model name: try the next model
        if (err.code !== 503 && err.code !== 429) throw err; // real error: stop
        await sleep(attempt * 2000);                    // busy: wait 2s, 4s, 6s and retry
      }
    }
  }
  throw lastError;
}