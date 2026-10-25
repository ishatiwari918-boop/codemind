import "dotenv/config";
import pg from "pg";

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

export async function setupDb() {
  await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chunks (
      id SERIAL PRIMARY KEY,
      project TEXT NOT NULL,
      file TEXT NOT NULL,
      name TEXT NOT NULL,
      start_line INT NOT NULL,
      end_line INT NOT NULL,
      text TEXT NOT NULL,
      modified TIMESTAMPTZ NOT NULL,
      embedding vector(384)
    )
  `);
  await pool.query("CREATE INDEX IF NOT EXISTS chunks_project_idx ON chunks (project)");
    await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
    await pool.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      folder TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'indexing',
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (user_id, name)
    )
  `);
  await pool.query(
    "ALTER TABLE chunks ADD COLUMN IF NOT EXISTS project_id INT REFERENCES projects(id) ON DELETE CASCADE"
  );
  await pool.query("CREATE INDEX IF NOT EXISTS chunks_project_id_idx ON chunks (project_id)");
  // Old rows from before projects existed belong to nobody: remove them
  await pool.query("DELETE FROM chunks WHERE project_id IS NULL");
}