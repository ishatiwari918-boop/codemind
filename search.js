import path from "path";
import { embed, cosineSimilarity } from "./embed.js";

const VECTOR_WEIGHT = 0.5;
const KEYWORD_WEIGHT = 0.5;

// Words that say nothing about what to look for
const STOPWORDS = new Set([
  "how", "does", "do", "the", "an", "is", "are", "what", "where", "which",
  "in", "of", "to", "this", "that", "it", "and", "or", "for", "on", "with",
  "work", "works", "project", "code", "me", "explain", "about",
]);

// Split text into lowercase words (filterChunks -> filter, chunks)
function words(text) {
  return text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(w => w.length > 1);
}

// Tiny stemmer: chunks -> chunk, models -> model
function stem(w) {
  return w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w;
}

// How many question words appear in the chunk? Name matches count most.
function keywordScore(terms, chunk) {
  if (terms.length === 0) return 0;
  const nameWords = new Set(words(`${path.basename(chunk.file)} ${chunk.name}`).map(stem));
  const textWords = new Set(words(chunk.text).map(stem));
  let total = 0;
  for (const t of terms) {
    if (nameWords.has(t)) total += 1;
    else if (textWords.has(t)) total += 0.3;
  }
  return total / terms.length;
}

export async function search(chunks, question, k = 3) {
  const questionVector = await embed(question);
  const terms = words(question).filter(w => !STOPWORDS.has(w)).map(stem);

  return chunks
    .map(c => {
      const vectorScore = cosineSimilarity(questionVector, c.vector);
      const keyword = keywordScore(terms, c);
      const score = VECTOR_WEIGHT * vectorScore + KEYWORD_WEIGHT * keyword;
      return { ...c, vectorScore, keyword, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}