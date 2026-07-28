const EXPECTED_STAGES = Object.freeze([
  {
    stage: 1,
    timeframe: "2025-11",
    evidence_class: "HISTORICAL_ORIGIN",
    current_role: "OPTIONAL_ACCESSIBILITY_ADAPTER"
  },
  {
    stage: 2,
    timeframe: "2025-12",
    evidence_class: "ARCHIVE_PIVOT",
    current_role: "CHART_INTENT_ORIGIN"
  },
  {
    stage: 3,
    timeframe: "2026-03",
    evidence_class: "RESEARCH_ARCHITECTURE",
    current_role: "CORE_METHOD"
  },
  {
    stage: 4,
    timeframe: "2026-07",
    evidence_class: "CURRENT_OPERATOR_CANON",
    current_role: "CORE_PERCEPTION_LAYER"
  }
]);

function requireCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function requireString(value, pathName) {
  requireCondition(
    typeof value === "string" && value.trim().length > 0,
    `${pathName} must be a non-empty string`
  );
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === "\"" && text[index + 1] === "\"") {
        value += "\"";
        index += 1;
      } else if (character === "\"") {
        quoted = false;
      } else {
        value += character;
      }
    } else if (character === "\"") {
      quoted = true;
    } else if (character === ",") {
      row.push(value);
      value = "";
    } else if (character === "\n") {
      row.push(value.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }

  if (value.length > 0 || row.length > 0) {
    row.push(value.replace(/\r$/, ""));
    rows.push(row);
  }
  requireCondition(!quoted, "CSV contains an unclosed quote");
  const [headers, ...records] = rows.filter((item) =>
    item.some((cell) => cell.length > 0)
  );
  requireCondition(headers?.length > 0, "CSV header is missing");
  return records.map((cells) =>
    Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]))
  );
}

export function validateLineage(lineage) {
  requireCondition(
    lineage?.schema_version === "visionassist.lineage.r29",
    "wrong lineage schema_version"
  );
  requireCondition(
    lineage.lineage_id === "VISIONASSIST_FULL_EVOLUTION_R29",
    "wrong lineage_id"
  );
  requireCondition(lineage.current_stage === 4, "current stage must be 4");
  requireCondition(
    lineage.current_identity === "CORE_PERCEPTION_CAPABILITY",
    "current identity must be core perception capability"
  );
  requireCondition(
    lineage.current_canon === "VISUAL_SEMANTIC_COGNITION_LAYER",
    "current canon must be visual-semantic cognition"
  );
  requireCondition(
    lineage.primary_gate ===
      "VISIONASSIST_CHART_INTENT_AND_HUMAN_AI_FUSION_PROOF",
    "primary gate mismatch"
  );
  requireCondition(
    lineage.runtime_boundary?.core_default_profile === "intent-r26",
    "core default profile must be intent-r26"
  );
  requireCondition(
    lineage.runtime_boundary?.optional_accessibility_profile === "android-pilot",
    "android-pilot must remain the optional accessibility profile"
  );
  requireCondition(
    lineage.portfolio?.accessibility_role === "OPTIONAL_ACCESSIBILITY_ADAPTER",
    "accessibility portfolio role mismatch"
  );
  requireCondition(
    lineage.portfolio?.candlestick_classifier_role === "BASELINE_ONLY",
    "candlestick classifier must remain baseline-only"
  );
  requireCondition(
    Array.isArray(lineage.stages) && lineage.stages.length === 4,
    "lineage must contain exactly four stages"
  );

  lineage.stages.forEach((stage, index) => {
    const expected = EXPECTED_STAGES[index];
    requireCondition(stage.stage === expected.stage, `stage ${index + 1} order mismatch`);
    requireCondition(
      stage.timeframe === expected.timeframe,
      `stage ${stage.stage} timeframe mismatch`
    );
    requireCondition(
      stage.evidence_class === expected.evidence_class,
      `stage ${stage.stage} evidence class mismatch`
    );
    requireCondition(
      stage.current_role === expected.current_role,
      `stage ${stage.stage} current role mismatch`
    );
    requireString(stage.identity, `stage ${stage.stage}.identity`);
    requireString(
      stage.implementation_boundary,
      `stage ${stage.stage}.implementation_boundary`
    );
  });

  requireCondition(
    Array.isArray(lineage.transitions) && lineage.transitions.length === 3,
    "lineage must contain three transitions"
  );
  lineage.transitions.forEach((transition, index) => {
    requireCondition(
      transition.from_stage === index + 1 &&
        transition.to_stage === index + 2,
      `transition ${index + 1} is not sequential`
    );
  });
  requireCondition(
    lineage.authority?.decision_status === "DIAGNOSTIC_ONLY" &&
      lineage.authority?.action_code === "NO_ACTION" &&
      lineage.authority?.execution_permission === "HOLD" &&
      lineage.authority?.capital_permission === "DENY" &&
      lineage.authority?.can_trade === false,
    "lineage authority must remain diagnostic-only"
  );
  requireCondition(
    Array.isArray(lineage.claims_boundary) &&
      lineage.claims_boundary.length >= 5,
    "claims boundary is incomplete"
  );
  return lineage;
}

export function validateCsvParity(csvText, lineage) {
  const rows = parseCsv(csvText);
  requireCondition(rows.length === 4, "lineage CSV must contain four rows");
  rows.forEach((row, index) => {
    const stage = lineage.stages[index];
    requireCondition(Number(row.stage) === stage.stage, `CSV stage ${index + 1} mismatch`);
    requireCondition(row.timeframe === stage.timeframe, `CSV timeframe ${index + 1} mismatch`);
    requireCondition(row.identity === stage.identity, `CSV identity ${index + 1} mismatch`);
    requireCondition(
      row.evidence_class === stage.evidence_class,
      `CSV evidence class ${index + 1} mismatch`
    );
    requireCondition(
      row.current_role === stage.current_role,
      `CSV current role ${index + 1} mismatch`
    );
  });
  return rows;
}

export function validateReleaseProfileParity(releaseProfiles, lineage) {
  requireCondition(
    releaseProfiles.default_runtime_profile ===
      lineage.runtime_boundary.core_default_profile,
    "release default does not match lineage core profile"
  );
  requireCondition(
    releaseProfiles.profiles["intent-r26"]?.portfolio_role ===
      "CORE_PERCEPTION_RUNTIME",
    "intent-r26 portfolio role mismatch"
  );
  requireCondition(
    releaseProfiles.profiles["android-pilot"]?.portfolio_role ===
      lineage.portfolio.accessibility_role,
    "android-pilot portfolio role mismatch"
  );
  requireCondition(
    releaseProfiles.profiles["research-r26-benchmark"]?.portfolio_role ===
      "PRIMARY_EVIDENCE_GATE",
    "benchmark portfolio role mismatch"
  );
  return releaseProfiles;
}
