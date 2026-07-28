import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import path from "node:path";

import {
  readJson,
  sha256CanonicalJsonFile,
  sha256File,
  sha256Json,
  sha256Text
} from "./canonical-json.js";
import { prepareCase } from "./intake.js";
import { freezeCase, verifyCase } from "./lifecycle.js";
import { renderAgentIntentPng } from "./png-chart.js";

export const VISUAL_PROTOCOL_ID = "synthetic-agent-intent-control-v1";
export const VISUAL_GENERATOR_VERSION = "visionassist-agent-scene-v1";

const LABELS = Object.freeze([
  "left_target",
  "right_target",
  "hold_position"
]);
const LAYOUTS = Object.freeze([
  "open_field",
  "central_barrier",
  "split_columns",
  "upper_gate",
  "offset_wall"
]);
const VISIBLE_STEPS = 6;
const OUTCOME_STEPS = 20;
const DEFAULT_ROLES = Object.freeze({
  curator_id: "r29-visual-curator-001",
  outcome_custodian_id: "r29-visual-custodian-001",
  human_analyst_id: "r29-visual-analyst-001",
  adjudicator_id: "r29-visual-adjudicator-001"
});

function requireCondition(condition, message, code = "visual_corpus_error") {
  if (!condition) {
    const error = new Error(message);
    error.code = code;
    throw error;
  }
}

function writeJsonExclusive(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx"
  });
}

function writeBufferExclusive(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, value, { flag: "wx" });
}

function visualPaths(samplingRoot, vaultRoot) {
  return {
    protocol: path.join(
      path.resolve(samplingRoot),
      "visual-sampling-protocol-v1.json"
    ),
    commitment: path.join(
      path.resolve(samplingRoot),
      "visual-candidate-pool.commitment.json"
    ),
    pool: path.join(
      path.resolve(vaultRoot),
      "visual-candidate-pool.json"
    ),
    secret: path.join(
      path.resolve(vaultRoot),
      "visual-sampling-secret.json"
    )
  };
}

function hiddenKey(seed, ...parts) {
  return sha256Text([VISUAL_GENERATOR_VERSION, seed, ...parts].join("\u0000"));
}

function hiddenOrder(seed, purpose) {
  return (left, right) =>
    hiddenKey(seed, purpose, String(left)).localeCompare(
      hiddenKey(seed, purpose, String(right))
    );
}

function hiddenCandidateOrder(seed, purpose) {
  const key = (candidate) =>
    hiddenKey(
      seed,
      purpose,
      candidate.layout,
      candidate.outcome_label
    );
  return (left, right) => key(left).localeCompare(key(right));
}

function unit(seed, ...parts) {
  const digest = hiddenKey(seed, ...parts);
  return Number.parseInt(digest.slice(0, 13), 16) / 0xfffffffffffff;
}

export function buildVisualCandidatePool(seed) {
  requireCondition(
    typeof seed === "string" && seed.length >= 32,
    "Visual sampling seed must contain at least 32 characters."
  );
  const layoutOrder = [...LAYOUTS].sort(hiddenOrder(seed, "holdout-layout"));
  const labelOrder = [...LABELS].sort(hiddenOrder(seed, "holdout-label"));
  const holdoutPattern = [0, 1, 2, 0, 1];
  const holdoutSet = new Set(layoutOrder.map((layout, index) =>
    `${layout}|${labelOrder[holdoutPattern[index]]}`
  ));
  const development = [];
  const holdout = [];

  for (const layout of LAYOUTS) {
    for (const outcomeLabel of LABELS) {
      const candidate = {
        source: "deterministic_synthetic_agent_scene",
        layout,
        outcome_label: outcomeLabel,
        variant_seed_sha256: hiddenKey(
          seed,
          "scene",
          layout,
          outcomeLabel
        ),
        visible_steps: VISIBLE_STEPS,
        outcome_steps: OUTCOME_STEPS
      };
      if (holdoutSet.has(`${layout}|${outcomeLabel}`)) {
        holdout.push(candidate);
      } else {
        development.push(candidate);
      }
    }
  }

  development.sort(hiddenCandidateOrder(seed, "development-slot"));
  holdout.sort(hiddenCandidateOrder(seed, "holdout-slot"));
  requireCondition(
    development.length === 10 && holdout.length === 5,
    "Visual split must contain 10 development and 5 holdout cases."
  );

  const candidates = [
    ...development.map((candidate, index) => ({
      case_id: `VIS-${String(index + 1).padStart(3, "0")}`,
      split: "development",
      ...candidate
    })),
    ...holdout.map((candidate, index) => ({
      case_id: `VIS-${String(index + 11).padStart(3, "0")}`,
      split: "blinded_holdout",
      ...candidate
    }))
  ];
  requireCondition(
    new Set(candidates.map((candidate) =>
      `${candidate.layout}|${candidate.outcome_label}`
    )).size === 15,
    "Visual candidate pool contains duplicate strata."
  );
  for (const label of LABELS) {
    requireCondition(
      candidates.filter((candidate) => candidate.outcome_label === label).length === 5,
      `Visual outcome ${label} must appear exactly five times.`
    );
  }

  return {
    schema_version: "visionassist.benchmark.visual-candidate-pool.v1",
    protocol_id: VISUAL_PROTOCOL_ID,
    generator_version: VISUAL_GENERATOR_VERSION,
    candidates
  };
}

