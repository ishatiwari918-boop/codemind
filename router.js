import { askLLM } from "./llm.js";

const ROUTER_PROMPT = `You classify questions about a codebase.
Reply with exactly one word:
general - a general programming question that needs no code from the project
simple - asks about one specific thing (one function, one file, one setting)
complex - needs several files or steps to explain (flows, comparisons, how parts connect)`;

export async function routeQuestion(question) {
  try {
    const reply = await askLLM(ROUTER_PROMPT, `Question: ${question}`);
    const word = reply.trim().toLowerCase();
    if (word.includes("general")) return "general";
    if (word.includes("complex")) return "complex";
    return "simple";
  } catch (err) {
    console.error("Router failed:", err.message);
    return "simple";
  }
}