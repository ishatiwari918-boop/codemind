import { askLLM } from "./llm.js";

const ROUTER_PROMPT = `You classify questions about a codebase.
Reply with exactly one word:
general - a general programming question that has nothing to do with a specific project, file or function (for example "What is an API?")
simple - asks about one specific thing (one function, one file, one setting)
complex - needs several files or steps to explain (flows, comparisons, how parts connect)
If the question mentions a file name, a function name, "this project", "the code" or "the codebase", it is NEVER general.`;

// Questions that clearly refer to the project must use retrieval
const PROJECT_HINT = /\b[\w-]+\.(js|md|json|ts)\b|\b(this|the|our|my)\s+(project|code|codebase|repo|repository|file|function)\b/i;

export async function routeQuestion(question) {
  const mustRetrieve = PROJECT_HINT.test(question);

  try {
    const reply = await askLLM(ROUTER_PROMPT, `Question: ${question}`);
    const word = reply.trim().toLowerCase();
    if (word.includes("complex")) return "complex";
    if (word.includes("general")) return mustRetrieve ? "simple" : "general";
    return "simple";
  } catch (err) {
    console.error("Router failed:", err.message);
    return "simple";
  }
}