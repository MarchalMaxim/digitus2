"""Cached-mask reconstruction diagnostic; never reads reference MusicXML."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import pickle
import shutil
import sys
import time

os.environ["MPLBACKEND"] = "Agg"
os.environ["OMP_NUM_THREADS"] = "1"
BASE = Path("research/omr/results/local-options").resolve()
sys.path.insert(0, str(BASE / "source"))
import cv2
import numpy as np

class ArrayCache(pickle.Unpickler):
    def find_class(self, module, name):
        if module in ("numpy.core.multiarray", "numpy._core.multiarray") and name in ("_reconstruct", "scalar"):
            return getattr(np.core.multiarray, name)
        if module == "numpy" and name in ("ndarray", "dtype"):
            return getattr(np, name)
        if module == "sklearn.svm._classes" and name == "SVC":
            from sklearn.svm import SVC
            return SVC
        raise pickle.UnpicklingError((module, name))
pickle.load = lambda stream, **kwargs: ArrayCache(stream).load()
original_hough = cv2.HoughLinesP
cv2.HoughLinesP = lambda *a, **k: None if (result := original_hough(*a, **k)) is None else result.reshape(-1, 1, 4)
from oemer import ete, layers

def holes(image, box):
    x1, y1, x2, y2 = map(int, box)
    gray = cv2.cvtColor(image[y1:y2, x1:x2], cv2.COLOR_BGR2GRAY)
    if not gray.size:
        return []
    white = np.uint8(gray > 180)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(white, 8)
    areas = []
    for idx in range(1, count):
        x, y, w, h, area = stats[idx]
        if x > 0 and y > 0 and x+w < white.shape[1] and y+h < white.shape[0]:
            areas.append(int(area))
    return areas

def dump_notes(stage):
    image = layers.get_layer("original_image").copy()
    notes = layers.get_layer("notes") if stage == "rhythm" else current_notes
    records = []
    for note in notes:
        records.append({"id":note.id, "bbox":list(map(int,note.bbox)), "label":str(note.label), "invalid":bool(note.invalid),
                        "track":int(note.track), "group":int(note.group), "staffLinePosition":int(note.staff_line_pos),
                        "stemUp":note.stem_up, "holes":holes(image,note.bbox)})
    return records

parser = argparse.ArgumentParser()
parser.add_argument("image")
parser.add_argument("cache")
parser.add_argument("run_id")
parser.add_argument("--correction", choices=["none","raw-image"], default="none")
args = parser.parse_args()
if not args.run_id.replace("-", "").replace("_", "").isalnum():
    raise ValueError("Invalid run ID")
out = Path("research/omr/results/quality-wave") / args.run_id
out.mkdir(parents=True, exist_ok=False)
source_image, cache_path = Path(args.image), Path(args.cache)
image = out / "input.png"
shutil.copyfile(source_image, image)
with cache_path.open("rb") as stream:
    masks = ArrayCache(stream).load()
ete.generate_pred = lambda *a, **k: (masks["staff"].copy(),masks["symbols"].copy(),masks["stems_rests"].copy(),masks["note"].copy(),masks["clefs_keys"].copy())
original_note = ete.note_extract
snapshots = {}
current_notes = []
def note_extract():
    global current_notes
    current_notes = original_note()
    snapshots["noteheads"] = dump_notes("noteheads")
    if args.correction == "raw-image":
        from corrections import apply
        from oemer.notehead_extraction import NoteType
        current_notes, snapshots["changes"] = apply(current_notes, layers.get_layer("original_image"), layers.get_layer("staffs"), NoteType)
    return current_notes
ete.note_extract = note_extract
original_rhythm = ete.rhythm_extract
def rhythm_extract():
    original_rhythm()
    snapshots["rhythm"] = dump_notes("rhythm")
    image = layers.get_layer("original_image").copy()
    for record in snapshots["rhythm"]:
        x1,y1,x2,y2=record["bbox"]
        cv2.rectangle(image,(x1,y1),(x2,y2),(0,0,255),1)
        cv2.putText(image,str(record["id"]),(x1,y1-3),cv2.FONT_HERSHEY_SIMPLEX,.4,(0,0,255),1)
    cv2.imwrite(str(out/"notes.png"),image)
ete.rhythm_extract = rhythm_extract
started = time.perf_counter()
status = "failed"
try:
    ete.extract(argparse.Namespace(img_path=str(image), output_path=str(out/"recognized.musicxml"), use_tf=False, save_cache=False, without_deskew=True))
    status = "exported"
finally:
    result = {"status":status,"recognitionExecuted":False,"cachedMasks":True,"elapsedSeconds":time.perf_counter()-started,
              "imageSha256":hashlib.sha256(source_image.read_bytes()).hexdigest(),
              "cacheSha256":hashlib.sha256(cache_path.read_bytes()).hexdigest(),"snapshots":snapshots}
    (out/"diagnostic.json").write_text(json.dumps(result,indent=2,default=lambda x: x.item() if isinstance(x,np.generic) else str(x)))
    print(json.dumps({k:v for k,v in result.items() if k!="snapshots"},indent=2))
