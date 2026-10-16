"""Inspect recognized export completeness without changing the raw MusicXML."""
import re
import xml.etree.ElementTree as ET
from zipfile import ZipFile


def audit_musicxml(data):
    root = ET.fromstring(data)
    unresolved = []
    for measure in root.findall(".//measure"):
        for direction in measure.findall("direction"):
            words = " ".join((e.text or "") for e in direction.findall(".//words"))
            if re.search(r"[=:]\s*\d", words) and direction.find(".//metronome") is None:
                unresolved.append({
                    "code": "metronome-beat-unit-unresolved",
                    "measure": measure.attrib.get("number"),
                    "recognizedText": words,
                    "reason": "Equation-like OCR text has no recognized metronome beat unit; no BPM is guessed.",
                })
    if root.find(".//time") is None:
        unresolved.append({"code": "meter-unresolved"})
    return {
        "meterElements": len(root.findall(".//time")),
        "beamElements": len(root.findall(".//beam")),
        "metronomeElements": len(root.findall(".//metronome")),
        "playbackTempos": [e.attrib["tempo"] for e in root.findall(".//sound") if "tempo" in e.attrib],
        "unresolved": unresolved,
    }


def audit_archive(path):
    with ZipFile(path) as archive:
        container = ET.fromstring(archive.read("META-INF/container.xml"))
        entry = next(e for e in container.iter() if e.tag.endswith("rootfile")).attrib["full-path"]
        return audit_musicxml(archive.read(entry))
