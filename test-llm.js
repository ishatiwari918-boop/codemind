import { askLLM } from "./llm.js";

console.log("Calling LLM...");
try {
  const answer = await askLLM("You are a helpful assistant.", "Say hello in one sentence.");
  console.log("Reply:", answer);
} catch (err) {
  console.error("Failed:", err.message);
}
console.log("Finished.");