export function registerVisualCandidatePool({
  samplingRoot,
  vaultRoot,
  seed = randomBytes(32).toString("hex"),
  now = new Date().toISOString()
}) {
  const paths = visualPaths(samplingRoot, vaultRoot);
  Object.values(paths).forEach((filePath) =>
    requireCondition(!existsSync(filePath), `${filePath} already exists`)
  );
  const pool = buildVisualCandidatePool(seed);
  const poolCommitment = sha256Json(pool);
  const seedCommitment = sha256Text(seed);
  const commitment = {
    schema_version: "visionassist.benchmark.visual-pool-commitment.v1",
    protocol_id: VISUAL_PROTOCOL_ID,
    frozen_at: now,
    candidate_count: 15,
    case_ids_sha256: sha256Json(
      pool.candidates.map((candidate) => candidate.case_id)
    ),
    candidate_pool_commitment_sha256: poolCommitment,
    seed_commitment_sha256: seedCommitment,
    generator_version: VISUAL_GENERATOR_VERSION
  };
  const protocol = {
    schema_version: "visionassist.benchmark.sampling-protocol.v1",
    protocol_id: VISUAL_PROTOCOL_ID,
    status: "FROZEN",
    frozen_at: now,
    source: {
      family: "deterministic_synthetic_agent_scene",
      generator_version: VISUAL_GENERATOR_VERSION,
      external_media: false,
      personal_data: false
    },
    corpus: {
      case_count: 15,
      development_slots: "VIS-001..010",
      blinded_holdout_slots: "VIS-011..015",
      layouts: [...LAYOUTS],
      visible_steps: VISIBLE_STEPS,
      outcome_steps: OUTCOME_STEPS
    },
    selection: {
      method: "Pre-register all 5 layout x 3 latent-policy strata; hidden-seed permutation assigns opaque development and holdout slots before rendering.",
      rendered_evidence_or_future_used_for_selection: false,
      hidden_seed_custodian_only: true,
      slot_to_latent_policy_mapping_public: false,
      seed_commitment_sha256: seedCommitment,
      candidate_pool_commitment_sha256: poolCommitment,
      generator_version: VISUAL_GENERATOR_VERSION
    },
    outcome: {
      labels: [...LABELS],
      horizon: "next 20 deterministic simulation steps",
      resolution_rule: "Resolve to the pre-registered latent policy reached by the final simulated agent position: left target, right target, or hold position.",
      should_abstain_rule: "True only if the generated evidence, future frame, trace, or commitment fails validation."
    },
    claims_boundary: {
      evidence_role: "SYNTHETIC_NON_MARKET_CONTROL",
      natural_scene_generality: "NOT_ESTABLISHED",
      production_value: "NOT_ESTABLISHED"
    },
    authority: {
      decision_status: "DIAGNOSTIC_ONLY",
      action_code: "NO_ACTION",
      execution_permission: "HOLD",
      capital_permission: "DENY",
      can_trade: false
    }
  };
  const secret = {
    schema_version: "visionassist.benchmark.visual-sampling-secret.v1",
    protocol_id: VISUAL_PROTOCOL_ID,
    seed,
    seed_commitment_sha256: seedCommitment,
    created_at: now,
    access_class: "OUTCOME_CUSTODIAN_ONLY"
  };
  const created = [];
  try {
    writeJsonExclusive(paths.protocol, protocol);
    created.push(paths.protocol);
    writeJsonExclusive(paths.commitment, commitment);
    created.push(paths.commitment);
    writeJsonExclusive(paths.pool, pool);
    created.push(paths.pool);
    writeJsonExclusive(paths.secret, secret);
    created.push(paths.secret);
  } catch (error) {
    for (const filePath of created.reverse()) {
      rmSync(filePath, { force: true });
    }
    throw error;
  }
  return {
    protocol_id: VISUAL_PROTOCOL_ID,
    status: "FROZEN",
    frozen_at: now,
    candidate_count: 15,
    candidate_pool_commitment_sha256: poolCommitment,
    seed_commitment_sha256: seedCommitment,
    evidence_role: "SYNTHETIC_NON_MARKET_CONTROL",
    natural_scene_generality: "NOT_ESTABLISHED"
  };
}

