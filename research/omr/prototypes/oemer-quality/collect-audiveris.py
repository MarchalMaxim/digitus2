"""Collect raw Audiveris exports into unambiguous scoring/render folders."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
from zipfile import ZipFile
import xml.etree.ElementTree as ET

p=argparse.ArgumentParser()
p.add_argument("job")
p.add_argument("piece_id")
p.add_argument("destination")
a=p.parse_args()
if not a.piece_id.replace("-","").isalnum():raise ValueError("Invalid fixture mapping")
job=Path(a.job)
outputs=list((job/"exports").rglob("*.mxl"))
if len(outputs)!=1:raise ValueError("Expected one whole-score raw MXL")
root=Path(a.destination)
(root/"scores").mkdir(parents=True,exist_ok=True)
(root/"render-xml").mkdir(parents=True,exist_ok=True)
target=root/"scores"/(a.piece_id+".mxl")
if target.exists():raise FileExistsError(target)
shutil.copyfile(outputs[0],target)
with ZipFile(target) as archive:
    container=ET.fromstring(archive.read("META-INF/container.xml"))
    entry=next(n for n in container.iter() if n.tag.endswith("rootfile")).attrib["full-path"]
    if entry.startswith(("/","\\")) or ".." in Path(entry).parts:raise ValueError("Unsafe rootfile path")
    xml=archive.read(entry)
(root/"render-xml"/(a.piece_id+".musicxml")).write_bytes(xml)
print(json.dumps({"rawMxl":str(target),"rawMxlSha256":hashlib.sha256(target.read_bytes()).hexdigest(),
                  "xmlSha256":hashlib.sha256(xml).hexdigest(),"xmlMeasures":len(ET.fromstring(xml).findall(".//measure"))}))
