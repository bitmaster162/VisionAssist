import {
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import path from "node:path";

import {
  BenchmarkContractError,
  validateArtifact,
  validateCaseManifest,
  validateOutcome
} from "./contract.js";
import {
  readJson,
  sha256CanonicalJsonFile,
  sha256File,
  sha256Json
} from "./canonical-json.js";

const ARTIFACTS = Object.freeze([
  {
    kind: "case",
    filename: "case.json",
    phase: "CASE_FROZEN"
  },
  {
    kind: "human_prior",
    filename: "human_prior.json",
    phase: "HUMAN_PRIOR_FROZEN"
  },
  {
    kind: "ai_assessment",
    filename: "ai_assessment.json",
    phase: "AI_ASSESSMENT_FROZEN"
  },
  {
    kind: "fusion_revision",
    filename: "fusion_revision.json",
    phase: "FUSION_REVISION_FROZEN"
  },
  {
    kind: "baseline_forecast",
    filename: "baseline_forecast.json",
    phase: "BASELINE_FROZEN"
  },
  {
    kind: "outcome",
    filename: "outcome.json",
    phase: "OUTCOME_REVEALED"
  },
  {
    kind: "adjudication",
    filename: "adjudication.json",
    phase: "ADJUDICATION_FROZEN"
  },
  {
    kind: "post_outcome_review",
    filename: "post_outcome_review.json",
    phase: "POST_OUTCOME_REVIEW_FROZEN"
  }
]);

const artifactByKind = new Map(ARTIFACTS.map((artifact, index) => [
  artifact.kind,
  { ...artifact, index }
]));
const artifactByPhase = new Map(ARTIFACTS.map((artifact, index) => [
  artifact.phase,
  { ...artifact, index }
]));

function requireCondition(condition, message, code = "benchmark_lifecycle_error") {
  if (!condition) {
    throw new BenchmarkContractError(message, code);
  }
}

function resolveCaseDir(caseDirectory) {
  return path.resolve(caseDirectory);
}

function artifactPath(caseDirectory, kind) {
  const artifact = artifactByKind.get(kind);
  requireCondition(artifact, `Unknown artifact kind ${kind}`);
  return path.join(resolveCaseDir(caseDirectory), artifact.filename);
}

function receiptPath(caseDirectory) {
  return path.join(resolveCaseDir(caseDirectory), "receipt.json");
}

function writeJsonAtomic(filePath, value) {
  const directory = path.dirname(filePath);
  mkdirSync(directory, { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;

  try {
    writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx"
    });
    renameSync(temporaryPath, filePath);
  } finally {
    if (existsSync(temporaryPath)) {
      rmSync(temporaryPath);
    }
  }
}

function chainDigest(entry) {
  return sha256Json({
    case_id: entry.case_id,
    sequence: entry.sequence,
    kind: entry.kind,
    artifact_sha256: entry.artifact_sha256,
    previous_chain_sha256: entry.previous_chain_sha256,
    frozen_at: entry.frozen_at
  });
}

function appendChain(receipt, kind, artifactSha256, frozenAt = new Date().toISOString()) {
  const previous = receipt.chain.at(-1) ?? null;
  const entry = {
    case_id: receipt.case_id,
    sequence: receipt.chain.length,
    kind,
    artifact_sha256: artifactSha256,
    previous_chain_sha256: previous?.chain_sha256 ?? null,
    frozen_at: frozenAt,
    chain_sha256: ""
  };
  entry.chain_sha256 = chainDigest(entry);
  receipt.chain.push(entry);
  receipt.phase = artifactByKind.get(kind).phase;
  return receipt;
}

function validateReceiptShape(receipt) {
  requireCondition(
    receipt?.schema_version === "visionassist.benchmark.receipt.v1",
    "wrong receipt schema_version"
  );
  requireCondition(typeof receipt.case_id === "string", "receipt.case_id is required");
  requireCondition(artifactByPhase.has(receipt.phase), "receipt phase is invalid");
  requireCondition(Array.isArray(receipt.chain), "receipt.chain must be an array");
  requireCondition(receipt.chain.length >= 1, "receipt.chain cannot be empty");

  for (const [index, entry] of receipt.chain.entries()) {
    requireCondition(entry.case_id === receipt.case_id, `receipt chain ${index} case mismatch`);
    requireCondition(entry.sequence === index, `receipt chain ${index} sequence mismatch`);
    requireCondition(
      entry.kind === ARTIFACTS[index]?.kind,
      `receipt chain ${index} kind is out of order`
    );
    requireCondition(
      entry.previous_chain_sha256 === (index === 0 ? null : receipt.chain[index - 1].chain_sha256),
      `receipt chain ${index} previous hash mismatch`
    );
    requireCondition(entry.chain_sha256 === chainDigest(entry), `receipt chain ${index} is invalid`);
  }

  const lastEntry = receipt.chain.at(-1);
  requireCondition(
    artifactByKind.get(lastEntry.kind).phase === receipt.phase,
    "receipt phase does not match chain"
  );
}

function assertFutureArtifactsAbsent(caseDirectory, currentIndex, allowIndex = null) {
  for (let index = currentIndex + 1; index < ARTIFACTS.length; index += 1) {
    if (index === allowIndex) {
      continue;
    }
    const candidatePath = path.join(resolveCaseDir(caseDirectory), ARTIFACTS[index].filename);
    requireCondition(
      !existsSync(candidatePath),
      `${ARTIFACTS[index].filename} exists before its freeze phase`,
      "hindsight_leakage_risk"
    );
  }
}

export function verifyCase(caseDirectory, { allowNextKind = null } = {}) {
  const resolvedDirectory = resolveCaseDir(caseDirectory);
  const casePath = artifactPath(resolvedDirectory, "case");
  const receiptFile = receiptPath(resolvedDirectory);
  requireCondition(existsSync(casePath), "case.json is missing");
  requireCondition(existsSync(receiptFile), "receipt.json is missing");

  const caseManifest = readJson(casePath);
  validateCaseManifest(caseManifest);
  const evidencePath = path.resolve(resolvedDirectory, caseManifest.evidence.asset_path);
  const relativeEvidencePath = path.relative(resolvedDirectory, evidencePath);
  requireCondition(
    relativeEvidencePath && !relativeEvidencePath.startsWith("..") && !path.isAbsolute(relativeEvidencePath),
    "evidence asset escapes the case directory"
  );
  requireCondition(existsSync(evidencePath), "evidence asset is missing");
  requireCondition(
    sha256File(evidencePath) === caseManifest.evidence.sha256,
    "evidence asset hash mismatch"
  );

  const receipt = readJson(receiptFile);
  validateReceiptShape(receipt);
  requireCondition(receipt.case_id === caseManifest.case_id, "receipt case mismatch");
  requireCondition(
    receipt.case_manifest_sha256 === sha256CanonicalJsonFile(casePath),
    "case manifest changed after freeze"
  );
  requireCondition(
    receipt.evidence_sha256 === caseManifest.evidence.sha256,
    "receipt evidence hash mismatch"
  );
  requireCondition(
    receipt.outcome_commitment_sha256 === caseManifest.outcome_commitment_sha256,
    "receipt outcome commitment mismatch"
  );

  const context = { caseManifest };
  for (const entry of receipt.chain.slice(1)) {
    const frozenPath = artifactPath(resolvedDirectory, entry.kind);
    requireCondition(existsSync(frozenPath), `${entry.kind} artifact is missing`);
    requireCondition(
      sha256CanonicalJsonFile(frozenPath) === entry.artifact_sha256,
      `${entry.kind} changed after freeze`
    );
    const record = readJson(frozenPath);
    validateArtifact(entry.kind, record, context);

    if (entry.kind === "ai_assessment") {
      context.aiAssessment = record;
    } else if (entry.kind === "fusion_revision") {
      context.fusionRevision = record;
    } else if (entry.kind === "outcome") {
      requireCondition(
        entry.artifact_sha256 === caseManifest.outcome_commitment_sha256,
        "revealed outcome does not match commitment"
      );
      context.outcome = record;
    }
  }

  const current = artifactByPhase.get(receipt.phase);
  const allowed = allowNextKind ? artifactByKind.get(allowNextKind) : null;
  if (allowNextKind) {
    requireCondition(
      allowed?.index === current.index + 1,
      `${allowNextKind} is not the next legal phase`
    );
  }
  assertFutureArtifactsAbsent(resolvedDirectory, current.index, allowed?.index ?? null);

  return {
    valid: true,
    case_id: caseManifest.case_id,
    domain: caseManifest.domain,
    split: caseManifest.split,
    phase: receipt.phase,
    chain_sha256: receipt.chain.at(-1).chain_sha256,
    frozen_artifacts: receipt.chain.length,
    context,
    receipt
  };
}

export function freezeCase(caseDirectory, sealedOutcomePath, { frozenAt } = {}) {
  const resolvedDirectory = resolveCaseDir(caseDirectory);
  const casePath = artifactPath(resolvedDirectory, "case");
  const receiptFile = receiptPath(resolvedDirectory);
  requireCondition(existsSync(casePath), "case.json is missing");
  requireCondition(!existsSync(receiptFile), "case is already frozen");
  assertFutureArtifactsAbsent(resolvedDirectory, 0);

  const manifest = readJson(casePath);
  validateCaseManifest(manifest);
  const evidencePath = path.resolve(resolvedDirectory, manifest.evidence.asset_path);
  requireCondition(existsSync(evidencePath), "evidence asset is missing");
  requireCondition(
    sha256File(evidencePath) === manifest.evidence.sha256,
    "evidence asset hash mismatch"
  );

  const resolvedOutcomePath = path.resolve(sealedOutcomePath);
  const outcomeRelative = path.relative(resolvedDirectory, resolvedOutcomePath);
  requireCondition(
    outcomeRelative.startsWith("..") || path.isAbsolute(outcomeRelative),
    "sealed outcome must remain outside the case directory"
  );
  requireCondition(existsSync(resolvedOutcomePath), "sealed outcome file is missing");
  const sealedOutcome = readJson(resolvedOutcomePath);
  validateOutcome(sealedOutcome, manifest);
  requireCondition(
    sha256CanonicalJsonFile(resolvedOutcomePath) === manifest.outcome_commitment_sha256,
    "sealed outcome commitment mismatch"
  );

  const receipt = {
    schema_version: "visionassist.benchmark.receipt.v1",
    case_id: manifest.case_id,
    phase: "CASE_FROZEN",
    case_manifest_sha256: sha256CanonicalJsonFile(casePath),
    evidence_sha256: manifest.evidence.sha256,
    outcome_commitment_sha256: manifest.outcome_commitment_sha256,
    chain: []
  };
  appendChain(receipt, "case", receipt.case_manifest_sha256, frozenAt);
  writeJsonAtomic(receiptFile, receipt);
  return verifyCase(resolvedDirectory);
}

export function freezeStage(caseDirectory, kind, { frozenAt } = {}) {
  requireCondition(
    kind !== "case" && kind !== "outcome" && artifactByKind.has(kind),
    `Unsupported freeze-stage kind ${kind}`
  );
  const current = verifyCase(caseDirectory, { allowNextKind: kind });
  const candidatePath = artifactPath(caseDirectory, kind);
  requireCondition(existsSync(candidatePath), `${path.basename(candidatePath)} is missing`);

  const record = readJson(candidatePath);
  validateArtifact(kind, record, current.context);
  const artifactSha256 = sha256CanonicalJsonFile(candidatePath);
  appendChain(current.receipt, kind, artifactSha256, frozenAt);
  writeJsonAtomic(receiptPath(caseDirectory), current.receipt);
  return verifyCase(caseDirectory);
}

export function revealOutcome(caseDirectory, sealedOutcomePath, { frozenAt } = {}) {
  const current = verifyCase(caseDirectory, { allowNextKind: "outcome" });
  const resolvedOutcomePath = path.resolve(sealedOutcomePath);
  requireCondition(existsSync(resolvedOutcomePath), "sealed outcome file is missing");
  const outcome = readJson(resolvedOutcomePath);
  validateOutcome(outcome, current.context.caseManifest);
  const outcomeHash = sha256CanonicalJsonFile(resolvedOutcomePath);
  requireCondition(
    outcomeHash === current.context.caseManifest.outcome_commitment_sha256,
    "outcome reveal does not match precommitted hash"
  );

  const targetPath = artifactPath(caseDirectory, "outcome");
  requireCondition(!existsSync(targetPath), "outcome.json already exists");
  writeJsonAtomic(targetPath, outcome);
  try {
    appendChain(current.receipt, "outcome", outcomeHash, frozenAt);
    writeJsonAtomic(receiptPath(caseDirectory), current.receipt);
  } catch (error) {
    rmSync(targetPath, { force: true });
    throw error;
  }
  return verifyCase(caseDirectory);
}

export function outcomeCommitment(sealedOutcomePath) {
  return sha256CanonicalJsonFile(path.resolve(sealedOutcomePath));
}

export function listArtifactDefinitions() {
  return ARTIFACTS;
}

export function loadVerifiedCase(caseDirectory) {
  const verification = verifyCase(caseDirectory);
  const records = {};
  for (const entry of verification.receipt.chain) {
    records[entry.kind] = readJson(artifactPath(caseDirectory, entry.kind));
  }
  return {
    verification,
    records
  };
}
