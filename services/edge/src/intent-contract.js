import { intentRecordSchema } from "./intent-schema.js";

const sourceSchema = intentRecordSchema.properties.source;
const allowedModalities = new Set(sourceSchema.properties.modality.enum);
const allowedFusion = new Set(["HUMAN_AI", "AI_ONLY_INCOMPLETE"]);
const forbiddenActions = new Set(["BUY", "SELL", "LONG", "SHORT", "EXECUTE"]);
const topLevelKeys = Object.keys(intentRecordSchema.properties);
const sourceKeys = Object.keys(sourceSchema.properties);
const observationKeys = Object.keys(
  intentRecordSchema.properties.observations.items.properties
);
const hypothesisKeys = Object.keys(
  intentRecordSchema.properties.intent_hypotheses.items.properties
);
const humanContextKeys = Object.keys(
  intentRecordSchema.properties.human_context.properties
);

export class IntentContractError extends Error {
  constructor(message, { statusCode = 422, code = "intent_contract_error" } = {}) {
    super(message);
    this.name = "IntentContractError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function requireCondition(condition, message, options) {
  if (!condition) {
    throw new IntentContractError(message, options);
  }
}

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function requireObject(value, path) {
  requireCondition(
    value && typeof value === "object" && !Array.isArray(value),
    `${path} must be an object`
  );
}

function requireExactKeys(value, expectedKeys, path) {
  requireObject(value, path);
  const expected = new Set(expectedKeys);
  const actualKeys = Object.keys(value);

  for (const key of expectedKeys) {
    requireCondition(Object.hasOwn(value, key), `${path}.${key} is required`);
  }
  for (const key of actualKeys) {
    requireCondition(expected.has(key), `${path}.${key} is not allowed`);
  }
}

function requireNonEmptyString(value, path, maxLength) {
  requireCondition(isNonEmptyString(value), `${path} must be a non-empty string`);
  if (maxLength != null) {
    requireCondition(value.length <= maxLength, `${path} is too long`);
  }
}

function requireStringArray(value, path, { minItems = 0 } = {}) {
  requireCondition(Array.isArray(value), `${path} must be an array`);
  requireCondition(value.length >= minItems, `${path} requires at least ${minItems} item(s)`);
  for (const [index, item] of value.entries()) {
    requireNonEmptyString(item, `${path}[${index}]`);
  }
}

function requireNullableString(value, path) {
  requireCondition(value === null || typeof value === "string", `${path} must be a string or null`);
}

export function normalizeIntentSource(source = {}) {
  requireCondition(isNonEmptyString(source.source_id), "source.source_id is required", {
    statusCode: 400,
    code: "invalid_intent_input"
  });
  requireCondition(allowedModalities.has(source.modality), "source.modality is unsupported", {
    statusCode: 400,
    code: "invalid_intent_input"
  });

  return {
    source_id: source.source_id.trim(),
    modality: source.modality,
    captured_at: isNonEmptyString(source.captured_at)
      ? source.captured_at.trim()
      : new Date().toISOString()
  };
}

export function normalizeHumanContext(humanContext = {}) {
  const present = humanContext.present === true;
  if (!present) {
    return {
      present: false,
      operator_goal: null,
      operator_prior: null,
      operator_confidence: null,
      notes_sha256: null
    };
  }

  requireCondition(isNonEmptyString(humanContext.operator_goal), "human_context.operator_goal is required", {
    statusCode: 400,
    code: "invalid_intent_input"
  });
  requireCondition(isNonEmptyString(humanContext.operator_prior), "human_context.operator_prior is required", {
    statusCode: 400,
    code: "invalid_intent_input"
  });
  requireCondition(
    isNumber(humanContext.operator_confidence) &&
      humanContext.operator_confidence >= 0 &&
      humanContext.operator_confidence <= 1,
    "human_context.operator_confidence must be between 0 and 1",
    {
      statusCode: 400,
      code: "invalid_intent_input"
    }
  );

  const notesSha256 = humanContext.notes_sha256;
  requireCondition(
    notesSha256 == null || /^[a-f0-9]{64}$/i.test(notesSha256),
    "human_context.notes_sha256 must be a SHA-256 hex digest",
    {
      statusCode: 400,
      code: "invalid_intent_input"
    }
  );

  return {
    present: true,
    operator_goal: humanContext.operator_goal.trim(),
    operator_prior: humanContext.operator_prior.trim(),
    operator_confidence: humanContext.operator_confidence,
    notes_sha256: notesSha256?.toLowerCase() ?? null
  };
}

export function applyIntentSafetyEnvelope(modelRecord, { source, humanContext }) {
  requireCondition(
    modelRecord && typeof modelRecord === "object" && !Array.isArray(modelRecord),
    "model did not return an intent record",
    {
      statusCode: 502,
      code: "model_contract_violation"
    }
  );

  return {
    ...modelRecord,
    schema_version: "visionassist.intent.v1",
    module_identity: "VISUAL_SEMANTIC_COGNITION_LAYER",
    source,
    human_context: humanContext,
    fusion_status: humanContext.present ? "HUMAN_AI" : "AI_ONLY_INCOMPLETE",
    decision_status: "DIAGNOSTIC_ONLY",
    action_code: "NO_ACTION",
    execution_permission: "HOLD",
    capital_permission: "DENY",
    can_trade: false
  };
}

export function validateIntentRecord(record) {
  requireExactKeys(record, topLevelKeys, "record");
  requireCondition(record.schema_version === "visionassist.intent.v1", "wrong schema_version");
  requireCondition(
    record.module_identity === "VISUAL_SEMANTIC_COGNITION_LAYER",
    "wrong module identity"
  );

  const source = record.source;
  requireExactKeys(source, sourceKeys, "source");
  requireCondition(allowedModalities.has(source.modality), "unsupported modality");
  requireNonEmptyString(source.source_id, "source.source_id", 160);
  requireNullableString(source.captured_at, "source.captured_at");

  const observations = record.observations;
  requireCondition(isNonEmptyArray(observations), "surface observations required");
  for (const [index, observation] of observations.entries()) {
    const path = `observations[${index}]`;
    requireExactKeys(observation, observationKeys, path);
    requireNonEmptyString(observation.id, `${path}.id`);
    requireCondition(observation?.status === "OBSERVATION", "observation must remain observation");
    requireNonEmptyString(observation.description, `${path}.description`);
    requireStringArray(observation.evidence_refs, `${path}.evidence_refs`, {
      minItems: 1
    });
  }

  const hypotheses = record.intent_hypotheses;
  requireCondition(Array.isArray(hypotheses), "intent_hypotheses must be an array");
  requireCondition(hypotheses.length >= 2, "at least two competing intent hypotheses required");
  for (const [index, hypothesis] of hypotheses.entries()) {
    const path = `intent_hypotheses[${index}]`;
    requireExactKeys(hypothesis, hypothesisKeys, path);
    requireNonEmptyString(hypothesis.id, `${path}.id`);
    requireCondition(hypothesis?.status === "HYPOTHESIS", "intent cannot be asserted as fact");
    requireNonEmptyString(hypothesis.description, `${path}.description`);
    requireCondition(
      isNumber(hypothesis?.confidence) &&
        hypothesis.confidence >= 0 &&
        hypothesis.confidence <= 1,
      "confidence must be calibrated 0..1"
    );
    requireStringArray(hypothesis.evidence_refs, `${path}.evidence_refs`, {
      minItems: 1
    });
    requireStringArray(
      hypothesis.counterevidence_refs,
      `${path}.counterevidence_refs`
    );
    requireStringArray(
      hypothesis.invalidation_conditions,
      `${path}.invalidation_conditions`,
      { minItems: 1 }
    );
  }

  const human = record.human_context;
  requireExactKeys(human, humanContextKeys, "human_context");
  requireCondition(typeof human.present === "boolean", "human_context.present must be boolean");
  requireNullableString(human.operator_goal, "human_context.operator_goal");
  requireNullableString(human.operator_prior, "human_context.operator_prior");
  requireNullableString(human.notes_sha256, "human_context.notes_sha256");
  requireCondition(
    human.notes_sha256 === null || /^[a-f0-9]{64}$/i.test(human.notes_sha256),
    "human_context.notes_sha256 must be a SHA-256 hex digest or null"
  );
  requireCondition(
    human.operator_confidence === null ||
      (isNumber(human.operator_confidence) &&
        human.operator_confidence >= 0 &&
        human.operator_confidence <= 1),
    "human_context.operator_confidence must be between 0 and 1 or null"
  );

  const fusion = record.fusion_status;
  const expectedFusion = human.present ? "HUMAN_AI" : "AI_ONLY_INCOMPLETE";
  requireCondition(
    fusion === expectedFusion && allowedFusion.has(fusion),
    "fusion status mismatch"
  );
  if (human.present) {
    requireCondition(isNonEmptyString(human.operator_goal), "operator goal required");
    requireCondition(
      Object.hasOwn(human, "operator_prior") && isNonEmptyString(human.operator_prior),
      "operator prior required"
    );
    requireCondition(
      isNumber(human.operator_confidence) &&
        human.operator_confidence >= 0 &&
        human.operator_confidence <= 1,
      "operator confidence required"
    );
  } else {
    requireCondition(human.operator_goal === null, "AI-only operator goal must be null");
    requireCondition(human.operator_prior === null, "AI-only operator prior must be null");
    requireCondition(
      human.operator_confidence === null,
      "AI-only operator confidence must be null"
    );
    requireCondition(human.notes_sha256 === null, "AI-only notes hash must be null");
  }

  requireStringArray(record.uncertainties, "uncertainties", { minItems: 1 });
  requireStringArray(record.alternative_explanations, "alternative_explanations", {
    minItems: 1
  });
  requireCondition(
    record.decision_status === "DIAGNOSTIC_ONLY",
    "decision status must be diagnostic only"
  );
  requireCondition(record.execution_permission === "HOLD", "execution permission must remain HOLD");
  requireCondition(record.capital_permission === "DENY", "capital permission must remain DENY");
  requireCondition(record.can_trade === false, "can_trade must be false");

  const action = String(record.action_code ?? "NO_ACTION").toUpperCase();
  requireCondition(!forbiddenActions.has(action), "direct trading action forbidden");
  requireCondition(action === "NO_ACTION", "action_code must remain NO_ACTION");

  return {
    valid: true,
    fusion_status: fusion,
    hypothesis_count: hypotheses.length,
    decision_status: "DIAGNOSTIC_ONLY",
    execution_permission: "HOLD",
    capital_permission: "DENY",
    can_trade: false
  };
}