export function verifyVisualCandidatePool({ samplingRoot, vaultRoot }) {
  const paths = visualPaths(samplingRoot, vaultRoot);
  Object.values(paths).forEach((filePath) =>
    requireCondition(existsSync(filePath), `${filePath} is missing`)
  );
  const protocol = readJson(paths.protocol);
  const commitment = readJson(paths.commitment);
  const pool = readJson(paths.pool);
  const secret = readJson(paths.secret);
  requireCondition(protocol.status === "FROZEN", "Visual protocol is not frozen.");
  requireCondition(
    protocol.protocol_id === VISUAL_PROTOCOL_ID &&
      commitment.protocol_id === VISUAL_PROTOCOL_ID &&
      pool.protocol_id === VISUAL_PROTOCOL_ID &&
      secret.protocol_id === VISUAL_PROTOCOL_ID,
    "Visual protocol identifiers do not match."
  );
  requireCondition(
    sha256Text(secret.seed) === secret.seed_commitment_sha256 &&
      secret.seed_commitment_sha256 === commitment.seed_commitment_sha256 &&
      commitment.seed_commitment_sha256 ===
        protocol.selection.seed_commitment_sha256,
    "Visual seed commitment mismatch."
  );
  const regenerated = buildVisualCandidatePool(secret.seed);
  requireCondition(
    sha256Json(regenerated) === sha256Json(pool),
    "Visual candidate pool does not match the frozen generator."
  );
  requireCondition(
    sha256Json(pool) === commitment.candidate_pool_commitment_sha256 &&
      commitment.candidate_pool_commitment_sha256 ===
        protocol.selection.candidate_pool_commitment_sha256,
    "Visual pool commitment mismatch."
  );
  return {
    valid: true,
    protocol,
    commitment,
    pool,
    secret,
    paths
  };
}

function obstaclesFor(layout) {
  switch (layout) {
    case "central_barrier":
      return [{ x: 430, y: 185, width: 100, height: 190 }];
    case "split_columns":
      return [
        { x: 300, y: 210, width: 65, height: 170 },
        { x: 595, y: 210, width: 65, height: 170 }
      ];
    case "upper_gate":
      return [
        { x: 235, y: 235, width: 205, height: 48 },
        { x: 520, y: 235, width: 205, height: 48 }
      ];
    case "offset_wall":
      return [{ x: 390, y: 155, width: 58, height: 225 }];
    default:
      return [];
  }
}

function bezier(start, control, end, t) {
  const inverse = 1 - t;
  return {
    x:
      inverse * inverse * start.x +
      2 * inverse * t * control.x +
      t * t * end.x,
    y:
      inverse * inverse * start.y +
      2 * inverse * t * control.y +
      t * t * end.y
  };
}

