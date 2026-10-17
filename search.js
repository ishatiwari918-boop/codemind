import { embed, cosineSimilarity } from "./embed.js";

export async function search(chunks, question, k = 3) {
  const questionVector = await embed(question);

  return chunks
    .map(c => ({ ...c, score: cosineSimilarity(questionVector, c.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}