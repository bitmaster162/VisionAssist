import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { resolveProductProfile, supportedProductProfiles } from "../src/capabilities.js";

const releaseProfiles = JSON.parse(
  readFileSync(
    new URL("../../../docs/contracts/release-profiles.json", import.meta.url),
    "utf8"
  )
);

test("intent-r26 is the fail-closed core default", () => {
  const profile = resolveProductProfile();

  assert.equal(profile.name, "intent-r26");
  assert.deepEqual(profile.capabilities, {
    describe: false,
    ocr: false,
    realtime: false,
    intent: true
  });
});

test("android-pilot exposes Describe only when explicitly selected", () => {
  const profile = resolveProductProfile("android-pilot");

  assert.deepEqual(profile.capabilities, {
    describe: true,
    ocr: false,
    realtime: false,
    intent: false
  });
});

test("product-dev retains the prepared experimental routes", () => {
  const profile = resolveProductProfile("product-dev");

  assert.deepEqual(profile.capabilities, {
    describe: true,
    ocr: true,
    realtime: true,
    intent: true
  });
});

test("intent-r26 exposes the diagnostic module only", () => {
  const profile = resolveProductProfile("intent-r26");

  assert.deepEqual(profile.capabilities, {
    describe: false,
    ocr: false,
    realtime: false,
    intent: true
  });
});

test("unknown profiles are rejected", () => {
  assert.throws(
    () => resolveProductProfile("everything"),
    /Unsupported VISIONASSIST_PROFILE/
  );
});

test("supported profiles remain explicit", () => {
  assert.deepEqual(supportedProductProfiles, ["android-pilot", "product-dev", "intent-r26"]);
});

test("runtime profiles match the canonical release contract", () => {
  assert.equal(
    resolveProductProfile().name,
    releaseProfiles.default_runtime_profile
  );
  for (const name of supportedProductProfiles) {
    const runtime = resolveProductProfile(name);
    const documented = releaseProfiles.profiles[name];

    assert.equal(documented.kind, "runtime");
    assert.deepEqual(runtime.capabilities, {
      describe: documented.capabilities.describe,
      ocr: documented.capabilities.ocr,
      realtime: documented.capabilities.realtime,
      intent: documented.capabilities.intent
    });
  }
});
