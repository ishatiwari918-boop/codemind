import fs from "fs";
import { chunkFile } from "./chunk.js";

const file = process.argv[2];
chunkFile(file, fs.readFileSync(file, "utf-8")).forEach(c =>
  console.log(`${c.name}  | lines ${c.startLine}-${c.endLine}`)
);