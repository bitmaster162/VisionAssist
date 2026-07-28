import {
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import path from "node:path";

import {
  BenchmarkContractError,
  getExpectedSlot,
  validateCaseManifest,
  validateOutcome
} from "./contract.js";
import {
  readJson,
  sha256CanonicalJsonFile,
  sha256File
} from "./canonical-json.js";

const ALLOWED_EVIDENCE_EXTENSIONS = new Set([
  ".jpeg",
  ".jpg",
  ".png",
  ".webp"
]);

function requireCondition(condition, message) {
  if (!condition) {
    throw new BenchmarkContractError(message, "benchmark_intake_error");
  }
}

function requireString(value, pathName) {
  requireCondition(
    typeof value === "string" && value.trim().length > 0,
    `${pathName} must be a non-empty string`
  );
}

function requireExactKeys(value, keys, pathName) {
  requireCondition(
    value && typeof value === "object" && !Array.isArray(value),
    `${pathName} must be an object`
  );
  const expected = new Set(keys);
  keys.forEach((key) =>
    requireCondition(Object.hasOwn(value, key), `${pathName}.${key} is required`)
  );
  Object.keys(value).forEach((key) =>
    requireCondition(expected.has(key), `${pathName}.${key} is not allowed`)
  );
}

function validateIntake(intake) {
  requireExactKeys(intake, [
    "schema_version",
    "case_id",
    "modality",
    "sampling",
    "captured_at",
    "cutoff_description",
    "provenance",
    "outcome_definition",
    "roles",
    "created_at"
  ], "intake");
  requireCondition(
    intake.schema_version === "visionassist.benchmark.case-intake.v1",
    "wrong intake schema_version"
  );
  requireString(intake.case_id, "intake.case_id");
  requireString(intake.modality, "intake.modality");
  requireCondition(
    intake.sampling && typeof intake.sampling === "object",
    "intake.sampling must be an object"
  );
  requireString(intake.captured_at, "intake.captured_at");
  requireString(intake.cutoff_description, "intake.cutoff_description");
  requireString(intake.provenance, "intake.provenance");
  requireString(intake.created_at, "intake.created_at");
  requireCondition(
    intake.outcome_definition && typeof intake.outcome_definition === "object",
    "intake.outcome_definition must be an object"
  );
  requireCondition(
    intake.roles && typeof intake.roles === "object",
    "intake.roles must be an object"
  );
}

export function prepareCase({
  intakePath,
  evidenceSourcePath,
  sealedOutcomePath,
  casesRoot
}) {
  const intake = readJson(path.resolve(intakePath));
  validateIntake(intake);
  const slot = getExpectedSlot(intake.case_id);
  const sourceEvidence = path.resolve(evidenceSourcePath);
  const sourceOutcome = path.resolve(sealedOutcomePath);
  const resolvedCasesRoot = path.resolve(casesRoot);
  const caseDirectory = path.join(resolvedCasesRoot, intake.case_id);

  requireCondition(existsSync(sourceEvidence), "evidence source file is missing");
  requireCondition(existsSync(sourceOutcome), "sealed outcome file is missing");
  requireCondition(!existsSync(caseDirectory), `${intake.case_id} already exists`);
  const evidenceStat = statSync(sourceEvidence);
  requireCondition(evidenceStat.isFile() && evidenceStat.size > 0, "evidence source must be a non-empty file");
  requireCondition(
    evidenceStat.size <= 25 * 1024 * 1024,
    "evidence source exceeds the 25 MB intake limit"
  );
  const extension = path.extname(sourceEvidence).toLowerCase();
  requireCondition(
    ALLOWED_EVIDENCE_EXTENSIONS.has(extension),
    "evidence source must be JPEG, PNG, or WebP"
  );
  requireCondition(
    sourceOutcome !== sourceEvidence,
    "evidence and sealed outcome must be different files"
  );

  const relativeOutcome = path.relative(resolvedCasesRoot, sourceOutcome);
  requireCondition(
    relativeOutcome.startsWith("..") || path.isAbsolute(relativeOutcome),
    "sealed outcome must stay outside the cases root"
  );

  const evidenceRelativePath = `evidence/source${extension}`;
  const evidenceTarget = path.join(caseDirectory, evidenceRelativePath);
  mkdirSync(path.dirname(evidenceTarget), { recursive: true });

  try {
    copyFileSync(sourceEvidence, evidenceTarget);
    const manifest = {
      schema_version: "visionassist.benchmark.case.v1",
      case_id: intake.case_id,
      domain: slot.domain,
      split: slot.split,
      modality: intake.modality,
      sampling: intake.sampling,
      evidence: {
        asset_path: evidenceRelativePath,
        sha256: sha256File(evidenceTarget),
        captured_at: intake.captured_at,
        cutoff_description: intake.cutoff_description,
        provenance: intake.provenance
      },
      outcome_definition: intake.outcome_definition,
      roles: intake.roles,
      outcome_commitment_sha256: sha256CanonicalJsonFile(sourceOutcome),
      created_at: intake.created_at,
      authority: {
        decision_status: "DIAGNOSTIC_ONLY",
        action_code: "NO_ACTION",
        execution_permission: "HOLD",
        capital_permission: "DENY",
        can_trade: false
      }
    };
    validateCaseManifest(manifest);
    validateOutcome(readJson(sourceOutcome), manifest);

    const manifestPath = path.join(caseDirectory, "case.json");
    const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
    writeFileSync(manifestPath, manifestText, "utf8");

    return {
      case_id: manifest.case_id,
      case_directory: caseDirectory,
      case_manifest: manifestPath,
      evidence_sha256: manifest.evidence.sha256,
      outcome_commitment_sha256: manifest.outcome_commitment_sha256,
      status: "INGESTED_UNFROZEN"
    };
  } catch (error) {
    rmSync(caseDirectory, { recursive: true, force: true });
    throw error;
  }
}
