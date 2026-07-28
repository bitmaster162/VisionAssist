import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateIntentRecord } from "../src/intent-contract.js";

const edgeRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const defaultRecord = path.resolve(
  edgeRoot,
  "..",
  "..",
  "contracts",
  "intent-r26",
  "chart_intent_record.json"
);
const recordPath = path.resolve(process.argv[2] ?? defaultRecord);

try {
  const record = JSON.parse(readFileSync(recordPath, "utf8"));
  const validation = validateIntentRecord(record);
  console.log(JSON.stringify({
    file: recordPath,
    ...validation
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    file: recordPath,
    valid: false,
    code: error.code ?? "validation_failed",
    error: error.message
  }, null, 2));
  process.exitCode = 1;
}

