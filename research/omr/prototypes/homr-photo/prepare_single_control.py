"""Derive a public single-staff control from the existing CC0 Twinkle fixture."""
from pathlib import Path
import hashlib
import json
import xml.etree.ElementTree as ET

source=Path("research/omr/results/fixtures-final/twinkle-twinkle-little-star/reference.musicxml")
out=Path("research/omr/results/photo-options/public-single-control")
out.mkdir(exist_ok=False)
root=ET.parse(source).getroot()
for measure in root.findall("./part/measure"):
    for child in list(measure):
        if child.tag in {"backup", "forward"}:
            measure.remove(child)
        elif child.tag in {"note", "direction"} and child.findtext("staff", "1") != "1":
            measure.remove(child)
    for attributes in measure.findall("attributes"):
        staves=attributes.find("staves")
        if staves is not None:
            staves.text="1"
        for clef in list(attributes.findall("clef")):
            if clef.get("number","1")!="1":
                attributes.remove(clef)
    for note in measure.findall("note"):
        fingerings=note.findall("./notations/technical/fingering")
        for technical in note.findall("./notations/technical"):
            for fingering in technical.findall("fingering"):
                technical.remove(fingering)
destination=out/"single-staff.musicxml"
ET.ElementTree(root).write(destination,encoding="utf-8",xml_declaration=True)
(out/"manifest.json").write_text(json.dumps({
    "source":str(source),"sourceSha256":hashlib.sha256(source.read_bytes()).hexdigest(),
    "transform":"Keep staff 1 notes and directions; remove backups/forwards, staff 2 clef, set staves1, remove fingerings.",
    "privatePhotoDataUsed":False,
    "reference":str(destination),"referenceSha256":hashlib.sha256(destination.read_bytes()).hexdigest(),
    "measures":len(root.findall("./part/measure")),"pitchedNotes":len(root.findall("./part/measure/note/pitch"))
},indent=2))
print(destination)

