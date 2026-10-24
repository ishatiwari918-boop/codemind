import fs from "fs";
import path from "path";
import { pool } from "./db.js";
import { walk } from "./scan.js";
import { chunkFile } from "./chunk.js";
import { embed } from "./embed.js";

const toVector = v => `[${v.join(",")}]`;

// Sync a folder into the database. Only new or changed files are embedded.
export async function syncFolder(folder) {
  const project = path.resolve(folder);
  const files = walk(folder);

  const existing = await pool.query(
    "SELECT file, MAX(modified) AS modified FROM chunks WHERE project = $1 GROUP BY file",
    [project]
  );
  const known = new Map(existing.rows.map(r => [r.file, new Date(r.modified).getTime()]));

  let updated = 0;
  for (const f of files) {
    const modified = fs.statSync(f).mtime;
    if (known.get(f) === modified.getTime()) continue; // unchanged: skip

    await pool.query("DELETE FROM chunks WHERE project = $1 AND file = $2", [project, f]);
    for (const c of chunkFile(f, fs.readFileSync(f, "utf-8"))) {
      const vector = await embed(`${path.basename(f)} ${c.name}\n${c.text}`);
      await pool.query(
        `INSERT INTO chunks (project, file, name, start_line, end_line, text, modified, embedding)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [project, f, c.name, c.startLine, c.endLine, c.text, modified, toVector(vector)]
      );
    }
    updated++;
  }

  // Remove chunks of files that no longer exist
  const alive = new Set(files);
  for (const f of known.keys()) {
    if (!alive.has(f)) await pool.query("DELETE FROM chunks WHERE project = $1 AND file = $2", [project, f]);
  }

  const count = await pool.query("SELECT COUNT(*) FROM chunks WHERE project = $1", [project]);
  console.log(`Synced ${files.length} files (${updated} updated). Chunks in database: ${count.rows[0].count}`);
  return project;
}

// Load chunks from the database (same shape the pipeline already uses)
export async function loadChunks(project) {
  const res = await pool.query(
    `SELECT file, name, start_line, end_line, text, modified, embedding::text AS embedding
     FROM chunks WHERE project = $1`,
    [project]
  );
  return res.rows.map(r => ({
    file: r.file,
    name: r.name,
    startLine: r.start_line,
    endLine: r.end_line,
    text: r.text,
    modified: r.modified,
    vector: JSON.parse(r.embedding),
  }));
}