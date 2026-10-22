const MIN_SCORE = 0.15;
const STALE_DAYS = 180;     // older than this counts as stale
const STALE_PENALTY = 0.7;  // stale chunks keep 70% of their score

export function filterChunks(chunks, minScore = MIN_SCORE) {
  const now = Date.now();

  const adjusted = chunks.map(c => {
    const ageDays = (now - new Date(c.modified).getTime()) / 86400000;
    const stale = ageDays > STALE_DAYS;
    return { ...c, stale, finalScore: stale ? c.score * STALE_PENALTY : c.score };
  });

  const kept = adjusted
    .filter(c => c.finalScore >= minScore)
    .sort((a, b) => b.finalScore - a.finalScore);

  return { kept, dropped: chunks.length - kept.length };
}