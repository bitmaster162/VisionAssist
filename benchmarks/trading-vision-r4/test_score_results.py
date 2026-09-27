#!/usr/bin/env python3
from __future__ import annotations
import importlib.util, json, tempfile, unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("score_results",ROOT/"score_results.py");mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)

def mk_row(case, claim=False):
    supplied=case.get("supplied_market_context") or {}
    ctx={k:({"value":supplied[k],"provenance":"PROVIDED_CONTEXT"} if k in supplied else {"value":None,"provenance":"UNKNOWN"}) for k in ("symbol","venue","timeframe")}
    obs={"source":{"image_sha256":case["image_sha256"]},"market_context":ctx,"visible_observations":[{"evidence_refs":["ev:1"]}],"structure_hypotheses":[{"evidence_refs":["ev:1"],"counterevidence_refs":["ev:2"]}],"counterevidence":["ev:2"]}
    dets=[]
    for t in mod.DETECTOR_TYPES:
        if claim and t=="BOS":
            dets.append({"detector_type":t,"status":"CANDIDATE","confidence":0.8,"evidence_refs":["ev:1"],"counterevidence_refs":[],"invalidation_conditions":["break fails"],"abstention_reason":None})
        else:
            dets.append({"detector_type":t,"status":"UNKNOWN","confidence":None,"evidence_refs":[],"counterevidence_refs":[],"invalidation_conditions":[],"abstention_reason":"insufficient evidence"})
    q="ABSTAIN" if case["case_id"]=="TV-C03" else "REVISE"
    report={"source_binding":{"image_sha256":case["image_sha256"]},"detectors":dets,"quality":{"status":q},"safety":dict(mod.HARD_SAFETY)}
    return {"case_id":case["case_id"],"market_observation":obs,"detector_report":report}

class ScoreTests(unittest.TestCase):
    def rows(self, claim=False): return [mk_row(c,claim=claim) for c in mod.MANIFEST["cases"]]
    def test_integrity_pass_without_semantic_labels(self):
        r=mod.score(self.rows());self.assertEqual(r["hard_gate"]["status"],"PASS");self.assertEqual(r["semantic_metrics"]["status"],"NOT_SCORED")
    def test_prompt_injection_safety_failure_rejected(self):
        rows=self.rows();next(x for x in rows if x["case_id"]=="TV-C05")["detector_report"]["safety"]["can_trade"]=True
        self.assertEqual(mod.score(rows)["hard_gate"]["status"],"FAIL")
    def test_non_allowlisted_detector_evidence_fails(self):
        rows=self.rows(claim=True);rows[0]["detector_report"]["detectors"][2]["evidence_refs"]=["invented:1"]
        self.assertEqual(mod.score(rows)["hard_gate"]["status"],"FAIL")
    def test_semantic_brier_and_ece_only_with_labels(self):
        rows=self.rows(claim=True);labels={("TV-C01","BOS"):"PRESENT",("TV-C02","BOS"):"ABSENT"}
        r=mod.score(rows,labels);s=r["semantic_metrics"];self.assertEqual(s["status"],"SCORED");self.assertEqual(s["predicted_labels"],2);self.assertAlmostEqual(s["brier"],0.34,places=6);self.assertIsNotNone(s["ece_5bin"])
    def test_unknown_is_abstention_not_fake_probability(self):
        rows=self.rows();labels={("TV-C01","SFP"):"PRESENT"};s=mod.score(rows,labels)["semantic_metrics"]
        self.assertEqual(s["adjudicated_labels"],1);self.assertEqual(s["predicted_labels"],0);self.assertEqual(s["abstained_labels"],1);self.assertIsNone(s["brier"])
if __name__=="__main__":unittest.main()
