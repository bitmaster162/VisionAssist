import copy
import json
import unittest
from pathlib import Path

from visionassist_contract.contract import ContractError, validate_record


SAMPLE = json.loads((Path(__file__).parents[1] / "examples" / "chart_intent_record.json").read_text())


class ContractTests(unittest.TestCase):
    def test_valid_human_ai_record(self):
        result = validate_record(copy.deepcopy(SAMPLE))
        self.assertTrue(result["valid"])
        self.assertFalse(result["can_trade"])

    def test_two_hypotheses_required(self):
        x = copy.deepcopy(SAMPLE)
        x["intent_hypotheses"] = x["intent_hypotheses"][:1]
        with self.assertRaises(ContractError):
            validate_record(x)

    def test_intent_cannot_be_fact(self):
        x = copy.deepcopy(SAMPLE)
        x["intent_hypotheses"][0]["status"] = "FACT"
        with self.assertRaises(ContractError):
            validate_record(x)

    def test_confidence_bounded(self):
        x = copy.deepcopy(SAMPLE)
        x["intent_hypotheses"][0]["confidence"] = 1.2
        with self.assertRaises(ContractError):
            validate_record(x)

    def test_counterevidence_required(self):
        x = copy.deepcopy(SAMPLE)
        del x["intent_hypotheses"][0]["counterevidence_refs"]
        with self.assertRaises(ContractError):
            validate_record(x)

    def test_human_fusion_binding(self):
        x = copy.deepcopy(SAMPLE)
        x["fusion_status"] = "AI_ONLY_INCOMPLETE"
        with self.assertRaises(ContractError):
            validate_record(x)

    def test_ai_only_must_be_explicitly_incomplete(self):
        x = copy.deepcopy(SAMPLE)
        x["human_context"] = {"present": False}
        x["fusion_status"] = "AI_ONLY_INCOMPLETE"
        self.assertEqual(validate_record(x)["fusion_status"], "AI_ONLY_INCOMPLETE")

    def test_uncertainty_required(self):
        x = copy.deepcopy(SAMPLE)
        x["uncertainties"] = []
        with self.assertRaises(ContractError):
            validate_record(x)

    def test_trade_action_forbidden(self):
        x = copy.deepcopy(SAMPLE)
        x["action_code"] = "LONG"
        with self.assertRaises(ContractError):
            validate_record(x)

    def test_permissions_fail_closed(self):
        x = copy.deepcopy(SAMPLE)
        x["execution_permission"] = "ALLOW"
        with self.assertRaises(ContractError):
            validate_record(x)


if __name__ == "__main__":
    unittest.main()

