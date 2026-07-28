import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { resolveProductProfile } from "./capabilities.js";

const envPath = path.resolve(process.cwd(), ".env");

if (existsSync(envPath)) {
  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const delimiterIndex = trimmed.indexOf("=");
    if (delimiterIndex < 0) {
      continue;
    }

    const key = trimmed.slice(0, delimiterIndex).trim();
    const rawValue = trimmed.slice(delimiterIndex + 1).trim();
    const value = rawValue.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function requiredString(name) {
  const value = process.env[name]?.trim();
  return value ? value : "";
}

const productProfile = resolveProductProfile(process.env.VISIONASSIST_PROFILE ?? "intent-r26");

export const config = {
  port: Number.parseInt(process.env.PORT ?? "8787", 10),
  listenHost: process.env.HOST?.trim() || "127.0.0.1",
  maxRequestBodyBytes: Number.parseInt(
    process.env.MAX_REQUEST_BODY_BYTES ?? "16777216",
    10
  ),
  corsOrigin: process.env.CORS_ORIGIN ?? "*",
  productProfile: productProfile.name,
  capabilities: productProfile.capabilities,
  openAiApiKey: requiredString("OPENAI_API_KEY"),
  openAiApiBaseUrl: (process.env.OPENAI_API_BASE_URL ?? "https://api.openai.com/v1").replace(/\/+$/, ""),
  describeModel: process.env.OPENAI_DESCRIBE_MODEL ?? "gpt-4o-mini",
  intentModel: process.env.OPENAI_INTENT_MODEL ?? process.env.OPENAI_DESCRIBE_MODEL ?? "gpt-4o-mini",
  ocrModel: process.env.OPENAI_OCR_MODEL ?? "gpt-4.1-mini",
  realtimeModel: process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime",
  realtimeVoice: process.env.OPENAI_REALTIME_VOICE ?? "marin"
};
