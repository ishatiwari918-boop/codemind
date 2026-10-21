import "dotenv/config";
const MODEL = "qwen/qwen3.8-27b";

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function callGroq(systemPrompt, userPrompt) {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(20000),
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  const raw = await response.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    const err = new Error(`Bad response (HTTP ${response.status}): ${raw.slice(0, 200)}`);
    err.code = response.status;
    throw err;
  }

  if (data.error) {
    const err = new Error(data.error.message);
    err.code = response.status;
    throw err;
  }
  return data.choices[0].message.content;
}

export async function askLLM(systemPrompt, userPrompt) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await callGroq(systemPrompt, userPrompt);
    } catch (err) {
      lastError = err;
      console.log(`[groq] attempt ${attempt} failed: ${err.message.slice(0, 120)}`);
      const retryable = err.code === 503 || err.code === 429 || err.name === "TimeoutError";
      if (!retryable) throw err; 
      await sleep(attempt * 2000);
    }
  }
  throw lastError;
}