from __future__ import annotations


class ContractError(ValueError):
    pass


ALLOWED_MODALITIES = {"chart_image", "scene_image", "video", "dashboard", "document", "ui"}
ALLOWED_FUSION = {"HUMAN_AI", "AI_ONLY_INCOMPLETE"}


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ContractError(message)


def validate_record(record: dict) -> dict:
    _require(record.get("schema_version") == "visionassist.intent.v1", "wrong schema_version")
    _require(record.get("module_identity") == "VISUAL_SEMANTIC_COGNITION_LAYER", "wrong module identity")

    source = record.get("source") or {}
    _require(source.get("modality") in ALLOWED_MODALITIES, "unsupported modality")
    _require(bool(source.get("source_id")), "source_id required")

    observations = record.get("observations") or []
    _require(len(observations) >= 1, "surface observations required")
    for observation in observations:
        _require(observation.get("status") == "OBSERVATION", "observation must remain observation")
        _require(bool(observation.get("evidence_refs")), "observation evidence refs required")

    hypotheses = record.get("intent_hypotheses") or []
    _require(len(hypotheses) >= 2, "at least two competing intent hypotheses required")
    for hypothesis in hypotheses:
        _require(hypothesis.get("status") == "HYPOTHESIS", "intent cannot be asserted as fact")
        confidence = hypothesis.get("confidence")
        _require(isinstance(confidence, (int, float)) and 0 <= confidence <= 1, "confidence must be calibrated 0..1")
        _require(bool(hypothesis.get("evidence_refs")), "hypothesis evidence refs required")
        _require("counterevidence_refs" in hypothesis, "counterevidence refs required")
        _require(bool(hypothesis.get("invalidation_conditions")), "invalidation conditions required")

    human = record.get("human_context") or {}
    _require("present" in human, "human_context.present required")
    fusion = record.get("fusion_status")
    expected_fusion = "HUMAN_AI" if human.get("present") else "AI_ONLY_INCOMPLETE"
    _require(fusion == expected_fusion and fusion in ALLOWED_FUSION, "fusion status mismatch")
    if human.get("present"):
        _require(bool(human.get("operator_goal")), "operator goal required")
        _require("operator_prior" in human, "operator prior required")
        _require(isinstance(human.get("operator_confidence"), (int, float)), "operator confidence required")

    _require(bool(record.get("uncertainties")), "uncertainties required")
    _require(bool(record.get("alternative_explanations")), "alternative explanations required")
    _require(record.get("decision_status") == "DIAGNOSTIC_ONLY", "decision status must be diagnostic only")
    _require(record.get("execution_permission") == "HOLD", "execution permission must remain HOLD")
    _require(record.get("capital_permission") == "DENY", "capital permission must remain DENY")
    _require(record.get("can_trade") is False, "can_trade must be false")

    forbidden = {"BUY", "SELL", "LONG", "SHORT", "EXECUTE"}
    action = str(record.get("action_code", "NO_ACTION")).upper()
    _require(action not in forbidden, "direct trading action forbidden")

    return {
        "valid": True,
        "fusion_status": fusion,
        "hypothesis_count": len(hypotheses),
        "decision_status": "DIAGNOSTIC_ONLY",
        "execution_permission": "HOLD",
        "capital_permission": "DENY",
        "can_trade": False
    }

