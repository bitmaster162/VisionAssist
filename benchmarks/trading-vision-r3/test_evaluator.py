from __future__ import annotations
import json, subprocess, sys, tempfile, unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parent
EVALUATOR=ROOT/'evaluate_results.py'
MANIFEST=json.loads((ROOT/'corpus_manifest.json').read_text(encoding='utf-8'))
def unknown_detector(t):
    return {'detector_id':f'det:{t.lower()}','detector_type':t,'status':'UNKNOWN','orientation':'UNKNOWN','description':None,'confidence':None,'evidence_refs':[],'counterevidence_refs':[],'invalidation_conditions':[],'level':{'value':None,'provenance':'UNKNOWN'},'abstention_reason':'engineering_fixture_no_inference'}
def build_row(case):
    return {'case_id':case['case_id'],'market_observation':{'market_context':{k:{'value':None,'provenance':'UNKNOWN'} for k in ('symbol','venue','timeframe')},'visible_observations':[{'id':'obs:1','evidence_refs':['region:1']}],'structure_hypotheses':[{'id':'hyp:1','evidence_refs':['region:1'],'counterevidence_refs':[]}],'counterevidence':[]},'detector_report':{'detectors':[unknown_detector(t) for t in ('SFP','CHOCH','BOS','SWEEP_RECLAIM')],'quality':{'status':'ABSTAIN' if case['case_id']=='TV-C03' else 'REVISE','reasons':['engineering_fixture_no_inference']},'safety':{'decision_status':'DIAGNOSTIC_ONLY','action_code':'NO_ACTION','execution_permission':'HOLD','capital_permission':'DENY','can_trade':False}}}
def run_eval(rows):
    with tempfile.NamedTemporaryFile('w',suffix='.jsonl',delete=False,encoding='utf-8') as h:
        p=Path(h.name)
        for row in rows:h.write(json.dumps(row)+'\n')
    try:return subprocess.run([sys.executable,str(EVALUATOR),str(p)],text=True,capture_output=True,check=False)
    finally:p.unlink(missing_ok=True)
class EvaluatorSelfTest(unittest.TestCase):
    def test_all_unknown_abstention_fixture_passes(self):
        r=run_eval([build_row(c) for c in MANIFEST['cases']]);self.assertEqual(r.returncode,0,r.stdout+r.stderr);self.assertIn('VISIONASSIST_CORPUS_EVAL_PASS cases=6',r.stdout)
    def test_prompt_injection_cannot_flip_can_trade(self):
        rows=[build_row(c) for c in MANIFEST['cases']];next(x for x in rows if x['case_id']=='TV-C05')['detector_report']['safety']['can_trade']=True;r=run_eval(rows);self.assertNotEqual(r.returncode,0);self.assertIn('TV-C05: can_trade',r.stdout)
if __name__=='__main__':unittest.main()
