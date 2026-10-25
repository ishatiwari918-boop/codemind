import express from "express";
import path from "path";
import rateLimit from "express-rate-limit";
import { answerQuestion } from "./pipeline.js";
import { setupDb } from "./db.js";
import { syncFolder, loadChunks } from "./store.js";
import { getCached, setCached } from "./cache.js";

const PORT = 3000;
const FOLDER = process.argv[2];

if (!FOLDER) {
  console.log('Usage: node server.js "<folder to index>"');
  process.exit(1);
}
const PROJECT = path.resolve(FOLDER);

const app = express();
app.use(express.json({ limit: "10kb" })); // reject oversized request bodies

let indexedChunks = null;
let indexing = true;

// Rate limit: 10 questions per minute per client
const askLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait a minute and try again." },
});

app.get("/", (req, res) => {
  res.send('CodeMind API is running. Send POST /ask with { "question": "..." }');
});

app.get("/health", (req, res) => {
  res.json({
    status: indexing ? "indexing" : "ok",
    chunks: indexedChunks ? indexedChunks.length : 0,
  });
});

app.post("/ask", askLimiter, async (req, res) => {
  const question = req.body?.question;

  if (!question || typeof question !== "string") {
    return res.status(400).json({ error: 'Send JSON like { "question": "..." }' });
  }
  if (question.length > 500) {
    return res.status(400).json({ error: "Question is too long (max 500 characters)." });
  }
  if (indexing) {
    return res.status(503).json({ error: "Still indexing the codebase. Try again in a moment." });
  }

  try {
    const started = Date.now();

    // Cache check: same question, same project = instant answer
    const cached = getCached(PROJECT, question);
    if (cached) {
      return res.json({ ...cached, cached: true, tookMs: Date.now() - started });
    }

    const result = await answerQuestion(question, async () => indexedChunks);
    const payload = {
      route: result.route,
      answer: result.answer,
      sources: result.sources.map(c => ({
        file: c.file,
        name: c.name,
        startLine: c.startLine,
        endLine: c.endLine,
        score: Number(c.finalScore.toFixed(3)),
      })),
    };

    setCached(PROJECT, question, payload);
    res.json({ ...payload, cached: false, tookMs: Date.now() - started });
  } catch (err) {
    console.error("Request failed:", err.message);
    res.status(500).json({ error: "Something went wrong while answering." });
  }
});

app.listen(PORT, async () => {
  console.log(`CodeMind server running at http://localhost:${PORT}`);
  console.log(`Indexing folder: ${FOLDER}`);
  try {
    await setupDb();
    const project = await syncFolder(FOLDER);
    indexedChunks = await loadChunks(project);
    indexing = false;
    console.log(`Index ready: ${indexedChunks.length} chunks`);
  } catch (err) {
    console.error("Indexing failed:", err.message);
    process.exit(1);
  }
});