export function buildVisualScene(candidate) {
  const seed = candidate.variant_seed_sha256;
  const targets = [
    {
      x: 125 + unit(seed, "left-x") * 55,
      y: 80 + unit(seed, "left-y") * 80,
      radius: 27,
      shape: "circle"
    },
    {
      x: 780 + unit(seed, "right-x") * 55,
      y: 80 + unit(seed, "right-y") * 80,
      radius: 25,
      shape: "square"
    }
  ];
  const agent = {
    x: 430 + unit(seed, "agent-x") * 100,
    y: 440 + unit(seed, "agent-y") * 35,
    radius: 12
  };
  const intendedTarget = candidate.outcome_label === "left_target"
    ? targets[0]
    : candidate.outcome_label === "right_target"
      ? targets[1]
      : agent;
  const directionLength = Math.hypot(
    intendedTarget.x - agent.x,
    intendedTarget.y - agent.y
  ) || 1;
  const direction = candidate.outcome_label === "hold_position"
    ? {
        x: (unit(seed, "hold-dx") - 0.5) * 2,
        y: (unit(seed, "hold-dy") - 0.5) * 2
      }
    : {
        x: (intendedTarget.x - agent.x) / directionLength,
        y: (intendedTarget.y - agent.y) / directionLength
      };
  const visibleTrail = Array.from({ length: VISIBLE_STEPS }, (_, index) => {
    const age = VISIBLE_STEPS - 1 - index;
    const jitter = (unit(seed, "trail-jitter", String(index)) - 0.5) * 8;
    return {
      x: agent.x - direction.x * age * 17 + direction.y * jitter,
      y: agent.y - direction.y * age * 17 - direction.x * jitter
    };
  });

  let futureTrail;
  if (candidate.outcome_label === "hold_position") {
    futureTrail = Array.from({ length: OUTCOME_STEPS }, (_, index) => ({
      x: agent.x + Math.sin(index * 0.8) * 4,
      y: agent.y + Math.cos(index * 0.65) * 4
    }));
  } else {
    const target = candidate.outcome_label === "left_target"
      ? targets[0]
      : targets[1];
    const side = candidate.outcome_label === "left_target" ? -1 : 1;
    const control = {
      x: agent.x + side * (150 + unit(seed, "control-x") * 90),
      y: 185 + unit(seed, "control-y") * 70
    };
    futureTrail = Array.from({ length: OUTCOME_STEPS }, (_, index) =>
      bezier(agent, control, target, (index + 1) / OUTCOME_STEPS)
    );
  }

  return {
    schema_version: "visionassist.benchmark.agent-scene.v1",
    layout: candidate.layout,
    targets,
    obstacles: obstaclesFor(candidate.layout),
    visible_trail: visibleTrail,
    agent,
    future_trail: futureTrail
  };
}

function publicReceiptPath(samplingRoot, caseId) {
  return path.join(
    path.resolve(samplingRoot),
    "frozen-case-receipts",
    `${caseId}.json`
  );
}

export function publishVisualCaseFreezeReceipt({
  caseId,
  samplingRoot,
  vaultRoot,
  casesRoot
}) {
  const poolVerification = verifyVisualCandidatePool({ samplingRoot, vaultRoot });
  requireCondition(
    poolVerification.pool.candidates.some((candidate) => candidate.case_id === caseId),
    `${caseId} is not in the frozen visual pool.`
  );
  const caseDirectory = path.join(path.resolve(casesRoot), caseId);
  const caseVerification = verifyCase(caseDirectory);
  const manifest = caseVerification.context.caseManifest;
  const firstEntry = caseVerification.receipt.chain[0];
  const receipt = {
    schema_version: "visionassist.benchmark.visual-case-freeze-receipt.v1",
    benchmark_id: "VISIONASSIST_CHART_INTENT_AND_HUMAN_AI_FUSION_PROOF",
    case_id: caseId,
    split: manifest.split,
    phase_at_publication: "CASE_FROZEN",
    protocol_id: VISUAL_PROTOCOL_ID,
    candidate_pool_commitment_sha256:
      poolVerification.commitment.candidate_pool_commitment_sha256,
    case_manifest_sha256: sha256CanonicalJsonFile(
      path.join(caseDirectory, "case.json")
    ),
    evidence_sha256: manifest.evidence.sha256,
    outcome_commitment_sha256: manifest.outcome_commitment_sha256,
    initial_chain_sha256: firstEntry.chain_sha256,
    case_frozen_at: firstEntry.frozen_at,
    evidence_role: "SYNTHETIC_NON_MARKET_CONTROL",
    latent_policy_exposed: false,
    outcome_exposed: false,
    natural_scene_generality_claimed: false,
    claims_boundary: "This receipt proves local synthetic-control artifact consistency only. It is not natural-scene, production, operator-identity, or independent-custody proof.",
    authority: {
      decision_status: "DIAGNOSTIC_ONLY",
      action_code: "NO_ACTION",
      execution_permission: "HOLD",
      capital_permission: "DENY",
      can_trade: false
    }
  };
  const outputPath = publicReceiptPath(samplingRoot, caseId);
  writeJsonExclusive(outputPath, receipt);
  return { case_id: caseId, public_receipt_path: outputPath, receipt };
}

