import path from "path";
import * as acorn from "acorn";

const MAX_LINES = 60; // functions longer than this are split into smaller parts

// Cut a line range into overlapping pieces
function lineChunks(filePath, lines, startLine, endLine, name, size = 40, overlap = 5) {
  const out = [];
  for (let s = startLine; s <= endLine; s += size - overlap) {
    const e = Math.min(s + size - 1, endLine);
    out.push({
      file: filePath,
      name,
      startLine: s,
      endLine: e,
      text: lines.slice(s - 1, e).join("\n"),
    });
    if (e === endLine) break;
  }
  return out;
}

// Include comment lines directly above a function (they often explain it)
function withComments(lines, start) {
  let s = start;
  while (s > 1) {
    const prev = lines[s - 2].trim();
    if (prev.startsWith("//") || prev.startsWith("/*") || prev.startsWith("*")) s--;
    else break;
  }
  return s;
}

// Is this top-level node a function or class? If so, what is it called?
function describe(node) {
  let n = node;
  if ((n.type === "ExportNamedDeclaration" || n.type === "ExportDefaultDeclaration") && n.declaration) {
    n = n.declaration;
  }
  if (n.type === "FunctionDeclaration") return { name: n.id ? n.id.name : "default" };
  if (n.type === "ClassDeclaration") return { name: n.id ? n.id.name : "default" };
  if (n.type === "VariableDeclaration") {
    const d = n.declarations[0];
    const init = d && d.init;
    if (init && (init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression")) {
      return { name: d.id.name };
    }
  }
  return null;
}

function chunkJs(filePath, text) {
  const lines = text.split("\n");
  const ast = acorn.parse(text, { ecmaVersion: "latest", sourceType: "module", locations: true });
  const chunks = [];
  let misc = null; // consecutive top-level statements that are not functions

  const addRange = (name, start, end) => {
    if (end - start + 1 > MAX_LINES) {
      chunks.push(...lineChunks(filePath, lines, start, end, `${name} (part)`));
    } else {
      chunks.push({
        file: filePath,
        name,
        startLine: start,
        endLine: end,
        text: lines.slice(start - 1, end).join("\n"),
      });
    }
  };

  const flushMisc = () => {
    if (misc) addRange("top-level code", misc.start, misc.end);
    misc = null;
  };

  for (const node of ast.body) {
    const info = describe(node);
    const start = node.loc.start.line;
    const end = node.loc.end.line;

    if (info) {
      flushMisc();
      addRange(info.name, withComments(lines, start), end);
    } else if (misc) {
      misc.end = end;
    } else {
      misc = { start, end };
    }
  }
  flushMisc();
  return chunks;
}

export function chunkFile(filePath, text, linesPerChunk = 30, overlap = 5) {
  if (path.extname(filePath) === ".js") {
    try {
      const chunks = chunkJs(filePath, text);
      if (chunks.length > 0) return chunks;
    } catch {
      // file could not be parsed: fall back to plain line chunks below
    }
  }
  const lines = text.split("\n");
  return lineChunks(filePath, lines, 1, lines.length, "text", linesPerChunk, overlap);
}