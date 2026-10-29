import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { walk } from "./scan.js";

const run = promisify(execFile);

const MAX_FILES = 150; // indexed files (.js / .md) per project
const MAX_BYTES = 3_000_000; // total size of those files

// An error whose message is safe to show to the user
export class CloneError extends Error {}

// Only https://github.com/owner/repo (optionally ending in .git or /)
const URL_RE =
  /^https:\/\/github\.com\/([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100}?)(?:\.git)?\/?$/;

export function parseGithubUrl(input) {
  if (typeof input !== "string") return null;
  const m = URL_RE.exec(input.trim());
  if (!m) return null;
  const [, owner, repo] = m;
  if (/^\.+$/.test(owner) || /^\.+$/.test(repo)) return null;
  return { owner, repo, url: `https://github.com/${owner}/${repo}.git` };
}

// Shallow-clone a public repo into dest, drop .git, and enforce size limits.
// execFile (not exec) means no shell, so the URL can never run as a command.
export async function cloneRepo(url, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    await run(
      "git",
      [
        "-c", "core.symlinks=false", // symlinks become plain files
        "-c", "protocol.file.allow=never",
        "clone", "--depth", "1", "--single-branch", "--no-tags",
        "--", url, dest,
      ],
      {
        timeout: 60_000,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, // never ask for a password
      }
    );
  } catch {
    fs.rmSync(dest, { recursive: true, force: true });
    throw new CloneError("Could not clone the repository. Is it public and is the link correct?");
  }

  fs.rmSync(path.join(dest, ".git"), { recursive: true, force: true });

  const files = walk(dest);
  const bytes = files.reduce((sum, f) => sum + fs.statSync(f).size, 0);
  if (files.length === 0) {
    fs.rmSync(dest, { recursive: true, force: true });
    throw new CloneError("No .js or .md files found in that repository.");
  }
  if (files.length > MAX_FILES || bytes > MAX_BYTES) {
    fs.rmSync(dest, { recursive: true, force: true });
    throw new CloneError(
      `Repository is too large for the demo (limit: ${MAX_FILES} files, ${MAX_BYTES / 1e6} MB of .js/.md).`
    );
  }
  return files.length;
}