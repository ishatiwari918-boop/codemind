import express from "express";
import path from "path";
import rateLimit from "express-rate-limit";
import { setupDb, pool } from "./db.js";
import { signup, login, requireAuth } from "./auth.js";
import projectsRouter from "./projects.js";

// Hosting platforms tell the app which port to use
const PORT = process.env.PORT || 3000;

const app = express();
// Behind a hosting proxy, trust one hop so rate limits see the real client address
app.set("trust proxy", 1);
app.use(express.json({ limit: "10kb" }));

// Signup and login: 20 attempts per 15 minutes per client (slows password guessing)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please try again later." },
});

// Serves public/index.html at "/" (the chat UI)
app.use(express.static(path.join(import.meta.dirname, "public")));

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.post("/auth/signup", authLimiter, signup);
app.post("/auth/login", authLimiter, login);
app.get("/me", requireAuth, (req, res) => res.json({ user: req.user }));

app.use("/projects", projectsRouter);

try {
  await setupDb();
  // A restart interrupts any indexing that was running
  await pool.query(
    "UPDATE projects SET status = 'failed', error = 'Server restarted during indexing.' WHERE status = 'indexing'"
  );
} catch (err) {
  console.error("Startup failed:", err.message);
  process.exit(1);
}

app.listen(PORT, () => {
  console.log(`CodeMind server running on port ${PORT}`);
});