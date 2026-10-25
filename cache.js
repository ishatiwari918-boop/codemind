// Simple in-memory cache with expiry and a size limit
const TTL_MS = 10 * 60 * 1000; // answers are kept for 10 minutes
const MAX_ENTRIES = 200;

const store = new Map();

const makeKey = (project, question) =>
  `${project}::${question.trim().toLowerCase().replace(/\s+/g, " ")}`;

export function getCached(project, question) {
  const key = makeKey(project, question);
  const hit = store.get(key);
  if (!hit) return null;
  if (Date.now() - hit.savedAt > TTL_MS) {
    store.delete(key);
    return null;
  }
  return hit.value;
}

export function setCached(project, question, value) {
  if (store.size >= MAX_ENTRIES) {
    store.delete(store.keys().next().value); // drop the oldest entry
  }
  store.set(makeKey(project, question), { value, savedAt: Date.now() });
}

export function clearCache() {
  store.clear();
}