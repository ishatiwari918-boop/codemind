// Each question names the file (and optionally function) that holds the answer.
// Rule: write the expected answer BEFORE running the eval, and never edit it
// to make the numbers look better.
export const answerable = [
  { question: "Which function walks through folders to find code files?", file: "scan.js", names: ["walk"] },
  { question: "How are old files penalized in ranking?", file: "corrective.js", names: ["filterChunks"] },
  { question: "How does the app decide a question is general, simple or complex?", file: "router.js", names: ["routeQuestion"] },
  { question: "How is cosine similarity calculated?", file: "embed.js", names: ["cosineSimilarity"] },
  { question: "How are passwords hashed and tokens created at signup?", file: "auth.js", names: ["signup"] },
  { question: "How does the server check that a token is valid?", file: "auth.js", names: ["requireAuth"] },
  { question: "How are answers cached and when do they expire?", file: "cache.js" },
  { question: "How does the LLM call retry when the service is busy?", file: "llm.js", names: ["askLLM"] },
  { question: "How are code files split into function-sized chunks?", file: "chunk.js", names: ["chunkJs", "chunkFile"] },
  { question: "Where is the vector table created in the database?", file: "db.js", names: ["setupDb"] },
  { question: "How are only changed files re-embedded?", file: "store.js", names: ["syncFolder"] },
  { question: "How does the code stop users from reading folders outside the allowed root?", file: "projects.js" },
  { question: "How are keywords from the question matched against chunk names?", file: "search.js", names: ["keywordScore"] },
  { question: "How is the final prompt built from the retrieved chunks?", file: "pipeline.js", names: ["generate"] },
  { question: "How does the project turn text into 384 numbers?", file: "embed.js", names: ["embed"] },
  { question: "Which function splits camelCase names into words?", file: "search.js", names: ["words"] },
];

// The codebase has nothing about these: the correct behavior is "not found"
export const unanswerable = [
  "How does payment processing work?",
  "How is the Stripe webhook verified?",
  "Where are email notifications sent?",
  "How does the shopping cart calculate tax?",
  "How are images uploaded to the cloud?",
];