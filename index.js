import fs from "fs";
import { walk } from "./scan.js";
import { chunkFile } from "./chunk.js";
import { embed } from "./embed.js";
import { search } from "./search.js";
import { askLLM } from "./llm.js";

const folder = process.argv[2];
const question = process.argv[3];
if (!folder || !question) {
  console.log('Usage: node index.js "<folder>" "<question>"');
  process.exit(1);
}

// Steps 1 + 2: scan and chunk
const files = walk(folder);
const chunks = [];
for (const f of files) {
  chunks.push(...chunkFile(f, fs.readFileSync(f, "utf-8")));
}
console.log(`Files: ${files.length} | Chunks: ${chunks.length}`);

// Step 3: embed every chunk
console.log("Embedding chunks...");
for (const c of chunks) {
  c.vector = await embed(c.text);
}

// Step 4: search
const top = await search(chunks, question);
console.log("\nTop matches:");
top.forEach(c => console.log(c.score.toFixed(3), `${c.file}:${c.startLine}-${c.endLine}`));

// Step 5: ask the LLM using only those chunks
const context = top
  .map((c, i) => `[Source ${i + 1}: ${c.file}, lines ${c.startLine}-${c.endLine}]\n${c.text}`)
  .join("\n\n");

const systemPrompt = `You are a codebase assistant.
Answer ONLY using the context provided.
If the answer is not in the context, say "I could not find this in the codebase."
Always mention which source (file and lines) you used.`;

try {
  const answer = await askLLM(systemPrompt, `Context:\n${context}\n\nQuestion: ${question}`);
  console.log("\nAnswer:\n" + answer);
} catch (err) {
  console.error("LLM failed:", err.message);
}