import { pool, setupDb } from "./db.js";

try {
  await setupDb();
  const r = await pool.query("SELECT COUNT(*) FROM chunks");
  console.log("Database connected. Rows in chunks:", r.rows[0].count);
} catch (err) {
  console.error("DB failed:", err.message);
}
await pool.end();