export function verifyPublishedVisualCaseFreezeReceipt({
  caseId,
  samplingRoot,
  vaultRoot,
  casesRoot
}) {
  const poolVerification = verifyVisualCandidatePool({ samplingRoot, vaultRoot });
  const candidate = poolVerification.pool.candidates.find(
    (item) => item.case_id === caseId
  );
  requireCondition(candidate, `${caseId} is not in the frozen visual pool.`);
  const caseDirectory = path.join(path.resolve(casesRoot), caseId);
  const caseVerification = verifyCase(caseDirectory);
  const manifest = caseVerification.context.caseManifest;
  const receiptPath = publicReceiptPath(samplingRoot, caseId);
  const outcomePath = path.join(
    path.resolve(vaultRoot),
    "outcomes",
    `${caseId}.json`
  );
  const tracePath = path.join(
    path.resolve(vaultRoot),
    "visual-traces",
    `${caseId}.json`
  );
  const futureFramePath = path.join(
    path.resolve(vaultRoot),
    "visual-future",
    `${caseId}.png`
  );
  requireCondition(existsSync(receiptPath), `${caseId} public receipt is missing.`);
  requireCondition(existsSync(outcomePath), `${caseId} sealed outcome is missing.`);
  requireCondition(existsSync(tracePath), `${caseId} simulation trace is missing.`);
  requireCondition(existsSync(futureFramePath), `${caseId} future frame is missing.`);
  const receipt = readJson(receiptPath);
  const outcome = readJson(outcomePath);
  const trace = readJson(tracePath);
  const firstEntry = caseVerification.receipt.chain[0];
  requireCondition(
    receipt.phase_at_publication === "CASE_FROZEN" &&
      receipt.case_id === caseId,
    `${caseId} public receipt phase mismatch.`
  );
  requireCondition(
    receipt.candidate_pool_commitment_sha256 ===
      poolVerification.commitment.candidate_pool_commitment_sha256,
    `${caseId} visual pool commitment mismatch.`
  );
  requireCondition(
    receipt.case_manifest_sha256 ===
      sha256CanonicalJsonFile(path.join(caseDirectory, "case.json")) &&
      receipt.evidence_sha256 === manifest.evidence.sha256 &&
      receipt.outcome_commitment_sha256 ===
        manifest.outcome_commitment_sha256 &&
      receipt.initial_chain_sha256 === firstEntry.chain_sha256,
    `${caseId} visual receipt artifact hash mismatch.`
  );
  requireCondition(
    sha256Json(outcome) === manifest.outcome_commitment_sha256,
    `${caseId} visual outcome commitment mismatch.`
  );
  requireCondition(
    outcome.evidence_refs.includes(
      `simulation-trace-sha256:${sha256Json(trace)}`
    ),
    `${caseId} simulation trace is not bound to outcome.`
  );
  requireCondition(
    outcome.evidence_refs.includes(
      `future-frame-sha256:${sha256File(futureFramePath)}`
    ),
    `${caseId} future frame is not bound to outcome.`
  );
  const manifestText = readFileSync(
    path.join(caseDirectory, "case.json"),
    "utf8"
  );
  requireCondition(
    !manifestText.includes(candidate.layout) &&
      !manifestText.includes("\"outcome_label\""),
    `${caseId} exposes hidden visual state.`,
    "hindsight_leakage_risk"
  );
  requireCondition(
    receipt.latent_policy_exposed === false &&
      receipt.outcome_exposed === false &&
      receipt.natural_scene_generality_claimed === false,
    `${caseId} public receipt exceeds its claims boundary.`
  );
  return {
    valid: true,
    case_id: caseId,
    split: manifest.split,
    phase: caseVerification.phase,
    evidence_sha256: manifest.evidence.sha256
  };
}

