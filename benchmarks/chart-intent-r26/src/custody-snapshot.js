import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  writeFileSync
} from "node:fs";
import path from "node:path";

import {
  readJson,
  sha256CanonicalJsonFile,
  sha256File,
  sha256Json
} from "./canonical-json.js";

function requireCondition(condition, message, code = "custody_snapshot_error") {
  if (!condition) {
    const error = new Error(message);
    error.code = code;
    throw error;
  }
}

function isInside(candidatePath, containerPath) {
  const relative = path.relative(
    path.resolve(containerPath),
    path.resolve(candidatePath)
  );
  return relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function inventoryDirectory(rootPath, logicalRoot) {
  const resolvedRoot = path.resolve(rootPath);
  requireCondition(existsSync(resolvedRoot), `${logicalRoot} root is missing.`);
  requireCondition(
    lstatSync(resolvedRoot).isDirectory(),
    `${logicalRoot} root must be a directory.`
  );
  const entries = [];

  function visit(directory) {
    const children = readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      const absolutePath = path.join(directory, child.name);
      const stat = lstatSync(absolutePath);
      requireCondition(
        !stat.isSymbolicLink(),
        `${logicalRoot} inventory rejects symbolic links.`
      );
      if (stat.isDirectory()) {
        visit(absolutePath);
      } else {
        requireCondition(stat.isFile(), `${absolutePath} is not a regular file.`);
        const relativePath = path
          .relative(resolvedRoot, absolutePath)
          .split(path.sep)
          .join("/");
        entries.push({
          path: `${logicalRoot}/${relativePath}`,
          size_bytes: stat.size,
          sha256: sha256File(absolutePath)
        });
      }
    }
  }

  visit(resolvedRoot);
  entries.sort((left, right) => left.path.localeCompare(right.path));
  return {
    file_count: entries.length,
    total_bytes: entries.reduce(
      (total, entry) => total + entry.size_bytes,
      0
    ),
    tree_sha256: sha256Json(entries)
  };
}

function caseDirectoryCount(casesRoot) {
  return readdirSync(path.resolve(casesRoot), { withFileTypes: true })
    .filter((entry) =>
      entry.isDirectory() && /^(MKT|VIS)-\d{3}$/.test(entry.name)
    ).length;
}

export function buildCustodySnapshot({
  casesRoot,
  vaultRoot,
  handoffReceiptPath,
  now = new Date().toISOString()
}) {
  const resolvedReceipt = path.resolve(handoffReceiptPath);
  requireCondition(existsSync(resolvedReceipt), "R33 handoff receipt is missing.");
  const receipt = readJson(resolvedReceipt);
  requireCondition(
    receipt.intake_decision?.status === "ACCEPTED_BOUND_TO_EXACT_HANDOFF",
    "R33 handoff receipt is not accepted."
  );

  const cases = inventoryDirectory(casesRoot, "cases");
  const vault = inventoryDirectory(vaultRoot, "outcome-vault");
  const handoffReceiptHash = sha256CanonicalJsonFile(resolvedReceipt);
  const combinedCommitment = sha256Json({
    cases_tree_sha256: cases.tree_sha256,
    outcome_vault_tree_sha256: vault.tree_sha256,
    handoff_intake_receipt_canonical_sha256: handoffReceiptHash
  });

  return {
    schema_version: "visionassist.benchmark.local-custody-snapshot.r33.v1",
    benchmark_id: "VISIONASSIST_CHART_INTENT_AND_HUMAN_AI_FUSION_PROOF",
    generated_at_utc: now,
    evidence_class: "LOCAL_CUSTODY_SNAPSHOT_ONLY",
    handoff_intake_receipt_canonical_sha256: handoffReceiptHash,
    scope: {
      case_directories: caseDirectoryCount(casesRoot),
      cases_file_count: cases.file_count,
      cases_total_bytes: cases.total_bytes,
      outcome_vault_file_count: vault.file_count,
      outcome_vault_total_bytes: vault.total_bytes
    },
    commitments: {
      cases_tree_sha256: cases.tree_sha256,
      outcome_vault_tree_sha256: vault.tree_sha256,
      combined_sha256: combinedCommitment
    },
    disclosure: {
      file_paths_published: false,
      individual_file_hashes_published: false,
      file_contents_published: false,
      outcome_labels_published: false,
      hidden_seed_published: false
    },
    claims_boundary: {
      local_bytes_bound: true,
      custody_transfer_bound: false,
      independent_custody_proven: false,
      trusted_timestamp_proven: false,
      git_identity_bound: false
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

export function createCustodySnapshot({
  casesRoot,
  vaultRoot,
  handoffReceiptPath,
  outputPath,
  now
}) {
  const resolvedOutput = path.resolve(outputPath);
  requireCondition(
    !isInside(resolvedOutput, casesRoot) &&
      !isInside(resolvedOutput, vaultRoot),
    "Custody snapshot must remain outside cases and outcome-vault."
  );
  requireCondition(!existsSync(resolvedOutput), `${resolvedOutput} already exists.`);
  const snapshot = buildCustodySnapshot({
    casesRoot,
    vaultRoot,
    handoffReceiptPath,
    now
  });
  mkdirSync(path.dirname(resolvedOutput), { recursive: true });
  writeFileSync(resolvedOutput, `${JSON.stringify(snapshot, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx"
  });
  return snapshot;
}

export function verifyCustodySnapshot({
  casesRoot,
  vaultRoot,
  handoffReceiptPath,
  snapshotPath
}) {
  const resolvedSnapshot = path.resolve(snapshotPath);
  requireCondition(existsSync(resolvedSnapshot), "Custody snapshot is missing.");
  const observed = readJson(resolvedSnapshot);
  const rebuilt = buildCustodySnapshot({
    casesRoot,
    vaultRoot,
    handoffReceiptPath,
    now: observed.generated_at_utc
  });
  requireCondition(
    sha256Json(rebuilt) === sha256Json(observed),
    "Local custody snapshot does not match current bytes.",
    "custody_snapshot_mismatch"
  );
  return {
    valid: true,
    evidence_class: observed.evidence_class,
    generated_at_utc: observed.generated_at_utc,
    case_directories: observed.scope.case_directories,
    cases_file_count: observed.scope.cases_file_count,
    outcome_vault_file_count: observed.scope.outcome_vault_file_count,
    combined_sha256: observed.commitments.combined_sha256,
    local_bytes_bound: true,
    custody_transfer_bound: false,
    independent_custody_proven: false,
    git_identity_bound: false,
    authority: observed.authority
  };
}
