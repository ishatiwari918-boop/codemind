import express from "express";
import { buildIndex, answerQuestion } from "./pipeline.js";

const PORT = 3000;
const FOLDER = process.argv[2];

if (!FOLDER) {
  console.log('Usage: node server.js "<folder to index>"');
  process.exit(1);
}

const app = express();
app.use(express.json());

// The index lives here, in memory, after startup
let indexedChunks = null;
let indexing = true;

app.get("/", (req, res) => {
  res.send('CodeMind API is running. Send POST /ask with { "question": "..." }');
});

app.get("/health", (req, res) => {
  res.json({
    status: indexing ? "indexing" : "ok",
    chunks: indexedChunks ? indexedChunks.length : 0,
  });
});

app.post("/ask", async (req, res) => {
  const question = req.body?.question;

  if (!question || typeof question !== "string") {
    return res.status(400).json({ error: 'Send JSON like { "question": "..." }' });
  }
  if (indexing) {
    return res.status(503).json({ error: "Still indexing the codebase. Try again in a moment." });
  }

  try {
    const started = Date.now();
    // Reuse the chunks built at startup instead of re-embedding every time
    const result = await answerQuestion(question, async () => indexedChunks);
    res.json({
      route: result.route,
      answer: result.answer,
      sources: result.sources.map(c => ({
        file: c.file,
        name: c.name,
        startLine: c.startLine,
        endLine: c.endLine,
        score: Number(c.finalScore.toFixed(3)),
      })),
      tookMs: Date.now() - started,
    });
  } catch (err) {
    console.error("Request failed:", err.message);
    res.status(500).json({ error: "Something went wrong while answering." });
  }
});

// Start listening first, then build the index in the background
app.listen(PORT, async () => {
  console.log(`CodeMind server running at http://localhost:${PORT}`);
  console.log(`Indexing folder: ${FOLDER}`);
  try {
    indexedChunks = await buildIndex(FOLDER);
    indexing = false;
    console.log(`Index ready: ${indexedChunks.length} chunks`);
  } catch (err) {
    console.error("Indexing failed:", err.message);
    process.exit(1);
  }
});