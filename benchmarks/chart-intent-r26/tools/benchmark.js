#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync
} from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  freezeCase,
  freezeStage,
  outcomeCommitment,
  revealOutcome,
  verifyCase
} from "../src/lifecycle.js";
import { runAiAssessment } from "../src/ai-runner.js";
import { prepareCase } from "../src/intake.js";
import {
  bootstrapMarketCase,
  publishMarketCaseFreezeReceipt,
  registerMarketCandidatePool,
  verifyCompleteMarketCorpus,
  verifyMarketCandidatePool
} from "../src/market-corpus.js";
import { scoreCaseDirectories } from "../src/metrics.js";
import {
  bootstrapVisualCase,
  registerVisualCandidatePool,
  verifyCompleteVisualCorpus,
  verifyVisualCandidatePool
} from "../src/visual-corpus.js";
import {
  createHumanPriorDraft,
  submitHumanPrior
} from "../src/human-prior.js";
import {
  createCustodySnapshot,
  verifyCustodySnapshot
} from "../src/custody-snapshot.js";

const benchmarkRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const expectedCaseIds = [
  ...Array.from({ length: 60 }, (_, index) => `MKT-${String(index + 1).padStart(3, "0")}`),
  ...Array.from({ length: 15 }, (_, index) => `VIS-${String(index + 1).padStart(3, "0")}`)
];

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function getOption(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function hasOption(args, name) {
  return args.includes(name);
}

function requireArgument(value, usage) {
  if (!value) {
    throw new Error(`Missing argument. Usage: ${usage}`);
  }
  return value;
}

function caseDirectories(casesRoot) {
  if (!existsSync(casesRoot)) {
    return [];
  }
  return readdirSync(casesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^(MKT|VIS)-\d{3}$/.test(entry.name))
    .map((entry) => path.join(casesRoot, entry.name))
    .sort();
}

function status(casesRoot) {
  const rows = expectedCaseIds.map((caseId) => {
    const caseDirectory = path.join(casesRoot, caseId);
    if (!existsSync(caseDirectory)) {
      return { case_id: caseId, status: "MISSING" };
    }
    if (!existsSync(path.join(caseDirectory, "receipt.json"))) {
      return { case_id: caseId, status: "INGESTED_UNFROZEN" };
    }

    try {
      const verification = verifyCase(caseDirectory);
      return {
        case_id: caseId,
        status: verification.phase,
        chain_sha256: verification.chain_sha256
      };
    } catch (error) {
      return {
        case_id: caseId,
        status: "INVALID",
        error: error.message
      };
    }
  });

  const counts = {};
  for (const row of rows) {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
  }

  return {
    benchmark_id: "VISIONASSIST_CHART_INTENT_AND_HUMAN_AI_FUSION_PROOF",
    expected_cases: 75,
    counts,
    invalid_cases: rows.filter((row) => row.status === "INVALID"),
    next_missing_case_ids: rows
      .filter((row) => row.status === "MISSING")
      .slice(0, 10)
      .map((row) => row.case_id)
  };
}

function officialCaseSetIsComplete(directories) {
  const actualIds = directories.map((directory) => path.basename(directory));
  return actualIds.length === expectedCaseIds.length &&
    expectedCaseIds.every((caseId) => actualIds.includes(caseId));
}

async function main() {
  const [, , command, ...args] = process.argv;

  switch (command) {
    case "snapshot-custody": {
      print(createCustodySnapshot({
        casesRoot: path.resolve(
          getOption(args, "--cases-root") ?? path.join(benchmarkRoot, "cases")
        ),
        vaultRoot: path.resolve(
          getOption(args, "--vault-root") ?? path.join(benchmarkRoot, "outcome-vault")
        ),
        handoffReceiptPath: path.resolve(
          getOption(args, "--handoff-receipt") ??
            path.join(benchmarkRoot, "..", "..", "docs", "handoffs", "r33", "receipt.json")
        ),
        outputPath: path.resolve(
          getOption(args, "--output") ??
            path.join(benchmarkRoot, "sampling", "custody-snapshot-r33.json")
        )
      }));
      break;
    }
    case "verify-custody": {
      print(verifyCustodySnapshot({
        casesRoot: path.resolve(
          getOption(args, "--cases-root") ?? path.join(benchmarkRoot, "cases")
        ),
        vaultRoot: path.resolve(
          getOption(args, "--vault-root") ?? path.join(benchmarkRoot, "outcome-vault")
        ),
        handoffReceiptPath: path.resolve(
          getOption(args, "--handoff-receipt") ??
            path.join(benchmarkRoot, "..", "..", "docs", "handoffs", "r33", "receipt.json")
        ),
        snapshotPath: path.resolve(
          getOption(args, "--snapshot") ??
            path.join(benchmarkRoot, "sampling", "custody-snapshot-r33.json")
        )
      }));
      break;
    }
    case "draft-human-prior": {
      const caseDirectory = requireArgument(
        args[0],
        "benchmark.js draft-human-prior <case-directory> <draft-output>"
      );
      const outputPath = requireArgument(
        args[1],
        "benchmark.js draft-human-prior <case-directory> <draft-output>"
      );
      print(createHumanPriorDraft(caseDirectory, outputPath));
      break;
    }
    case "submit-human-prior": {
      const caseDirectory = requireArgument(
        args[0],
        "benchmark.js submit-human-prior <case-directory> <completed-draft>"
      );
      const completedDraftPath = requireArgument(
        args[1],
        "benchmark.js submit-human-prior <case-directory> <completed-draft>"
      );
      print(submitHumanPrior(caseDirectory, completedDraftPath));
      break;
    }
    case "register-visual-pool": {
      const samplingRoot = path.resolve(
        getOption(args, "--sampling-root") ?? path.join(benchmarkRoot, "sampling")
      );
      const vaultRoot = path.resolve(
        getOption(args, "--vault-root") ?? path.join(benchmarkRoot, "outcome-vault")
      );
      print(registerVisualCandidatePool({ samplingRoot, vaultRoot }));
      break;
    }
    case "verify-visual-pool": {
      const samplingRoot = path.resolve(
        getOption(args, "--sampling-root") ?? path.join(benchmarkRoot, "sampling")
      );
      const vaultRoot = path.resolve(
        getOption(args, "--vault-root") ?? path.join(benchmarkRoot, "outcome-vault")
      );
      const result = verifyVisualCandidatePool({ samplingRoot, vaultRoot });
      print({
        valid: result.valid,
        protocol_id: result.protocol.protocol_id,
        status: result.protocol.status,
        candidate_count: result.pool.candidates.length,
        candidate_pool_commitment_sha256:
          result.commitment.candidate_pool_commitment_sha256,
        latent_policy_mapping_exposed: false,
        natural_scene_generality: "NOT_ESTABLISHED"
      });
      break;
    }
    case "verify-visual-corpus": {
      print(verifyCompleteVisualCorpus({
        samplingRoot: path.resolve(
          getOption(args, "--sampling-root") ?? path.join(benchmarkRoot, "sampling")
        ),
        vaultRoot: path.resolve(
          getOption(args, "--vault-root") ?? path.join(benchmarkRoot, "outcome-vault")
        ),
        casesRoot: path.resolve(
          getOption(args, "--cases-root") ?? path.join(benchmarkRoot, "cases")
        )
      }));
      break;
    }
    case "bootstrap-visual-case": {
      const caseId = requireArgument(
        args[0],
        "benchmark.js bootstrap-visual-case <VIS-nnn>"
      );
      print(await bootstrapVisualCase({
        caseId,
        samplingRoot: path.resolve(
          getOption(args, "--sampling-root") ?? path.join(benchmarkRoot, "sampling")
        ),
        vaultRoot: path.resolve(
          getOption(args, "--vault-root") ?? path.join(benchmarkRoot, "outcome-vault")
        ),
        casesRoot: path.resolve(
          getOption(args, "--cases-root") ?? path.join(benchmarkRoot, "cases")
        )
      }));
      break;
    }
    case "register-market-pool": {
      const samplingRoot = path.resolve(
        getOption(args, "--sampling-root") ?? path.join(benchmarkRoot, "sampling")
      );
      const vaultRoot = path.resolve(
        getOption(args, "--vault-root") ?? path.join(benchmarkRoot, "outcome-vault")
      );
      print(registerMarketCandidatePool({ samplingRoot, vaultRoot }));
      break;
    }
    case "verify-market-pool": {
      const samplingRoot = path.resolve(
        getOption(args, "--sampling-root") ?? path.join(benchmarkRoot, "sampling")
      );
      const vaultRoot = path.resolve(
        getOption(args, "--vault-root") ?? path.join(benchmarkRoot, "outcome-vault")
      );
      const result = verifyMarketCandidatePool({ samplingRoot, vaultRoot });
      print({
        valid: result.valid,
        protocol_id: result.protocol.protocol_id,
        status: result.protocol.status,
        candidate_count: result.pool.candidates.length,
        candidate_pool_commitment_sha256:
          result.commitment.candidate_pool_commitment_sha256,
        slot_to_source_mapping_exposed: false
      });
      break;
    }
    case "verify-market-corpus": {
      print(verifyCompleteMarketCorpus({
        samplingRoot: path.resolve(
          getOption(args, "--sampling-root") ?? path.join(benchmarkRoot, "sampling")
        ),
        vaultRoot: path.resolve(
          getOption(args, "--vault-root") ?? path.join(benchmarkRoot, "outcome-vault")
        ),
        casesRoot: path.resolve(
          getOption(args, "--cases-root") ?? path.join(benchmarkRoot, "cases")
        )
      }));
      break;
    }
    case "bootstrap-market-case": {
      const caseId = requireArgument(
        args[0],
        "benchmark.js bootstrap-market-case <MKT-nnn>"
      );
      print(await bootstrapMarketCase({
        caseId,
        samplingRoot: path.resolve(
          getOption(args, "--sampling-root") ?? path.join(benchmarkRoot, "sampling")
        ),
        vaultRoot: path.resolve(
          getOption(args, "--vault-root") ?? path.join(benchmarkRoot, "outcome-vault")
        ),
        casesRoot: path.resolve(
          getOption(args, "--cases-root") ?? path.join(benchmarkRoot, "cases")
        )
      }));
      break;
    }
    case "publish-market-case-receipt": {
      const caseId = requireArgument(
        args[0],
        "benchmark.js publish-market-case-receipt <MKT-nnn>"
      );
      const result = publishMarketCaseFreezeReceipt({
        caseId,
        samplingRoot: path.resolve(
          getOption(args, "--sampling-root") ?? path.join(benchmarkRoot, "sampling")
        ),
        vaultRoot: path.resolve(
          getOption(args, "--vault-root") ?? path.join(benchmarkRoot, "outcome-vault")
        ),
        casesRoot: path.resolve(
          getOption(args, "--cases-root") ?? path.join(benchmarkRoot, "cases")
        )
      });
      print({
        case_id: result.case_id,
        public_receipt_path: result.public_receipt_path,
        phase_at_publication: result.receipt.phase_at_publication,
        source_identity_exposed: result.receipt.source_identity_exposed,
        outcome_exposed: result.receipt.outcome_exposed,
        claims_boundary: result.receipt.claims_boundary
      });
      break;
    }
    case "run-ai": {
      const caseDirectory = requireArgument(
        args[0],
        "benchmark.js run-ai <case-directory> [--model model]"
      );
      print(await runAiAssessment({
        caseDirectory,
        model: getOption(args, "--model") ?? undefined
      }));
      break;
    }
    case "prepare-case": {
      const intakePath = requireArgument(
        args[0],
        "benchmark.js prepare-case <intake.json> <evidence-image> <sealed-outcome.json> [cases-root]"
      );
      const evidenceSourcePath = requireArgument(
        args[1],
        "benchmark.js prepare-case <intake.json> <evidence-image> <sealed-outcome.json> [cases-root]"
      );
      const sealedOutcomePath = requireArgument(
        args[2],
        "benchmark.js prepare-case <intake.json> <evidence-image> <sealed-outcome.json> [cases-root]"
      );
      print(prepareCase({
        intakePath,
        evidenceSourcePath,
        sealedOutcomePath,
        casesRoot: args[3] ?? path.join(benchmarkRoot, "cases")
      }));
      break;
    }
    case "commit-outcome": {
      const outcomePath = requireArgument(
        args[0],
        "benchmark.js commit-outcome <sealed-outcome.json>"
      );
      print({
        outcome_file: path.resolve(outcomePath),
        canonical_sha256: outcomeCommitment(outcomePath)
      });
      break;
    }
    case "freeze-case": {
      const caseDirectory = requireArgument(
        args[0],
        "benchmark.js freeze-case <case-directory> <sealed-outcome.json>"
      );
      const outcomePath = requireArgument(
        args[1],
        "benchmark.js freeze-case <case-directory> <sealed-outcome.json>"
      );
      const result = freezeCase(caseDirectory, outcomePath);
      delete result.context;
      delete result.receipt;
      print(result);
      break;
    }
    case "freeze-stage": {
      const caseDirectory = requireArgument(
        args[0],
        "benchmark.js freeze-stage <case-directory> <artifact-kind>"
      );
      const kind = requireArgument(
        args[1],
        "benchmark.js freeze-stage <case-directory> <artifact-kind>"
      );
      const result = freezeStage(caseDirectory, kind);
      delete result.context;
      delete result.receipt;
      print(result);
      break;
    }
    case "reveal": {
      const caseDirectory = requireArgument(
        args[0],
        "benchmark.js reveal <case-directory> <sealed-outcome.json>"
      );
      const outcomePath = requireArgument(
        args[1],
        "benchmark.js reveal <case-directory> <sealed-outcome.json>"
      );
      const result = revealOutcome(caseDirectory, outcomePath);
      delete result.context;
      delete result.receipt;
      print(result);
      break;
    }
    case "verify": {
      const caseDirectory = requireArgument(
        args[0],
        "benchmark.js verify <case-directory>"
      );
      const result = verifyCase(caseDirectory);
      delete result.context;
      delete result.receipt;
      print(result);
      break;
    }
    case "score": {
      const casesRoot = path.resolve(args[0] ?? path.join(benchmarkRoot, "cases"));
      const directories = caseDirectories(casesRoot);
      const allowPartial = hasOption(args, "--allow-partial");
      if (!allowPartial && !officialCaseSetIsComplete(directories)) {
        throw new Error(
          `Official scoring requires the exact 75-case roster; found ${directories.length}.`
        );
      }
      if (directories.length === 0) {
        throw new Error("No case directories were found.");
      }
      const scorecard = scoreCaseDirectories(directories);
      const outputPath = getOption(args, "--output");
      if (outputPath) {
        const resolvedOutput = path.resolve(outputPath);
        mkdirSync(path.dirname(resolvedOutput), { recursive: true });
        writeFileSync(resolvedOutput, `${JSON.stringify(scorecard, null, 2)}\n`, "utf8");
      }
      print(scorecard);
      break;
    }
    case "status": {
      const casesRoot = path.resolve(args[0] ?? path.join(benchmarkRoot, "cases"));
      print(status(casesRoot));
      break;
    }
    default:
      throw new Error(
        "Expected command: snapshot-custody, verify-custody, draft-human-prior, submit-human-prior, register-visual-pool, verify-visual-pool, verify-visual-corpus, bootstrap-visual-case, register-market-pool, verify-market-pool, verify-market-corpus, bootstrap-market-case, publish-market-case-receipt, status, prepare-case, run-ai, commit-outcome, freeze-case, freeze-stage, reveal, verify, or score."
      );
  }
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error.code ?? "benchmark_command_failed",
    error: error.message
  }, null, 2)}\n`);
  process.exitCode = 1;
});
