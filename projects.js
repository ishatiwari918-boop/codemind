import "dotenv/config";
import express from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import rateLimit from "express-rate-limit";
import { pool } from "./db.js";
import { syncFolder, loadChunks } from "./store.js";
import { answerQuestion } from "./pipeline.js";
import { getCached, setCached } from "./cache.js";
import { requireAuth } from "./auth.js";
import { parseGithubUrl, cloneRepo, CloneError } from "./github.js";

const ROOT = process.env.PROJECTS_ROOT;
if (!ROOT) {
  console.error("PROJECTS_ROOT is missing. Add it to .env");
  process.exit(1);
}
fs.mkdirSync(ROOT, { recursive: true }); // on a fresh server the folder may not exist yet
if (!fs.statSync(ROOT).isDirectory()) {
  console.error("PROJECTS_ROOT is not a folder.");
  process.exit(1);
}
const REAL_ROOT = fs.realpathSync(ROOT);
const CLONES = path.join(REAL_ROOT, "clones"); // GitHub clones live here

// Local folder names are for development only. A public server only accepts GitHub links.
const ALLOW_LOCAL = process.env.NODE_ENV !== "production";

const MAX_PROJECTS_PER_USER = 5;
const MAX_PARALLEL_INDEXING = 2;
let busy = 0;

function isInside(base, target) {
  const rel = path.relative(base, target);
  return rel !== "" && rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel);
}

// Returns the real path only if the folder exists AND stays inside the allowed root
function resolveInsideRoot(folderName) {
  const candidate = path.resolve(REAL_ROOT, folderName);
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) return null;
  const real = fs.realpathSync(candidate); // follows shortcuts to the true location
  return isInside(REAL_ROOT, real) ? real : null;
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

// For a GitHub project, clone first; then embed and store the chunks
async function indexInBackground(projectId, folder, cloneUrl = null) {
  busy++;
  try {
    if (cloneUrl) await cloneRepo(cloneUrl, folder);
    await syncFolder(projectId, folder);
    loaded.delete(projectId);
    await pool.query("UPDATE projects SET status = 'ready', error = NULL WHERE id = $1", [projectId]);
  } catch (err) {
    console.error(`Indexing project ${projectId} failed:`, err.message);
    const shown = err instanceof CloneError ? err.message : "Indexing failed.";
    await pool
      .query("UPDATE projects SET status = 'failed', error = $2 WHERE id = $1", [projectId, shown])
      .catch(() => {});
  } finally {
    busy--;
  }
}

const router = express.Router();
router.use(requireAuth); // every route below needs a valid token

router.post("/", createLimiter, async (req, res) => {
  const { name, folder, repoUrl } = req.body ?? {};

  if (typeof name !== "string" || name.trim().length === 0 || name.length > 60) {
    return res.status(400).json({ error: "Give the project a name (1 to 60 characters)." });
  }

  // Work out where the code comes from
  let target; // the folder on this server
  let cloneUrl = null;
  if (repoUrl !== undefined) {
    const parsed = parseGithubUrl(repoUrl);
    if (!parsed) {
      return res.status(400).json({ error: "Send a public GitHub link like https://github.com/owner/repo" });
    }
    cloneUrl = parsed.url;
    target = path.join(CLONES, `u${req.user.id}`, crypto.randomUUID());
  } else {
    if (!ALLOW_LOCAL) {
      return res.status(400).json({ error: "Add a project with a public GitHub link." });
    }
    if (typeof folder !== "string" || folder.length === 0 || folder.length > 200) {
      return res.status(400).json({ error: "Send the folder name to index." });
    }
    target = resolveInsideRoot(folder);
    if (!target) {
      return res.status(400).json({ error: "Folder not found inside the allowed projects folder." });
    }
  }

  if (busy >= MAX_PARALLEL_INDEXING) {
    return res.status(503).json({ error: "The server is busy indexing other projects. Try again in a minute." });
  }

  try {
    const count = await pool.query("SELECT COUNT(*)::int AS n FROM projects WHERE user_id = $1", [req.user.id]);
    if (count.rows[0].n >= MAX_PROJECTS_PER_USER) {
      return res.status(400).json({ error: `You can have up to ${MAX_PROJECTS_PER_USER} projects. Delete one first.` });
    }

    const result = await pool.query(
      "INSERT INTO projects (user_id, name, folder) VALUES ($1, $2, $3) RETURNING id, name, status",
      [req.user.id, name.trim(), target]
    );
    const project = result.rows[0];
    indexInBackground(project.id, target, cloneUrl); // not awaited: the user gets an answer right away
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
      `SELECT p.id, p.name, p.status, p.error, p.created_at,
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
    const result = await pool.query(
      "DELETE FROM projects WHERE id = $1 AND user_id = $2 RETURNING folder",
      [projectId, req.user.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "Project not found." });
    loaded.delete(projectId);

    // Remove the cloned copy, but never a local folder the user did not create through us
    const folder = result.rows[0].folder;
    if (isInside(CLONES, folder)) fs.rmSync(folder, { recursive: true, force: true });

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