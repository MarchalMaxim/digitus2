"""Create an explicit patched source copy; never mutate the pinned original."""
from __future__ import annotations
import argparse
import difflib
import hashlib
from pathlib import Path
import shutil

COMMIT = "ab369ac54277afab582afa4725441f7cbba76593"

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--toolchain",type=Path,default=Path("research/omr/results/photo-options/toolchain"))
    args=p.parse_args()
    original=args.toolchain.resolve()/f"homr-{COMMIT}"
    patched=args.toolchain.resolve()/f"homr-{COMMIT}-piano-cues"
    if patched.exists():
        raise FileExistsError(patched)
    shutil.copytree(original,patched)
    helper=Path(__file__).with_name("piano_cues.py").read_text(encoding="utf-8")
    main_path=patched/"homr/main.py"
    old=main_path.read_text(encoding="utf-8")
    new=old.replace("import glob\n", "import glob\nimport json\n",1)
    new=new.replace("from homr import color_adjust, download_utils\n",
                    "from homr import color_adjust, download_utils\nfrom homr.piano_cues import select_piano_systems\n",1)
    needle="        multi_staffs = repair_systems(debug, multi_staffs)"
    assert old.count(needle)==1
    replacement="""        multi_staffs, cue_audit = select_piano_systems(multi_staffs)
        with open(os.path.splitext(image_path)[0] + "_piano-cues.json", "w") as audit_file:
            json.dump(cue_audit, audit_file, indent=2)
        eprint("Experimental piano cue selection:", cue_audit)
        multi_staffs = repair_systems(debug, multi_staffs)"""
    new=new.replace(needle,replacement,1)
    main_path.write_text(new, encoding="utf-8", newline="\r\n")
    (patched/"homr/piano_cues.py").write_text(helper, encoding="utf-8", newline="\r\n")
    diff="".join(difflib.unified_diff(old.splitlines(keepends=True),new.splitlines(keepends=True),fromfile="a/homr/main.py",tofile="b/homr/main.py"))
    diff+="".join(difflib.unified_diff([],helper.splitlines(keepends=True),fromfile="/dev/null",tofile="b/homr/piano_cues.py"))
    retained = Path(__file__).with_name("upstream.patch").read_text(encoding="utf-8")
    if retained != diff:
        raise ValueError("Generated cue patch differs from the retained upstream diff")
    (patched/"patch-sha256.txt").write_text(hashlib.sha256(diff.encode()).hexdigest()+"\n")
    print(patched)

if __name__=="__main__":
    main()

