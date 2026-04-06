import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let config = null;

function loadConfig() {
  if (config) return config;
  const configPath = path.join(__dirname, "../config/restrictions.json");
  config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  return config;
}

export function checkRestriction(question) {
  const { restrictedTopics, contactUrl } = loadConfig();
  const lower = question.toLowerCase();

  for (const topic of restrictedTopics) {
    const matched = topic.keywords.some(kw => lower.includes(kw.toLowerCase()));
    if (matched) {
      return {
        restricted: true,
        label: topic.label,
        contactUrl
      };
    }
  }

  return { restricted: false };
}
