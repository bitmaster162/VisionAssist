from __future__ import annotations
import json, subprocess, sys, tempfile, threading, unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
ROOT=Path(__file__).resolve().parent
RUNNER=ROOT/'run_corpus_against_edge.py'
class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_POST(self):
        n=int(self.headers.get('Content-Length','0'));p=json.loads(self.rfile.read(n) or b'{}')
        if self.path=='/v1/market/observe':
            c=p.get('market_context') or {};ctx={k:({'value':c[k],'provenance':'PROVIDED_CONTEXT'} if c.get(k) else {'value':None,'provenance':'UNKNOWN'}) for k in ('symbol','venue','timeframe')};import base64,hashlib;sha=hashlib.sha256(base64.b64decode(p['image'])).hexdigest()
            record={'schema_version':'visionassist.market_observation.v1','request_id':'mock','source':{'source_id':p['source']['source_id'],'image_sha256':sha},'market_context':ctx,'visible_observations':[{'id':'obs:1','evidence_refs':['region:1']}],'structure_hypotheses':[{'id':'h1','evidence_refs':['region:1'],'counterevidence_refs':[]},{'id':'h2','evidence_refs':['region:1'],'counterevidence_refs':[]}],'counterevidence':[]}
            body={'record':record,'validation':{'valid':True}}
        elif self.path=='/v1/market/detect':
            record=p['record'];dets=[{'detector_id':'d:'+t.lower(),'detector_type':t,'status':'UNKNOWN','orientation':'UNKNOWN','description':None,'confidence':None,'evidence_refs':[],'counterevidence_refs':[],'invalidation_conditions':[],'level':{'value':None,'provenance':'UNKNOWN'},'abstention_reason':'mock_no_inference'} for t in ('SFP','CHOCH','BOS','SWEEP_RECLAIM')]
            case_id=record['source']['source_id'].split(':',1)[1];body={'report':{'source_binding':{'image_sha256':record['source']['image_sha256']},'detectors':dets,'quality':{'status':'ABSTAIN' if case_id=='TV-C03' else 'REVISE','reasons':['mock_no_inference']},'safety':{'decision_status':'DIAGNOSTIC_ONLY','action_code':'NO_ACTION','execution_permission':'HOLD','capital_permission':'DENY','can_trade':False}},'validation':{'valid':True}}
        else:self.send_response(404);self.end_headers();return
        raw=json.dumps(body).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
class RunnerTest(unittest.TestCase):
    def test_runner_executes_six_cases_and_evaluator(self):
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            with tempfile.TemporaryDirectory() as td:
                out=Path(td)/'results.jsonl';receipt=Path(td)/'receipt.json';r=subprocess.run([sys.executable,str(RUNNER),'--base-url',f'http://127.0.0.1:{server.server_port}','--out',str(out),'--receipt',str(receipt),'--timeout','5'],text=True,capture_output=True,check=False);self.assertEqual(r.returncode,0,r.stdout+r.stderr);self.assertEqual(len(out.read_text().splitlines()),6);data=json.loads(receipt.read_text());self.assertTrue(data['evaluator_pass']);self.assertFalse(data['can_trade']);self.assertEqual(data['capital_permission'],'DENY')
        finally:server.shutdown();server.server_close()
if __name__=='__main__':unittest.main()
