import fs from "fs";
import { walk } from "./scan.js";
import { chunkFile } from "./chunk.js";
import { embed } from "./embed.js";
import { search } from "./search.js";
import { askLLM } from "./llm.js";
import { routeQuestion } from "./router.js";
import { filterChunks } from "./corrective.js";

const folder = process.argv[2];
const question = process.argv[3];
if (!folder || !question) {
  console.log('Usage: node index.js "<folder>" "<question>"');
  process.exit(1);
}

const K = { simple: 3, complex: 8 };

// Adaptive step
const route = await routeQuestion(question);
console.log("Route:", route);

if (route === "general") {
  const answer = await askLLM("You are a helpful programming assistant. Be concise.", question);
  console.log("\nAnswer (no retrieval):\n" + answer);
  process.exit(0);
}

// Scan and chunk
const files = walk(folder);
const chunks = [];
for (const f of files) {
  chunks.push(...chunkFile(f, fs.readFileSync(f, "utf-8")));
}
console.log(`Files: ${files.length} | Chunks: ${chunks.length}`);

// Embed
console.log("Embedding chunks...");
for (const c of chunks) {
  c.vector = await embed(c.text);
}

// Search
const found = await search(chunks, question, K[route]);
console.log(`\nSearch returned ${found.length} chunks:`);
found.forEach(c => console.log(c.score.toFixed(3), `${c.file}:${c.startLine}-${c.endLine}`));

// Corrective step: drop weak chunks
const { kept, dropped } = filterChunks(found);
console.log(`\nCorrective filter: kept ${kept.length}, dropped ${dropped}`);

if (kept.length === 0) {
  console.log("\nAnswer:\nI could not find this in the codebase.");
  process.exit(0);
}

// Ask the LLM using only the good chunks
const context = kept
  .map((c, i) => `[Source ${i + 1}: ${c.file}, lines ${c.startLine}-${c.endLine}]\n${c.text}`)
  .join("\n\n");

const systemPrompt = `You are a codebase assistant.
Answer ONLY using the context provided.
If the answer is not in the context, say "I could not find this in the codebase." and stop.
Always mention which source (file and lines) you used.`;

try {
  const answer = await askLLM(systemPrompt, `Context:\n${context}\n\nQuestion: ${question}`);
  console.log("\nAnswer:\n" + answer);
} catch (err) {
  console.error("LLM failed:", err.message);
}