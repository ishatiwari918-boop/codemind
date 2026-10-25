import express from "express";
import path from "path";
import rateLimit from "express-rate-limit";
import { answerQuestion } from "./pipeline.js";
import { setupDb } from "./db.js";
import { syncFolder, loadChunks } from "./store.js";
import { getCached, setCached } from "./cache.js";
import { signup, login, requireAuth } from "./auth.js";

const PORT = 3000;
const FOLDER = process.argv[2];

if (!FOLDER) {
  console.log('Usage: node server.js "<folder to index>"');
  process.exit(1);
}
const PROJECT = path.resolve(FOLDER);

const app = express();
app.use(express.json({ limit: "10kb" }));

let indexedChunks = null;
let indexing = true;

// Questions: 10 per minute per logged-in user
const askLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  keyGenerator: req => String(req.user.id),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait a minute and try again." },
});

// Signup and login: 20 attempts per 15 minutes per client (slows password guessing)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please try again later." },
});

app.get("/", (req, res) => {
  res.send("CodeMind API is running. Sign up at POST /auth/signup, then POST /ask with your token.");
});

app.get("/health", (req, res) => {
  res.json({
    status: indexing ? "indexing" : "ok",
    chunks: indexedChunks ? indexedChunks.length : 0,
  });
});

// Auth routes
app.post("/auth/signup", authLimiter, signup);
app.post("/auth/login", authLimiter, login);
app.get("/me", requireAuth, (req, res) => res.json({ user: req.user }));

// Protected: requireAuth runs first, then the per-user rate limit
app.post("/ask", requireAuth, askLimiter, async (req, res) => {
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