import { embed } from "./embed.js";

const mb = () => Math.round(process.memoryUsage().rss / 1048576);

console.log("before model:", mb(), "MB");
await embed("warm up");
console.log("after model loaded:", mb(), "MB");

let peak = mb();
for (let i = 0; i < 200; i++) {
  await embed(`function number ${i} does something with chunks and scores`);
  peak = Math.max(peak, mb());
}
console.log("peak after 200 embeds:", peak, "MB");