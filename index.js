import { buildIndex, answerQuestion } from "./pipeline.js";

const folder = process.argv[2];
const question = process.argv[3];
if (!folder || !question) {
  console.log('Usage: node index.js "<folder>" "<question>"');
  process.exit(1);
}

try {
  const result = await answerQuestion(question, () => buildIndex(folder));
  console.log("\nAnswer:\n" + result.answer);
} catch (err) {
  console.error("Failed:", err.message);
}