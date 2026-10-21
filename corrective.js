const MIN_SCORE = 0.15; 

export function filterChunks(chunks, minScore = MIN_SCORE) {
  const kept = chunks.filter(c => c.score >= minScore);
  const dropped = chunks.length - kept.length;
  return { kept, dropped };
}