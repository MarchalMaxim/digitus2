"""Compare locally generated native masks with recorded browser label hashes.

No inference. Only NumPy value constructors are allowed when loading our cache.
Usage: python compare-label-parity.py NATIVE.pkl NATIVE.png BROWSER.json
"""
import hashlib
import json
import pickle
import sys
from pathlib import Path

import numpy as np


class ArrayCache(pickle.Unpickler):
    def find_class(self, module, name):
        if module in ("numpy.core.multiarray", "numpy._core.multiarray"):
            if name in ("_reconstruct", "scalar"):
                return getattr(np.core.multiarray, name)
        if module == "numpy" and name in ("ndarray", "dtype"):
            return getattr(np, name)
        raise pickle.UnpicklingError(f"Forbidden cache global: {module}.{name}")


cache_path, image_path, browser_path = map(Path, sys.argv[1:])
browser = json.loads(browser_path.read_text())
input_hash = hashlib.sha256(image_path.read_bytes()).hexdigest()
if input_hash != browser["inputSha256"]:
    raise ValueError("Native and browser input hashes differ")
with cache_path.open("rb") as stream:
    masks = ArrayCache(stream).load()
maps = [
    masks["staff"] + 2 * masks["symbols"],
    masks["stems_rests"] + 2 * masks["note"] + 3 * masks["clefs_keys"],
]
native = [hashlib.sha256(x.astype(np.uint8).tobytes()).hexdigest() for x in maps]
actual = [x["labelSha256"] for x in browser["modelRuns"]]
result = {
    "inputSha256": input_hash,
    "nativeCacheSha256": hashlib.sha256(cache_path.read_bytes()).hexdigest(),
    "nativeLabels": native,
    "browserLabels": actual,
    "exactLabelParity": native == actual,
}
print(json.dumps(result, indent=2))
if native != actual:
    raise SystemExit(1)
