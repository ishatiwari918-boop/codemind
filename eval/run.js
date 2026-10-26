import path from "path";
import fs from "fs";
import { buildIndex } from "../pipeline.js";
import { search } from "../search.js";
import { filterChunks } from "../corrective.js";
import { answerable, unanswerable } from "./questions.js";

const folder = path.resolve(import.meta.dirname, "..");
const chunks = await buildIndex(folder);
console.log(`\nEvaluating ${answerable.length} answerable + ${unanswerable.length} unanswerable questions\n`);

const isCorrect = (c, exp) =>
  path.basename(c.file) === exp.file &&
  (!exp.names || exp.names.some(n => c.name === n || c.name.startsWith(n + " ")));

const pct = x => `${(x * 100).toFixed(0)}%`;
const modes = ["vector", "keyword", "hybrid"];
const stats = Object.fromEntries(modes.map(m => [m, { h1: 0, h3: 0, rr: 0 }]));
const misses = [];
let keptHit = 0, keptEmpty = 0;

for (const q of answerable) {
  // k = all chunks, so we get the complete ranking and every score
  const all = await search(chunks, q.question, chunks.length);
  const rankings = {
    vector: [...all].sort((a, b) => b.vectorScore - a.vectorScore),
    keyword: [...all].sort((a, b) => b.keyword - a.keyword || b.vectorScore - a.vectorScore),
    hybrid: all, // already sorted by the hybrid score
  };

  for (const m of modes) {
    const idx = rankings[m].findIndex(c => isCorrect(c, q));
    if (idx === 0) stats[m].h1++;
    if (idx !== -1 && idx < 3) stats[m].h3++;
    if (idx !== -1) stats[m].rr += 1 / (idx + 1);
    if (m === "hybrid" && (idx === -1 || idx >= 3)) {
      misses.push(`${q.question}  (correct chunk rank: ${idx === -1 ? "none" : idx + 1})`);
    }
  }

  // Hybrid + corrective filter, on the top 3 the LLM would receive
  const { kept } = filterChunks(all.slice(0, 3));
  if (kept.some(c => isCorrect(c, q))) keptHit++;
  if (kept.length === 0) keptEmpty++;
}

let refused = 0;
for (const question of unanswerable) {
  const all = await search(chunks, question, 3);
  if (filterChunks(all).kept.length === 0) refused++;
}

const n = answerable.length;
const retrieval = modes.map(m => ({
  setup: m,
  "Hit@1": pct(stats[m].h1 / n),
  "Hit@3": pct(stats[m].h3 / n),
  MRR: (stats[m].rr / n).toFixed(2),
}));
console.log("RETRIEVAL (answerable questions)");
console.table(retrieval);

const filtering = {
  "correct chunk still present after filter": pct(keptHit / n),
  "wrongly refused (answerable)": pct(keptEmpty / n),
  "correctly refused (unanswerable)": pct(refused / unanswerable.length),
};
console.log("HYBRID + CORRECTIVE FILTER");
console.table(filtering);

if (misses.length) {
  console.log("Hybrid misses (not in top 3):");
  misses.forEach(m => console.log(" -", m));
}

fs.writeFileSync(
  path.join(import.meta.dirname, "results.json"),
  JSON.stringify({ date: new Date().toISOString(), chunks: chunks.length, retrieval, filtering }, null, 2)
);
console.log("\nSaved eval/results.json");