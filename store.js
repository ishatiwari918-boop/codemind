import fs from "fs";
import path from "path";
import { pool } from "./db.js";
import { walk } from "./scan.js";
import { chunkFile } from "./chunk.js";
import { embed } from "./embed.js";

const toVector = v => `[${v.join(",")}]`;

// Sync one project's folder into the database. Only new or changed files are embedded.
export async function syncFolder(projectId, folder) {
  const files = walk(folder);

  const existing = await pool.query(
    "SELECT file, MAX(modified) AS modified FROM chunks WHERE project_id = $1 GROUP BY file",
    [projectId]
  );
  const known = new Map(existing.rows.map(r => [r.file, new Date(r.modified).getTime()]));

  let updated = 0;
  for (const f of files) {
    const modified = fs.statSync(f).mtime;
    if (known.get(f) === modified.getTime()) continue; // unchanged: skip

    await pool.query("DELETE FROM chunks WHERE project_id = $1 AND file = $2", [projectId, f]);
    for (const c of chunkFile(f, fs.readFileSync(f, "utf-8"))) {
      const vector = await embed(`${path.basename(f)} ${c.name}\n${c.text}`);
      await pool.query(
        `INSERT INTO chunks (project, project_id, file, name, start_line, end_line, text, modified, embedding)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [folder, projectId, f, c.name, c.startLine, c.endLine, c.text, modified, toVector(vector)]
      );
    }
    updated++;
  }

  // Remove chunks of files that no longer exist
  const alive = new Set(files);
  for (const f of known.keys()) {
    if (!alive.has(f)) {
      await pool.query("DELETE FROM chunks WHERE project_id = $1 AND file = $2", [projectId, f]);
    }
  }

  const count = await pool.query("SELECT COUNT(*) FROM chunks WHERE project_id = $1", [projectId]);
  console.log(`Project ${projectId}: ${files.length} files (${updated} updated), ${count.rows[0].count} chunks`);
}

// Load one project's chunks (same shape the pipeline already uses)
export async function loadChunks(projectId) {
  const res = await pool.query(
    `SELECT file, name, start_line, end_line, text, modified, embedding::text AS embedding
     FROM chunks WHERE project_id = $1`,
    [projectId]
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