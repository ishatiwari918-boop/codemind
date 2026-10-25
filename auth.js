import "dotenv/config";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "./db.js";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error("JWT_SECRET is missing or too short. Add a long random string to .env");
  process.exit(1);
}

const TOKEN_TTL = "1h";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Used so a wrong email takes as long as a wrong password (no timing clue)
const DUMMY_HASH = bcrypt.hashSync("dummy-password", 10);

function makeToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

export async function signup(req, res) {
  const { email, password } = req.body ?? {};

  if (typeof email !== "string" || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "Enter a valid email." });
  }
  // bcrypt only uses the first 72 bytes, so we cap the length
  if (typeof password !== "string" || password.length < 8 || password.length > 72) {
    return res.status(400).json({ error: "Password must be 8 to 72 characters." });
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email",
      [email.toLowerCase(), hash]
    );
    const user = result.rows[0];
    res.status(201).json({ user, token: makeToken(user) });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "That email is already registered." });
    }
    console.error("Signup failed:", err.message);
    res.status(500).json({ error: "Something went wrong." });
  }
}

export async function login(req, res) {
  const { email, password } = req.body ?? {};
  if (typeof email !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "Send email and password." });
  }

  try {
    const result = await pool.query(
      "SELECT id, email, password_hash FROM users WHERE email = $1",
      [email.toLowerCase()]
    );
    const user = result.rows[0];
    const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);

    // Same message for wrong email and wrong password
    if (!user || !ok) {
      return res.status(401).json({ error: "Invalid email or password." });
    }
    res.json({ user: { id: user.id, email: user.email }, token: makeToken(user) });
  } catch (err) {
    console.error("Login failed:", err.message);
    res.status(500).json({ error: "Something went wrong." });
  }
}

// Middleware: lets a request through only if it carries a valid token
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: "Login required." });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.sub, email: payload.email };
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token." });
  }
}