export function verifyCompleteVisualCorpus({
  samplingRoot,
  vaultRoot,
  casesRoot
}) {
  const poolVerification = verifyVisualCandidatePool({ samplingRoot, vaultRoot });
  const results = poolVerification.pool.candidates.map((candidate) =>
    verifyPublishedVisualCaseFreezeReceipt({
      caseId: candidate.case_id,
      samplingRoot,
      vaultRoot,
      casesRoot
    })
  );
  const geometryRows = poolVerification.pool.candidates.map((candidate) => {
    const trace = readJson(path.join(
      path.resolve(vaultRoot),
      "visual-traces",
      `${candidate.case_id}.json`
    ));
    requireCondition(
      trace.visible_steps.length === VISIBLE_STEPS,
      `${candidate.case_id} visual trace must contain ${VISIBLE_STEPS} visible steps.`
    );
    requireCondition(
      trace.future_steps.length === OUTCOME_STEPS,
      `${candidate.case_id} visual trace must contain ${OUTCOME_STEPS} future steps.`
    );
    const inFrame = trace.visible_steps.filter((point) =>
      point.x >= 24 &&
      point.x <= 936 &&
      point.y >= 20 &&
      point.y <= 520
    ).length;
    return {
      case_id: candidate.case_id,
      generated_visible_steps: trace.visible_steps.length,
      visible_steps_inside_frame: inFrame
    };
  });
  requireCondition(results.length === 15, "Visual corpus must contain 15 cases.");
  requireCondition(
    new Set(results.map((result) => result.evidence_sha256)).size === 15,
    "Visual corpus contains duplicate evidence assets."
  );
  const phaseCounts = {};
  for (const result of results) {
    phaseCounts[result.phase] = (phaseCounts[result.phase] ?? 0) + 1;
  }
  return {
    valid: true,
    protocol_id: VISUAL_PROTOCOL_ID,
    candidate_pool_commitment_sha256:
      poolVerification.commitment.candidate_pool_commitment_sha256,
    visual_cases: results.length,
    development_cases: results.filter((result) => result.split === "development").length,
    blinded_holdout_cases: results.filter((result) =>
      result.split === "blinded_holdout"
    ).length,
    unique_evidence_assets: new Set(
      results.map((result) => result.evidence_sha256)
    ).size,
    phase_counts: phaseCounts,
    evidence_role: "SYNTHETIC_NON_MARKET_CONTROL",
    latent_policy_exposed: false,
    outcome_exposed: false,
    natural_scene_generality: "NOT_ESTABLISHED",
    geometry_qa: {
      status: geometryRows.every((row) =>
        row.visible_steps_inside_frame === VISIBLE_STEPS
      )
        ? "PASS"
        : "USABLE_WITH_LIMITATION",
      generated_visible_steps_per_case: VISIBLE_STEPS,
      fully_visible_cases: geometryRows.filter((row) =>
        row.visible_steps_inside_frame === VISIBLE_STEPS
      ).length,
      partially_clipped_cases: geometryRows.filter((row) =>
        row.visible_steps_inside_frame < VISIBLE_STEPS
      ),
      minimum_visible_steps_inside_frame: Math.min(
        ...geometryRows.map((row) => row.visible_steps_inside_frame)
      )
    },
    authority: {
      decision_status: "DIAGNOSTIC_ONLY",
      action_code: "NO_ACTION",
      execution_permission: "HOLD",
      capital_permission: "DENY",
      can_trade: false
    }
  };
}

