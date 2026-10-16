"""Bounded portable Audiveris CLI adapter. No service or uploads."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import shutil
import time

parser=argparse.ArgumentParser()
parser.add_argument("image")
parser.add_argument("run_id")
parser.add_argument("--timeout",type=int,default=180)
parser.add_argument("--runtime-root",default="research/omr/results/audiveris-spike")
parser.add_argument("--help-only",action="store_true")
parser.add_argument("--short-staves",action="store_true")
parser.add_argument("--text-models")
args=parser.parse_args()
if not args.run_id.replace("-","").replace("_","").isalnum():
    raise ValueError("Invalid run ID")
repo=Path.cwd()
bundle=Path(args.runtime_root).resolve()
archive=bundle/"audiveris-5.11.0.msi"
expected="5f1b4e96a12c53c7da426814b76e599363c4181e291855996e0a6878dda95f71"
if hashlib.sha256(archive.read_bytes()).hexdigest()!=expected:
    raise ValueError("Official release MSI hash mismatch")
portable=bundle/"portable/Audiveris"
out=(repo/"research/omr/results/quality-wave"/args.run_id)
out.mkdir(parents=True,exist_ok=False)
for name in ["home","tmp","roaming","local","javacpp","exports"]:
    (out/name).mkdir()
image=Path(args.image).resolve()
env=dict(os.environ)
env["APPDATA"]=str(out/"roaming")
env["LOCALAPPDATA"]=str(out/"local")
env["TEMP"]=env["TMP"]=str(out/"tmp")
env.pop("TESSDATA_PREFIX", None)
text_model_hash = None
if args.text_models:
    model = Path(args.text_models)/"eng.traineddata"
    text_model_hash = hashlib.sha256(model.read_bytes()).hexdigest()
    if text_model_hash != "daa0c97d651c19fba3b25e81317cd697e9908c8208090c94c3905381c23fc047":
        raise ValueError("English text model hash mismatch")
    (out/"tessdata").mkdir()
    shutil.copyfile(model, out/"tessdata/eng.traineddata")
    env["TESSDATA_PREFIX"] = str(out/"tessdata")
cmd=[str(portable/"runtime/bin/java.exe"),
     "-Xms256m","-Xmx4g","-XX:ActiveProcessorCount=4",
     "-Djava.awt.headless=true","-Dfile.encoding=UTF-8",
     "-Duser.home="+str(out/"home"),"-Djava.io.tmpdir="+str(out/"tmp"),
     "-Dorg.bytedeco.javacpp.cachedir="+str(out/"javacpp"),
     "--add-exports=java.desktop/sun.awt.image=ALL-UNNAMED",
     "--enable-native-access=ALL-UNNAMED",
     "-cp",str(portable/"app/*"),"Audiveris"]
if args.short_staves:
    cmd += ["-constant","org.audiveris.omr.sheet.grid.LinesRetriever.minStaffLength=12",
            "-constant","org.audiveris.omr.sheet.grid.ClustersRetriever.minClusterLengthRatio=0.15"]
if args.text_models:
    cmd += ["-constant","org.audiveris.omr.text.Language.defaultSpecification=eng"]
cmd+=["-help"] if args.help_only else ["-batch","-transcribe","-export","-save","-output",str(out/"exports"),"--",str(image)]
start=time.perf_counter()
with (out/"execution.log").open("wb") as log:
    process=subprocess.Popen(cmd,cwd=out,env=env,stdout=log,stderr=subprocess.STDOUT,
                             creationflags=getattr(subprocess,"CREATE_NO_WINDOW",0))
    timed_out=False
    try:exit_code=process.wait(timeout=args.timeout)
    except subprocess.TimeoutExpired:
        timed_out=True
        process.kill()
        exit_code=process.wait()
from audit_export import audit_archive
export_audits = []
for exported in (out/"exports").rglob("*.mxl"):
    try:
        audit = audit_archive(exported)
    except Exception as error:
        audit = {"unresolved":[{"code":"export-audit-failed","error":str(error)}] }
    export_audits.append({"path":str(exported.relative_to(out)), **audit})
result={"exportAudit":export_audits,"recognitionExecuted":not args.help_only,"elapsedSeconds":time.perf_counter()-start,
        "exitCode":exit_code,"timedOut":timed_out,"command":cmd,
        "msiSha256":expected,"textModelSha256":text_model_hash,
        "engineJarSha256":hashlib.sha256((portable/"app/audiveris.jar").read_bytes()).hexdigest(),
        "javaExeSha256":hashlib.sha256((portable/"runtime/bin/java.exe").read_bytes()).hexdigest(),"imageSha256":hashlib.sha256(image.read_bytes()).hexdigest(),
        "outputs":[{"path":str(p.relative_to(out)),"sha256":hashlib.sha256(p.read_bytes()).hexdigest(),"bytes":p.stat().st_size}
                   for p in (out/"exports").rglob("*") if p.is_file()]}
(out/"result.json").write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2))
raise SystemExit(1 if timed_out else exit_code)
