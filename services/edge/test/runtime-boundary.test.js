import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const edgeRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const repoRoot = path.resolve(edgeRoot, "..", "..");

test("intent runtime exposes no execution or order route", () => {
  const serverSource = readFileSync(
    path.join(repoRoot, "services", "edge", "src", "server.js"),
    "utf8"
  );
  const forbiddenRoutes = ["/trade", "/execute", "/orders", "/positions", "/broker"];

  for (const route of forbiddenRoutes) {
    assert.equal(serverSource.includes(route), false, `${route} must not exist`);
  }
});

test("mobile pilot flags require the explicit product-dev profile", () => {
  const profileSource = readFileSync(
    path.join(repoRoot, "apps", "mobile", "lib", "config", "product_profile.dart"),
    "utf8"
  );

  assert.match(profileSource, /defaultValue: 'android-pilot'/);
  assert.match(profileSource, /enableOcr = isProductDevelopment && _requestedOcr/);
  assert.match(profileSource, /enableVoiceCommands = isProductDevelopment && _requestedVoiceCommands/);
});

test("all one-shot OpenAI requests disable Responses application-state storage", () => {
  const openAiSource = readFileSync(
    path.join(repoRoot, "services", "edge", "src", "openai.js"),
    "utf8"
  );

  assert.equal((openAiSource.match(/store: false/g) ?? []).length, 3);
  assert.equal(openAiSource.includes("privacy.faces"), false);
});
