"""Optional source-only checkout reproduction; never invokes model inference."""
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
COMMIT = "ab369ac54277afab582afa4725441f7cbba76593"
PRISTINE = REPO / "research/omr/results/photo-options/toolchain" / f"homr-{COMMIT}"

class CheckoutReproductionTests(unittest.TestCase):
    @unittest.skipUnless(PRISTINE.is_dir(), "Optional pinned source runtime is not prepared")
    def test_lf_checkout_rebuilds_exact_pins_without_modifying_retained_diffs(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary)
            for folder in ("homr-photo","photo-recovery"):
                original=HERE.parent/folder
                copied=root/"prototypes"/folder
                copied.mkdir(parents=True)
                for path in original.iterdir():
                    if path.is_file():
                        copied.joinpath(path.name).write_bytes(path.read_bytes().replace(b"\r\n",b"\n"))
            toolchain=root/"toolchain"
            shutil.copytree(PRISTINE,toolchain/PRISTINE.name,ignore=shutil.ignore_patterns("*.onnx","__pycache__","*.pyc"))
            patches={p:p.read_bytes() for p in (root/"prototypes").rglob("*.patch")}
            command=[sys.executable,str(root/"prototypes/homr-photo/prepare_patched.py"),"--toolchain",str(toolchain)]
            result=subprocess.run(command,capture_output=True,text=True,timeout=30)
            self.assertEqual(result.returncode,0,result.stdout+"\n"+result.stderr)
            self.assertEqual({p:p.read_bytes() for p in patches},patches,"setup rewrote retained diff artifacts")
            result=subprocess.run(command,capture_output=True,text=True,timeout=30)
            self.assertEqual(result.returncode,0,result.stdout+"\n"+result.stderr)
            record=json.loads((toolchain/"setup-source-provenance.json").read_text())
            self.assertEqual(record["patchedTreeSha256"],"98d63faa7addc228ecaaa8ee1695f2e14aba9f71b50805417c3cd5c8ef381be4")

if __name__=="__main__":
    unittest.main()

