import fs from "fs";
import path from "path";

const SKIP = ["node_modules", ".git", "dist", "eval"];
const EXTENSIONS = [".js", ".md"];

export function walk(dir) {
  let files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (SKIP.includes(entry.name) || entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(walk(full));
    } else if (EXTENSIONS.includes(path.extname(entry.name))) {
      files.push(full);
    }
  }
  return files;
}