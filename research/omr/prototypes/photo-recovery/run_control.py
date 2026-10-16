from pathlib import Path
import sys,json,threading,time,xml.etree.ElementTree as ET
sys.path.insert(0,str(Path('research/omr/prototypes/local-worker').resolve()))
from audiveris import Audiveris,unwrap_mxl
out=Path(sys.argv[1]).resolve();job=out/'job';job.mkdir();start=time.monotonic()
r={'input':str(out/'prepared.png')}
try:r['result']=str(Audiveris('research/omr/results/audiveris-spike',short_staves=True,text_models='research/omr/results/quality-wave/text-models')(out/'prepared.png',job,threading.Event()))
except Exception as e:r['error']=str(e)
r['seconds']=time.monotonic()-start;r['exports']=[]
for f in job.rglob('*.mxl'):
 data=unwrap_mxl(f);target=f.with_suffix('.musicxml');target.write_bytes(data);root=ET.fromstring(data)
 r['exports'].append({'path':str(target),'notes':len(root.findall('.//note/pitch')),'parts':len(root.findall('part')),'measures':len(root.findall('.//measure')),'staves':[n.text for n in root.findall('.//staves')],'clefs':[n.findtext('sign') for n in root.findall('.//clef')]})
(out/'outcome.json').write_text(json.dumps(r,indent=2));print(json.dumps(r,indent=2))
