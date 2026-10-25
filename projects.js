import "dotenv/config";
import express from "express";
import fs from "fs";
import path from "path";
import rateLimit from "express-rate-limit";
import { pool } from "./db.js";
import { syncFolder, loadChunks } from "./store.js";
import { answerQuestion } from "./pipeline.js";
import { getCached, setCached } from "./cache.js";
import { requireAuth } from "./auth.js";

const ROOT = process.env.PROJECTS_ROOT;
if (!ROOT || !fs.existsSync(ROOT) || !fs.statSync(ROOT).isDirectory()) {
  console.error("PROJECTS_ROOT is missing or not a folder. Add it to .env");
  process.exit(1);
}
const REAL_ROOT = fs.realpathSync(ROOT);

// Returns the real path only if the folder exists AND stays inside the allowed root
function resolveInsideRoot(folderName) {
  const candidate = path.resolve(REAL_ROOT, folderName);
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) return null;
  const real = fs.realpathSync(candidate); // follows shortcuts to the true location
  const rel = path.relative(REAL_ROOT, real);
  if (rel === "" || rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) {
    return null;
  }
  return real;
}

const byUser = req => String(req.user.id);

const askLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  keyGenerator: byUser,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait a minute and try again." },
});

// Indexing is expensive, so registering projects is limited too
const createLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  keyGenerator: byUser,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many projects created. Try again later." },
});

const loaded = new Map(); // projectId -> chunks kept in memory (relative paths only)

async function indexInBackground(projectId, folder) {
  try {
    await syncFolder(projectId, folder);
    loaded.delete(projectId);
    await pool.query("UPDATE projects SET status = 'ready', error = NULL WHERE id = $1", [projectId]);
  } catch (err) {
    console.error(`Indexing project ${projectId} failed:`, err.message);
    await pool
      .query("UPDATE projects SET status = 'failed', error = $2 WHERE id = $1", [projectId, "Indexing failed."])
      .catch(() => {});
  }
}

const router = express.Router();
router.use(requireAuth); // every route below needs a valid token

router.post("/", createLimiter, async (req, res) => {
  const { name, folder } = req.body ?? {};

  if (typeof name !== "string" || name.trim().length === 0 || name.length > 60) {
    return res.status(400).json({ error: "Give the project a name (1 to 60 characters)." });
  }
  if (typeof folder !== "string" || folder.length === 0 || folder.length > 200) {
    return res.status(400).json({ error: "Send the folder name to index." });
  }

  const real = resolveInsideRoot(folder);
  if (!real) {
    return res.status(400).json({ error: "Folder not found inside the allowed projects folder." });
  }

  try {
    const result = await pool.query(
      "INSERT INTO projects (user_id, name, folder) VALUES ($1, $2, $3) RETURNING id, name, status",
      [req.user.id, name.trim(), real]
    );
    const project = result.rows[0];
    indexInBackground(project.id, real); // not awaited: the user gets an answer right away
    res.status(202).json({ project });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "You already have a project with that name." });
    }
    console.error("Create project failed:", err.message);
    res.status(500).json({ error: "Something went wrong." });
  }
});

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.id, p.name, p.status, p.created_at,
              (SELECT COUNT(*) FROM chunks c WHERE c.project_id = p.id)::int AS chunks
       FROM projects p WHERE p.user_id = $1 ORDER BY p.id`,
      [req.user.id]
    );
    res.json({ projects: result.rows });
  } catch (err) {
    console.error("List projects failed:", err.message);
    res.status(500).json({ error: "Something went wrong." });
  }
});

router.delete("/:id", async (req, res) => {
  const projectId = Number(req.params.id);
  if (!Number.isInteger(projectId)) return res.status(404).json({ error: "Project not found." });

  try {
    const result = await pool.query("DELETE FROM projects WHERE id = $1 AND user_id = $2", [
      projectId,
      req.user.id,
    ]);
    if (result.rowCount === 0) return res.status(404).json({ error: "Project not found." });
    loaded.delete(projectId);
    res.json({ deleted: true });
  } catch (err) {
    console.error("Delete project failed:", err.message);
    res.status(500).json({ error: "Something went wrong." });
  }
});

router.post("/:id/ask", askLimiter, async (req, res) => {
  const projectId = Number(req.params.id);
  const question = req.body?.question;

  if (!Number.isInteger(projectId)) return res.status(404).json({ error: "Project not found." });
  if (!question || typeof question !== "string") {
    return res.status(400).json({ error: 'Send JSON like { "question": "..." }' });
  }
  if (question.length > 500) {
    return res.status(400).json({ error: "Question is too long (max 500 characters)." });
  }

  try {
    // Ownership check: the project must belong to the logged-in user
    const found = await pool.query(
      "SELECT id, folder, status FROM projects WHERE id = $1 AND user_id = $2",
      [projectId, req.user.id]
    );
    const project = found.rows[0];
    if (!project) return res.status(404).json({ error: "Project not found." });
    if (project.status === "indexing") {
      return res.status(503).json({ error: "Still indexing this project. Try again in a moment." });
    }
    if (project.status === "failed") {
      return res.status(409).json({ error: "Indexing failed for this project. Delete it and add it again." });
    }

    const started = Date.now();
    const cacheKey = `project:${projectId}`;

    const cached = getCached(cacheKey, question);
    if (cached) return res.json({ ...cached, cached: true, tookMs: Date.now() - started });

    let chunks = loaded.get(projectId);
    if (!chunks) {
      const raw = await loadChunks(projectId);
      // Relative paths only: the LLM and the user never see server folders
      chunks = raw.map(c => ({ ...c, file: path.relative(project.folder, c.file) }));
      loaded.set(projectId, chunks);
    }

    const result = await answerQuestion(question, async () => chunks);
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

    setCached(cacheKey, question, payload);
    res.json({ ...payload, cached: false, tookMs: Date.now() - started });
  } catch (err) {
    console.error("Request failed:", err.message);
    res.status(500).json({ error: "Something went wrong while answering." });
  }
});

export default router;