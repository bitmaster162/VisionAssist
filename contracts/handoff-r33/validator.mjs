import { createHash } from "node:crypto";

const AUTHORITY = Object.freeze({
  decision_status: "DIAGNOSTIC_ONLY",
  action_code: "NO_ACTION",
  execution_permission: "HOLD",
  capital_permission: "DENY",
  can_trade: false
});

function requireCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function validateSourceArtifact(artifact, repositoryBytes) {
  requireCondition(
    repositoryBytes.length === artifact.repository_copy_bytes,
    `${artifact.name} repository byte count mismatch`
  );
  requireCondition(
    sha256(repositoryBytes) === artifact.repository_copy_sha256,
    `${artifact.name} repository hash mismatch`
  );

  if (artifact.copy_mode === "BYTE_EXACT") {
    requireCondition(artifact.byte_exact === true, `${artifact.name} byte_exact mismatch`);
    requireCondition(
      artifact.source_bytes === repositoryBytes.length &&
        artifact.source_sha256 === sha256(repositoryBytes),
      `${artifact.name} is not byte exact`
    );
  } else {
    requireCondition(
      artifact.copy_mode === "TEXT_PRESERVED_TRAILING_LF_NORMALIZED" &&
        artifact.byte_exact === false,
      `${artifact.name} copy mode is unsupported`
    );
    requireCondition(
      repositoryBytes.at(-1) === 0x0a,
      `${artifact.name} normalized copy must end in LF`
    );
    const reconstructedSource = repositoryBytes.subarray(
      0,
      repositoryBytes.length - 1
    );
    requireCondition(
      reconstructedSource.length === artifact.source_bytes &&
        sha256(reconstructedSource) === artifact.source_sha256,
      `${artifact.name} source bytes cannot be reconstructed`
    );
  }
}

export function validateHandoffIntake({
  receipt,
  intake,
  intakeMarkdown,
  handoffBytes,
  repositoryCopies
}) {
  requireCondition(
    receipt.schema_version === "visionassist.handoff-intake-receipt.r33.v1",
    "wrong R33 receipt schema"
  );
  requireCondition(intake.schema === "AGENT_HANDOFF_INTAKE_R33", "wrong R33 intake schema");
  requireCondition(receipt.project === intake.project, "project mismatch");
  requireCondition(receipt.lane === intake.lane, "lane mismatch");

  const observedHandoffHash = sha256(handoffBytes);
  requireCondition(
    receipt.handoff_binding.exact_match === true &&
      receipt.handoff_binding.observed_bytes === handoffBytes.length &&
      receipt.handoff_binding.declared_bytes === handoffBytes.length &&
      receipt.handoff_binding.observed_sha256 === observedHandoffHash &&
      receipt.handoff_binding.declared_sha256 === observedHandoffHash &&
      intake.handoff_sha256 === observedHandoffHash,
    "R33 intake is not bound to the exact handoff"
  );
  requireCondition(
    intakeMarkdown.includes(`bytes  ${handoffBytes.length}`) &&
      intakeMarkdown.includes(`SHA    ${observedHandoffHash}`) &&
      intakeMarkdown.includes(`status ${intake.handoff_status}`),
    "R33 markdown and JSON intake disagree"
  );

  for (const artifact of receipt.source_artifacts) {
    const repositoryBytes = repositoryCopies.get(artifact.repository_copy);
    requireCondition(repositoryBytes, `${artifact.repository_copy} is missing`);
    validateSourceArtifact(artifact, repositoryBytes);
  }

  requireCondition(
    receipt.repository_observation.git_state === "UNBORN_NO_COMMITS" &&
      receipt.repository_observation.head_sha === null &&
      receipt.repository_observation.tree_sha === null &&
      receipt.claims_boundary.git_identity_bound === false,
    "unborn Git observation is overstated"
  );
  requireCondition(
    receipt.intake_decision.next_continuation === intake.next_continuation,
    "next continuation mismatch"
  );
  requireCondition(
    receipt.intake_decision.evidence_ceiling === intake.evidence_ceiling,
    "evidence ceiling mismatch"
  );
  for (const [key, expected] of Object.entries(AUTHORITY)) {
    requireCondition(receipt.authority[key] === expected, `authority.${key} mismatch`);
  }
  requireCondition(intake.can_trade === false, "intake cannot grant trade authority");
  requireCondition(
    intake.capital_permission === "DENY",
    "intake cannot grant capital permission"
  );

  return {
    valid: true,
    handoff_sha256: observedHandoffHash,
    handoff_bytes: handoffBytes.length,
    source_artifacts: receipt.source_artifacts.length,
    intake_status: receipt.intake_decision.status,
    git_state_at_intake: receipt.repository_observation.git_state,
    git_identity_bound: false,
    custody_transfer_bound: false,
    next_continuation: intake.next_continuation
  };
}
