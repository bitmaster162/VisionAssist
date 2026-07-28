import {
  constants as fsConstants,
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import path from "node:path";

import { readJson } from "./canonical-json.js";
import { validateArtifact } from "./contract.js";
import { freezeStage, verifyCase } from "./lifecycle.js";

function requireCondition(condition, message, code = "human_prior_error") {
  if (!condition) {
    const error = new Error(message);
    error.code = code;
    throw error;
  }
}

function assertOutsideCase(caseDirectory, filePath) {
  const resolvedCase = path.resolve(caseDirectory);
  const resolvedFile = path.resolve(filePath);
  const relative = path.relative(resolvedCase, resolvedFile);
  requireCondition(
    relative.startsWith("..") || path.isAbsolute(relative),
    "Human-prior draft must remain outside the frozen case directory."
  );
  const benchmarkRoot = path.dirname(path.dirname(resolvedCase));
  const vaultRoot = path.join(benchmarkRoot, "outcome-vault");
  const relativeToVault = path.relative(vaultRoot, resolvedFile);
  requireCondition(
    relativeToVault.startsWith("..") || path.isAbsolute(relativeToVault),
    "Human-prior draft must remain outside the outcome vault."
  );
  return resolvedFile;
}

export function buildHumanPriorDraft(caseDirectory) {
  const verification = verifyCase(caseDirectory);
  requireCondition(
    verification.phase === "CASE_FROZEN",
    `${verification.case_id} must be at CASE_FROZEN before human-prior capture.`
  );
  const manifest = verification.context.caseManifest;
  return {
    schema_version: "visionassist.benchmark.human-prior.v1",
    case_id: manifest.case_id,
    analyst_id: manifest.roles.human_analyst_id,
    recorded_at: null,
    interpretation: "",
    competing_hypotheses: [],
    outcome_forecast: {
      probabilities: manifest.outcome_definition.labels.map((label) => ({
        label,
        probability: null
      })),
      abstain: false,
      abstention_reason: null
    },
    confidence: null,
    outcome_unseen_attestation: false,
    ai_unseen_attestation: false
  };
}

export function createHumanPriorDraft(caseDirectory, outputPath) {
  const resolvedOutput = assertOutsideCase(caseDirectory, outputPath);
  requireCondition(!existsSync(resolvedOutput), `${resolvedOutput} already exists.`);
  const draft = buildHumanPriorDraft(caseDirectory);
  mkdirSync(path.dirname(resolvedOutput), { recursive: true });
  writeFileSync(resolvedOutput, `${JSON.stringify(draft, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx"
  });
  return {
    case_id: draft.case_id,
    phase: "CASE_FROZEN",
    draft_path: resolvedOutput,
    draft_status: "INCOMPLETE_NOT_FREEZABLE",
    required_manual_fields: [
      "recorded_at",
      "interpretation",
      "competing_hypotheses",
      "outcome_forecast.probabilities",
      "confidence",
      "outcome_unseen_attestation",
      "ai_unseen_attestation"
    ],
    next_command:
      `node .\\tools\\benchmark.js submit-human-prior "${path.resolve(caseDirectory)}" "${resolvedOutput}"`
  };
}

export function submitHumanPrior(caseDirectory, completedDraftPath, {
  frozenAt
} = {}) {
  const resolvedCase = path.resolve(caseDirectory);
  const resolvedDraft = assertOutsideCase(resolvedCase, completedDraftPath);
  requireCondition(existsSync(resolvedDraft), `${resolvedDraft} is missing.`);
  const verification = verifyCase(resolvedCase, {
    allowNextKind: "human_prior"
  });
  const record = readJson(resolvedDraft);
  validateArtifact("human_prior", record, verification.context);

  const targetPath = path.join(resolvedCase, "human_prior.json");
  requireCondition(!existsSync(targetPath), `${targetPath} already exists.`);
  copyFileSync(resolvedDraft, targetPath, fsConstants.COPYFILE_EXCL);
  try {
    const frozen = freezeStage(resolvedCase, "human_prior", { frozenAt });
    return {
      case_id: frozen.case_id,
      phase: frozen.phase,
      chain_sha256: frozen.chain_sha256,
      frozen_artifacts: frozen.frozen_artifacts,
      source_draft_path: resolvedDraft,
      next_required_stage: "AI_ASSESSMENT_FROZEN"
    };
  } catch (error) {
    rmSync(targetPath, { force: true });
    throw error;
  }
}
