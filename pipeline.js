import fs from "fs";
import path from "path";
import { walk } from "./scan.js";
import { chunkFile } from "./chunk.js";
import { embed } from "./embed.js";
import { search } from "./search.js";
import { askLLM } from "./llm.js";
import { routeQuestion } from "./router.js";
import { filterChunks } from "./corrective.js";

const K = { simple: 3, complex: 8 };

const SYSTEM_PROMPT = `You are a codebase assistant.
Answer ONLY using the context provided.
If the answer is not in the context, say "I could not find this in the codebase." and stop.

Style rules:
- Write plain text only. Do not use markdown: no asterisks, no bold, no headings, no bullet symbols.
- Keep the answer under 120 words, in short sentences.
- Name the key function or file in the sentence where it matters (for example: filterChunks in corrective.js).
- Do NOT list sources or line numbers at the end; they are shown to the user separately.
- Do not quote the README unless the question is about the README.`;

const label = c => `${c.file} [${c.name}] ${c.startLine}-${c.endLine}`;


export async function buildIndex(folder) {
  const files = walk(folder);
  const chunks = [];
  for (const f of files) {
    const modified = fs.statSync(f).mtime;
    for (const c of chunkFile(f, fs.readFileSync(f, "utf-8"))) {
      chunks.push({ ...c, modified });
    }
  }
  console.log(`Files: ${files.length} | Chunks: ${chunks.length}`);

  console.log("Embedding chunks...");
  for (const c of chunks) {
    c.vector = await embed(`${path.basename(c.file)} ${c.name}\n${c.text}`);
  }
  return chunks;
}


async function retrieve(chunks, question, route) {
  const found = await search(chunks, question, K[route]);
  console.log(`\nSearch returned ${found.length} chunks:`);
  found.forEach(c =>
    console.log(
      c.score.toFixed(3),
      `(vector ${c.vectorScore.toFixed(2)}, keyword ${c.keyword.toFixed(2)})`,
      label(c)
    )
  );

  const { kept, dropped } = filterChunks(found);
  console.log(`\nCorrective filter: kept ${kept.length}, dropped ${dropped}`);
  kept.forEach(c =>
    console.log(c.finalScore.toFixed(3), c.stale ? "(stale)" : "(fresh)", label(c))
  );
  return kept;
}


async function generate(kept, question) {
  const context = kept
    .map(
      (c, i) =>
        `[Source ${i + 1}: ${c.file}, ${c.name}, lines ${c.startLine}-${c.endLine}]\n${c.text}`
    )
    .join("\n\n");
  return askLLM(SYSTEM_PROMPT, `Context:\n${context}\n\nQuestion: ${question}`);
}

export async function answerQuestion(question, getChunks) {
  const route = await routeQuestion(question);
  console.log("Route:", route);

  if (route === "general") {
    const answer = await askLLM(
      "You are a helpful programming assistant. Be concise. Write plain text without markdown.",
      question
    );
    return { route, answer, sources: [] };
  }

  const chunks = await getChunks();
  const kept = await retrieve(chunks, question, route);
  if (kept.length === 0) {
    return { route, answer: "I could not find this in the codebase.", sources: [] };
  }
  return { route, answer: await generate(kept, question), sources: kept };
}