export async function bootstrapVisualCase({
  caseId,
  samplingRoot,
  vaultRoot,
  casesRoot,
  roles = DEFAULT_ROLES,
  now = new Date().toISOString()
}) {
  const poolVerification = verifyVisualCandidatePool({ samplingRoot, vaultRoot });
  const candidate = poolVerification.pool.candidates.find(
    (item) => item.case_id === caseId
  );
  requireCondition(candidate, `${caseId} is not in the frozen visual pool.`);
  const resolvedVaultRoot = path.resolve(vaultRoot);
  const resolvedCasesRoot = path.resolve(casesRoot);
  const caseDirectory = path.join(resolvedCasesRoot, caseId);
  requireCondition(!existsSync(caseDirectory), `${caseId} already exists.`);

  const scene = buildVisualScene(candidate);
  const evidence = renderAgentIntentPng(scene);
  const futureFrame = renderAgentIntentPng(scene, { revealFuture: true });
  const trace = {
    schema_version: "visionassist.benchmark.visual-simulation-trace.v1",
    case_id: caseId,
    protocol_id: VISUAL_PROTOCOL_ID,
    generator_version: VISUAL_GENERATOR_VERSION,
    layout: candidate.layout,
    latent_policy: candidate.outcome_label,
    visible_steps: scene.visible_trail,
    future_steps: scene.future_trail,
    targets: scene.targets,
    obstacles: scene.obstacles,
    generated_at: now
  };
  const traceHash = sha256Json(trace);
  const futureFrameHash = createHash("sha256").update(futureFrame).digest("hex");
  const evidencePath = path.join(
    resolvedVaultRoot,
    "visual-evidence-staging",
    `${caseId}.png`
  );
  const futureFramePath = path.join(
    resolvedVaultRoot,
    "visual-future",
    `${caseId}.png`
  );
  const tracePath = path.join(
    resolvedVaultRoot,
    "visual-traces",
    `${caseId}.json`
  );
  const outcomePath = path.join(
    resolvedVaultRoot,
    "outcomes",
    `${caseId}.json`
  );
  const intakePath = path.join(
    resolvedVaultRoot,
    "intake",
    `${caseId}.json`
  );
  const outcome = {
    schema_version: "visionassist.benchmark.outcome.v1",
    case_id: caseId,
    custodian_id: roles.outcome_custodian_id,
    sealed_at: now,
    outcome_label: candidate.outcome_label,
    outcome_summary: `The deterministic agent policy resolved to ${candidate.outcome_label} after 20 simulation steps.`,
    observation_window: "deterministic simulation steps 1 through 20",
    should_abstain: false,
    evidence_refs: [
      `simulation-trace-sha256:${traceHash}`,
      `future-frame-sha256:${futureFrameHash}`
    ]
  };
  const intake = {
    schema_version: "visionassist.benchmark.case-intake.v1",
    case_id: caseId,
    modality: "scene_image",
    sampling: {
      candidate_id: `candidate-${caseId}`,
      protocol_id: VISUAL_PROTOCOL_ID,
      source_family: "deterministic-synthetic-agent-scene-v1",
      stratum: "non-market-agent-intent-control",
      timeframe: null,
      selected_without_outcome_access: true
    },
    captured_at: now,
    cutoff_description: "The image contains two possible targets, obstacles, one agent, and six visible historical positions. No future position or latent policy is rendered.",
    provenance: `Synthetic control generated under pool commitment ${poolVerification.commitment.candidate_pool_commitment_sha256}. No external media or personal data.`,
    outcome_definition: {
      labels: [...LABELS],
      horizon: "next 20 deterministic simulation steps",
      resolution_rule: poolVerification.protocol.outcome.resolution_rule,
      should_abstain_rule:
        poolVerification.protocol.outcome.should_abstain_rule
    },
    roles,
    created_at: now
  };

  const created = [];
  try {
    writeBufferExclusive(evidencePath, evidence);
    created.push(evidencePath);
    writeBufferExclusive(futureFramePath, futureFrame);
    created.push(futureFramePath);
    writeJsonExclusive(tracePath, trace);
    created.push(tracePath);
    writeJsonExclusive(outcomePath, outcome);
    created.push(outcomePath);
    writeJsonExclusive(intakePath, intake);
    created.push(intakePath);
    const prepared = prepareCase({
      intakePath,
      evidenceSourcePath: evidencePath,
      sealedOutcomePath: outcomePath,
      casesRoot: resolvedCasesRoot
    });
    const frozen = freezeCase(prepared.case_directory, outcomePath, {
      frozenAt: now
    });
    const publicReceipt = publishVisualCaseFreezeReceipt({
      caseId,
      samplingRoot,
      vaultRoot,
      casesRoot: resolvedCasesRoot
    });
    created.push(publicReceipt.public_receipt_path);
    return {
      case_id: caseId,
      phase: frozen.phase,
      split: frozen.split,
      evidence_sha256: frozen.context.caseManifest.evidence.sha256,
      outcome_commitment_sha256:
        frozen.context.caseManifest.outcome_commitment_sha256,
      chain_sha256: frozen.chain_sha256,
      evidence_role: "SYNTHETIC_NON_MARKET_CONTROL",
      latent_policy_exposed: false,
      outcome_exposed: false,
      natural_scene_generality: "NOT_ESTABLISHED",
      next_required_stage: "HUMAN_PRIOR_FROZEN"
    };
  } catch (error) {
    if (existsSync(caseDirectory)) {
      rmSync(caseDirectory, { recursive: true, force: true });
    }
    for (const filePath of created.reverse()) {
      rmSync(filePath, { force: true });
    }
    throw error;
  }
}
