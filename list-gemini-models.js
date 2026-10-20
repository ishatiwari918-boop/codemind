import "dotenv/config";

const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
  headers: { "x-goog-api-key": process.env.GEMINI_API_KEY },
});
const data = await res.json();

if (data.error) {
  console.error("Error:", data.error.message);
} else {
  console.log(
    data.models
      .filter(m => m.supportedGenerationMethods?.includes("generateContent"))
      .map(m => m.name)
  );
}