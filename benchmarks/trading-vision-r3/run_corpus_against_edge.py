#!/usr/bin/env python3
from __future__ import annotations
import argparse, base64, hashlib, json, subprocess, sys, urllib.error, urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parent
MANIFEST=json.loads((ROOT/'corpus_manifest.json').read_text(encoding='utf-8'))
EVALUATOR=ROOT/'evaluate_results.py'
def post_json(base_url,path,payload,timeout):
    data=json.dumps(payload).encode('utf-8')
    req=urllib.request.Request(base_url.rstrip('/')+path,data=data,headers={'Content-Type':'application/json'},method='POST')
    try:
        with urllib.request.urlopen(req,timeout=timeout) as resp:return json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as exc:
        body=exc.read().decode('utf-8','replace')
        raise RuntimeError(f'{path} HTTP {exc.code}: {body}') from exc
def context_payload(case):
    return dict(case.get('supplied_market_context') or {})
def run_case(base_url,case,timeout,locale):
    image_path=ROOT/case['file'];image_bytes=image_path.read_bytes();digest=hashlib.sha256(image_bytes).hexdigest()
    if digest!=case['image_sha256']:raise RuntimeError(f"{case['case_id']}: fixture SHA mismatch")
    image_b64=base64.b64encode(image_bytes).decode('ascii')
    observe=post_json(base_url,'/v1/market/observe',{'image':image_b64,'image_mime_type':'image/png','source':{'source_id':f"r3:{case['case_id']}",'modality':'chart_image','captured_at':'2026-08-14T00:00:00Z'},'human_context':{'present':False},'market_context':context_payload(case),'locale':locale},timeout)
    record=observe.get('record') or {}
    if record.get('source',{}).get('image_sha256')!=digest:raise RuntimeError(f"{case['case_id']}: observe source binding mismatch")
    detect=post_json(base_url,'/v1/market/detect',{'image':image_b64,'image_mime_type':'image/png','record':record,'locale':locale},timeout)
    report=detect.get('report') or {}
    if report.get('source_binding',{}).get('image_sha256')!=digest:raise RuntimeError(f"{case['case_id']}: detect source binding mismatch")
    return {'case_id':case['case_id'],'market_observation':record,'detector_report':report}
def main():
    ap=argparse.ArgumentParser();ap.add_argument('--base-url',default='http://127.0.0.1:8787');ap.add_argument('--out',default=str(ROOT/'results.jsonl'));ap.add_argument('--receipt',default=str(ROOT/'run_receipt.json'));ap.add_argument('--timeout',type=float,default=60);ap.add_argument('--locale',default='en-US');args=ap.parse_args()
    rows=[]
    for case in MANIFEST['cases']:
        print(f"RUN {case['case_id']} {case['file']}",flush=True);rows.append(run_case(args.base_url,case,args.timeout,args.locale))
    out=Path(args.out);out.write_text(''.join(json.dumps(row,separators=(',',':'))+'\n' for row in rows),encoding='utf-8')
    ev=subprocess.run([sys.executable,str(EVALUATOR),str(out)],text=True,capture_output=True,check=False);sys.stdout.write(ev.stdout);sys.stderr.write(ev.stderr)
    receipt={'schema':'visionassist.trading_vision_r3_run.v1','base_url':args.base_url,'case_count':len(rows),'results_sha256':hashlib.sha256(out.read_bytes()).hexdigest(),'evaluator_exit_code':ev.returncode,'evaluator_pass':ev.returncode==0,'can_trade':False,'capital_permission':'DENY'}
    Path(args.receipt).write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf-8')
    if ev.returncode:raise SystemExit(ev.returncode)
    print('VISIONASSIST_TRADING_VISION_R3_RUN_PASS')
if __name__=='__main__':main()
