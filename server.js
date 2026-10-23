import express from "express";
import { buildIndex, answerQuestion } from "./pipeline.js";

const PORT = 3000;
// The folder CodeMind will answer questions about
const FOLDER = process.argv[2];

if (!FOLDER) {
  console.log('Usage: node server.js "<folder to index>"');
  process.exit(1);
}

const app = express();
app.use(express.json()); // lets the server read JSON request bodies

// Simple check that the server is alive
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// The main endpoint
app.post("/ask", async (req, res) => {
  const question = req.body?.question;

  if (!question || typeof question !== "string") {
    return res.status(400).json({ error: 'Send JSON like { "question": "..." }' });
  }

  try {
    const result = await answerQuestion(question, () => buildIndex(FOLDER));
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
    });
  } catch (err) {
    console.error("Request failed:", err.message);
    res.status(500).json({ error: "Something went wrong while answering." });
  }
});

app.listen(PORT, () => {
  console.log(`CodeMind server running at http://localhost:${PORT}`);
  console.log(`Indexing folder: ${FOLDER}`);
});