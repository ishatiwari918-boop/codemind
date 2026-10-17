export function chunkFile(filePath, text, linesPerChunk = 30, overlap = 5) {
  const lines = text.split("\n");
  const chunks = [];

  for (let start = 0; start < lines.length; start += linesPerChunk - overlap) {
    const end = Math.min(start + linesPerChunk, lines.length);
    chunks.push({
      file: filePath,
      startLine: start + 1,
      endLine: end,
      text: lines.slice(start, end).join("\n"),
    });
    if (end === lines.length) break;
  }
  return chunks;
}