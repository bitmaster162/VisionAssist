import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical JSON does not allow non-finite numbers.");
    }
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }

  throw new TypeError(`Canonical JSON does not support ${typeof value}.`);
}

export function sha256Text(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function sha256Json(value) {
  return sha256Text(canonicalJson(value));
}

export function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

export function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

export function sha256CanonicalJsonFile(filePath) {
  return sha256Json(readJson(filePath));
}
