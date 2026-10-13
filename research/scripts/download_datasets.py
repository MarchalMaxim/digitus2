#!/usr/bin/env python
"""Idempotent, concurrency-safe downloader/extractor for the digitus2 research datasets.

Usage (from the project root):

    research/.venv/Scripts/python.exe -I research/scripts/download_datasets.py            # everything
    research/.venv/Scripts/python.exe -I research/scripts/download_datasets.py pig mutopia_src
    research/.venv/Scripts/python.exe -I research/scripts/download_datasets.py --list
    research/.venv/Scripts/python.exe -I research/scripts/download_datasets.py --verify    # re-hash extracted files

Design
------
* Every source extracts into its own directory under ``research/data/<name>/``.
* Archives are cached in ``research/data/_downloads/`` and verified (sha256 where the
  remote file is static; per-file git-blob SHA-1 manifests where the archive is a
  GitHub-generated zip, because GitHub does not guarantee byte-stable zips).
* Safe to run concurrently with another process: each source takes an exclusive
  lock file (``research/data/.locks/<name>.lock``), extraction happens into a fresh
  temporary sibling directory that is atomically renamed into place, and a
  ``.download_complete.json`` stamp marks a finished target. If the stamp exists
  the source is skipped (idempotent).
* Downloaded content is treated as untrusted data: archive members are validated
  against path traversal, ``__MACOSX``/``.DS_Store`` junk is dropped, nothing that
  was downloaded is ever executed or imported.

Only the Python standard library is used so the script can run before the venv exists.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import shutil
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zipfile
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import Callable

HERE = Path(__file__).resolve().parent
RESEARCH = HERE.parent
DATA = RESEARCH / "data"
DOWNLOADS = DATA / "_downloads"
LOCKS = DATA / ".locks"
MANIFESTS = DATA / "manifests"
STAMP = ".download_complete.json"
USER_AGENT = "digitus2-research-downloader/1.0 (+https://github.com/; non-commercial research)"


# --------------------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------------------

def log(msg: str) -> None:
    print(f"[download] {msg}", flush=True)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def git_blob_sha1(data: bytes) -> str:
    """SHA-1 exactly as git computes it for a blob (lets us compare with GitHub trees)."""
    h = hashlib.sha1()
    h.update(b"blob %d\0" % len(data))
    h.update(data)
    return h.hexdigest()


class FileLock:
    """Very small cross-platform exclusive lock based on O_CREAT|O_EXCL."""

    def __init__(self, name: str, timeout: float = 1800.0, stale_after: float = 3600.0):
        LOCKS.mkdir(parents=True, exist_ok=True)
        self.path = LOCKS / f"{name}.lock"
        self.timeout = timeout
        self.stale_after = stale_after
        self.fd: int | None = None

    def __enter__(self) -> "FileLock":
        start = time.time()
        while True:
            try:
                self.fd = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                os.write(self.fd, f"{os.getpid()} {time.time()}\n".encode())
                return self
            except FileExistsError:
                try:
                    age = time.time() - self.path.stat().st_mtime
                except FileNotFoundError:
                    continue
                if age > self.stale_after:
                    log(f"breaking stale lock {self.path} (age {age:.0f}s)")
                    try:
                        self.path.unlink()
                    except FileNotFoundError:
                        pass
                    continue
                if time.time() - start > self.timeout:
                    raise TimeoutError(f"could not acquire {self.path}")
                time.sleep(2.0)

    def __exit__(self, *exc) -> None:
        if self.fd is not None:
            os.close(self.fd)
            self.fd = None
        try:
            self.path.unlink()
        except FileNotFoundError:
            pass


def fetch(url: str, dest: Path, sha256: str | None = None, retries: int = 3,
          timeout: float = 120.0) -> Path:
    """Download ``url`` to ``dest`` atomically (tmp file + rename); verify sha256 if given."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and (sha256 is None or sha256_file(dest) == sha256):
        log(f"cached: {dest.name}")
        return dest
    last_err: Exception | None = None
    for attempt in range(1, retries + 1):
        tmp = dest.with_name(f"{dest.name}.part-{os.getpid()}")
        try:
            log(f"GET {url} (attempt {attempt})")
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=timeout) as r, open(tmp, "wb") as f:
                shutil.copyfileobj(r, f, 1 << 20)
            if sha256 is not None:
                got = sha256_file(tmp)
                if got != sha256:
                    raise ValueError(f"sha256 mismatch for {url}: {got} != {sha256}")
            os.replace(tmp, dest)
            return dest
        except (urllib.error.URLError, OSError, ValueError, TimeoutError) as e:  # noqa: PERF203
            last_err = e
            log(f"  failed: {e}")
            try:
                tmp.unlink()
            except FileNotFoundError:
                pass
            time.sleep(2 * attempt)
    raise RuntimeError(f"download failed for {url}: {last_err}")


def fetch_first(urls: list[str], dest: Path, sha256: str | None = None) -> tuple[Path, str]:
    errs = []
    for u in urls:
        try:
            return fetch(u, dest, sha256=sha256), u
        except RuntimeError as e:
            errs.append(str(e))
    raise RuntimeError("all mirrors failed:\n  " + "\n  ".join(errs))


def safe_relpath(name: str) -> PurePosixPath | None:
    """Return a safe relative posix path for an archive member, or None to skip it."""
    p = PurePosixPath(name.replace("\\", "/"))
    if p.is_absolute() or any(part in ("..", "") for part in p.parts):
        return None
    if any(part == "__MACOSX" or part == ".DS_Store" or part.startswith("._") for part in p.parts):
        return None
    return p


def extract_zip(zpath: Path, out_dir: Path, select: Callable[[str], str | None]) -> list[str]:
    """Extract members for which ``select(name)`` returns a relative output path."""
    written = []
    with zipfile.ZipFile(zpath) as z:
        for info in z.infolist():
            if info.is_dir():
                continue
            rel = select(info.filename)
            if rel is None:
                continue
            sp = safe_relpath(rel)
            if sp is None:
                continue
            target = long_path(out_dir.joinpath(*sp.parts))
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with z.open(info) as src, open(target, "wb") as dst:
                shutil.copyfileobj(src, dst)
            written.append(sp.as_posix())
    return written


LONG_PREFIX = "\\\\?\\"  # the 4 characters \\?\


def long_path(p: Path | str) -> str:
    """Windows: add the extended-length prefix so paths longer than MAX_PATH (260) work."""
    s = os.path.abspath(str(p))
    if os.name == "nt" and not s.startswith(LONG_PREFIX):
        s = LONG_PREFIX + s
    return s


def strip_prefix(prefix: str) -> Callable[[str], str | None]:
    """Select members under ``prefix`` (searched anywhere in the path) and strip it."""
    def sel(name: str) -> str | None:
        i = name.find(prefix)
        if i < 0:
            return None
        rest = name[i + len(prefix):]
        return rest or None
    return sel


def file_manifest(root: Path) -> dict[str, dict]:
    out = {}
    for dirpath, _dirs, fnames in os.walk(long_path(root)):
        for fn in fnames:
            if fn == STAMP:
                continue
            full = os.path.join(dirpath, fn)
            with open(full, "rb") as fh:
                data = fh.read()
            rel = os.path.relpath(full, long_path(root)).replace(os.sep, "/")
            out[rel] = {
                "size": len(data),
                "sha256": hashlib.sha256(data).hexdigest(),
                "git_blob_sha1": git_blob_sha1(data),
            }
    return dict(sorted(out.items()))


def verify_against_manifest(root: Path, manifest_path: Path, key: str = "git_blob_sha1") -> list[str]:
    """Return a list of problems ([] if the directory matches the committed manifest)."""
    if not manifest_path.exists():
        return [f"no manifest at {manifest_path}"]
    expected = json.loads(manifest_path.read_text(encoding="utf-8"))["files"]
    problems = []
    for rel, meta in expected.items():
        p = long_path(root / rel)
        if not os.path.exists(p):
            problems.append(f"missing {rel}")
            continue
        with open(p, "rb") as fh:
            data = fh.read()
        got = git_blob_sha1(data) if key == "git_blob_sha1" else hashlib.sha256(data).hexdigest()
        if got != meta[key]:
            problems.append(f"hash mismatch {rel}")
    return problems


# --------------------------------------------------------------------------------------
# sources
# --------------------------------------------------------------------------------------

@dataclass
class Source:
    name: str
    description: str
    build: Callable[[Path], dict]          # fills a fresh directory, returns stamp info
    manifest: str | None = None            # committed manifest (relative to MANIFESTS)
    default: bool = True
    notes: list[str] = field(default_factory=list)


# ---- PIG v1.2 -------------------------------------------------------------------------
# The official distribution (https://beam.kisarazu.ac.jp/research/PianoFingeringDataset/)
# is behind a registration form (name, affiliation, phone, e-mail; one-hour password sent
# by e-mail). We therefore fetch byte-identical public mirrors pinned to a commit. Both
# mirrors below were verified to have identical git blob SHA-1s for all 463 files of
# PianoFingeringDataset_v1.2 (README.pdf states "version 1.2 (2022/5/12)").
PIG_MIRRORS = [
    ("https://codeload.github.com/CHOWMHALVIN/Piano-Fingering-Suggestion-Model-with-Intuitive-UI/zip/"
     "0aebdd3b29db1f71d2d2708c298b051727363d91"),
    ("https://codeload.github.com/lemonadedw/BACHprop/zip/"
     "ec4672194effa90891bc83af4b748f7b7c045051"),
]


def build_pig(out: Path) -> dict:
    zpath, url = fetch_first(PIG_MIRRORS, DOWNLOADS / "pig_v1.2_mirror.zip")
    written = extract_zip(zpath, out, strip_prefix("/PianoFingeringDataset_v1.2/"))
    n_fing = sum(1 for w in written if w.startswith("FingeringFiles/") and w.endswith("_fingering.txt"))
    if n_fing != 309:
        raise RuntimeError(f"expected 309 fingering files, got {n_fing}")
    return {"url": url, "files": len(written), "fingering_files": n_fing,
            "version": "PIG Dataset v1.2 (2022/5/12)",
            "official_page": "https://beam.kisarazu.ac.jp/research/PianoFingeringDataset/",
            "license": "Only nonprofit, academic use is allowed. (cite Nakamura, Saito & Yoshii 2020)"}


# ---- Nakamura et al. source code + published HMM outputs ---------------------------------
STATPF = "https://statpianofingering.github.io/data/"
STATPF_FILES = {
    "SourceCode_v190921.zip": None,
    "Result_FHMM1.zip": None,
    "Result_FHMM2.zip": None,
    "Result_FHMM3.zip": None,
}


def build_pig_hmm(out: Path) -> dict:
    info = {"base_url": STATPF, "archives": {}}
    for fname in STATPF_FILES:
        sha = _pinned_sha256("pig_hmm", fname)
        zpath = fetch(STATPF + fname, DOWNLOADS / f"statpf_{fname}", sha256=sha)
        written = extract_zip(zpath, out, lambda n: n)
        info["archives"][fname] = {"sha256": sha256_file(zpath), "members": len(written)}
    info["note"] = ("C++ source for HMM1/2/3, chord HMM, training and evaluation tools "
                    "(Evaluate_SimpleMatchRate, Evaluate_MultipleGroundTruth) plus the HMM "
                    "outputs on the 30 test pieces used for Table 2 of Nakamura et al. 2020.")
    return info


# ---- Ramoneda et al. (ArGNN, ACM MM 2022) split -----------------------------------------
RAMONEDA_COMMIT = "d0d2f433c926be5e89540cbafe38bf43820ad2d2"
RAMONEDA_RAW = f"https://raw.githubusercontent.com/PRamoneda/Automatic-Piano-Fingering/{RAMONEDA_COMMIT}/"


def build_ramoneda(out: Path) -> dict:
    files = {"PianoFingeringDataset_v1.02/official_split.json": "official_split.json",
             "LICENSE": "LICENSE", "README.md": "README.md"}
    for src, dst in files.items():
        p = fetch(RAMONEDA_RAW + src, DOWNLOADS / f"ramoneda_{dst}")
        shutil.copyfile(p, out / dst)
    return {"repo": "https://github.com/PRamoneda/Automatic-Piano-Fingering", "commit": RAMONEDA_COMMIT,
            "license": "MIT (code repository)"}


# ---- Mutopia Project LilyPond sources ------------------------------------------------------
# Public-domain / Creative Commons engravings; every piece carries its own licence in the
# LilyPond \header (``license = "Public Domain"`` / ``"Creative Commons Attribution-ShareAlike 4.0"``...).
MUTOPIA_COMMIT = "2144afd6f52d56c5b6995b8b589ef1268b3139f0"   # master on 2024-11-07
MUTOPIA_ZIP = f"https://codeload.github.com/MutopiaProject/MutopiaProject/zip/{MUTOPIA_COMMIT}"


def build_mutopia_src(out: Path) -> dict:
    zpath = fetch(MUTOPIA_ZIP, DOWNLOADS / f"mutopia_{MUTOPIA_COMMIT[:12]}.zip")
    keep_ext = (".ly", ".ily", ".lyi", ".lyp", ".ily2")
    # keep only keyboard pieces (decided from the \header mutopiainstrument of their .ly files)
    import re as _re
    inst_rx = _re.compile(r'mutopiainstrument\s*=\s*"([^"]*)"')
    kb_rx = _re.compile(r"piano|harpsichord|clavichord|keyboard|clavier|fortepiano|spinet|virginal", _re.I)
    keep_dirs = set()
    with zipfile.ZipFile(zpath) as z:
        for info in z.infolist():
            parts = info.filename.split("/")
            if info.is_dir() or len(parts) < 5 or parts[1] != "ftp" or not info.filename.endswith(".ly"):
                continue
            m = inst_rx.search(z.read(info).decode("utf-8", "replace"))
            if m and kb_rx.search(m.group(1)):
                keep_dirs.add("/".join(parts[1:5]))

    def sel(name: str) -> str | None:
        rest = name.split("/", 1)[1] if "/" in name else ""
        if rest.startswith("ftp/") and rest.lower().endswith(keep_ext) and "/".join(rest.split("/")[:4]) in keep_dirs:
            return rest
        if rest in ("README.rst",):
            return rest
        return None

    written = extract_zip(zpath, out, sel)
    return {"repo": "https://github.com/MutopiaProject/MutopiaProject", "commit": MUTOPIA_COMMIT,
            "files": len(written), "keyboard_piece_dirs": len(keep_dirs),
            "license": "per piece, see the 'license'/'copyright' field of each LilyPond header "
                       "(Public Domain, CC BY, CC BY-SA ...)"}


# ---- PianoVAM v1.2 fingering labels (no audio/video) -------------------------------------
PIANOVAM_REV = "1f039ab9d6128626bff708faad6472d220b50eaa"   # v1.2, 2026-09-27
PIANOVAM_BASE = "https://huggingface.co/datasets/PianoVAM/PianoVAM_v1/resolve/{rev}/"
PIANOVAM_API = "https://huggingface.co/api/datasets/PianoVAM/PianoVAM_v1/tree/{rev}/{path}"


def build_pianovam(out: Path) -> dict:
    rev = PIANOVAM_REV
    files = ["README.md", "metadata.json"]
    for folder in ("Fingering", "Fingering_GT", "TSV"):
        req = urllib.request.Request(PIANOVAM_API.format(rev=rev, path=folder), headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=60) as r:
            listing = json.loads(r.read().decode("utf-8"))
        files += [x["path"] for x in listing if x.get("type") == "file"]
    for f in files:
        sp = safe_relpath(f)
        if sp is None:
            continue
        dst = out.joinpath(*sp.parts)
        dst.parent.mkdir(parents=True, exist_ok=True)
        p = fetch(PIANOVAM_BASE.format(rev=rev) + f, DOWNLOADS / "pianovam" / rev / sp.as_posix())
        shutil.copyfile(p, dst)
    return {"repo": "https://huggingface.co/datasets/PianoVAM/PianoVAM_v1", "revision": rev, "files": len(files),
            "license": "CC BY-NC-SA 4.0", "note": "only Fingering/, Fingering_GT/, TSV/, metadata.json and README.md (no audio/video/MIDI)"}


def _hf_revision(repo: str) -> str:
    """Resolve the current commit sha of a HuggingFace dataset repo (pins the download)."""
    req = urllib.request.Request(f"https://huggingface.co/api/datasets/{repo}", headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))["sha"]


# ---- pydactyl (D. Randolph) Beringer & Dunhill scales/arpeggios with fingerings -------------
PYDACTYL_COMMIT = "0ad656db9b778508453a7275dc698b9129ca765e"   # master on 2023-06-28
PYDACTYL_ZIP = "https://codeload.github.com/dvdrndlph/pydactyl/zip/{commit}"


def build_pydactyl(out: Path) -> dict:
    commit = PYDACTYL_COMMIT
    zpath = fetch(PYDACTYL_ZIP.format(commit=commit), DOWNLOADS / f"pydactyl_{commit[:12]}.zip")

    def sel(name: str) -> str | None:
        rest = name.split("/", 1)[1] if "/" in name else ""
        if rest.startswith("data/corpora/") or rest in ("LICENSE", "README.md"):
            return rest
        return None

    written = extract_zip(zpath, out, sel)
    return {"repo": "https://github.com/dvdrndlph/pydactyl", "commit": commit, "files": len(written),
            "license": "MIT (repository); fingerings transcribed from Beringer & Dunhill (1900), public domain"}


def _gh_commit(repo: str, ref: str) -> str:
    req = urllib.request.Request(f"https://api.github.com/repos/{repo}/commits/{ref}",
                                 headers={"User-Agent": USER_AGENT, "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))["sha"]


# ---- pinned hashes ----------------------------------------------------------------------

def _pinned_sha256(source: str, fname: str) -> str | None:
    p = MANIFESTS / "archives.json"
    if not p.exists():
        return None
    d = json.loads(p.read_text(encoding="utf-8"))
    return d.get(source, {}).get(fname)


SOURCES: dict[str, Source] = {}


def register(src: Source) -> None:
    SOURCES[src.name] = src


register(Source("pig", "PIG Dataset v1.2 (Nakamura, Saito & Yoshii 2020) from pinned GitHub mirrors",
                build_pig, manifest="pig_v1.2_files.json"))
register(Source("pig_hmm", "Nakamura et al. C++ HMM/evaluation code + published HMM outputs",
                build_pig_hmm, manifest="pig_hmm_files.json"))
register(Source("ramoneda", "Ramoneda et al. 2022 (ArGNN) official_split.json", build_ramoneda,
                manifest="ramoneda_files.json"))
register(Source("mutopia_src", "Mutopia Project LilyPond sources (ftp/ tree) at a pinned commit",
                build_mutopia_src, manifest="mutopia_src_files.json"))
register(Source("pianovam", "PianoVAM v1.2 fingering TSVs (automatic + manual GT), CC BY-NC-SA 4.0",
                build_pianovam, manifest="pianovam_files.json"))
register(Source("pydactyl", "pydactyl corpora: Beringer & Dunhill scales/arpeggios/broken chords (abcD)",
                build_pydactyl, manifest="pydactyl_files.json"))


# ---- PDMX (public-domain MuseScore MusicXML): only the fingered keyboard subset -----------
# Zenodo 10.5281/zenodo.15571083 (CC BY 4.0; every score was published on MuseScore as public
# domain / CC0). 1.9 GB download (md5 pinned by Zenodo); we stream the tarball and keep only
# .mxl files whose MusicXML contains <fingering> and a two-staff (keyboard) part.
PDMX_RECORD = "https://zenodo.org/api/records/15571083/files/{name}/content"
PDMX_MD5 = {"mxl.tar.gz": "49ffd75ecf5489c0be6d41182eb11ff7", "PDMX.csv": "30392ccf38bb63ce70e7afae70f9c88c"}


def _md5(path: Path) -> str:
    h = hashlib.md5()  # noqa: S324 - integrity check against Zenodo's published md5, not security
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def build_pdmx_fingered(out: Path) -> dict:
    import re as _re
    import tarfile

    src = {}
    for name, md5 in PDMX_MD5.items():
        dst = DOWNLOADS / "pdmx" / name
        if not (dst.exists() and _md5(dst) == md5):
            fetch(PDMX_RECORD.format(name=name), dst, timeout=600)
            if _md5(dst) != md5:
                raise RuntimeError(f"md5 mismatch for {name}")
        src[name] = dst
    keyboard_rx = _re.compile(rb"<part-name[^>]*>[^<]*(piano|keyboard|klavier|harpsichord|clavier|organ)", _re.I)
    rows = []
    n_total = n_fing = 0
    with tarfile.open(src["mxl.tar.gz"], mode="r|gz") as tf:
        for member in tf:
            if not member.isfile() or not member.name.endswith(".mxl"):
                continue
            n_total += 1
            data = tf.extractfile(member).read()
            try:
                with zipfile.ZipFile(io.BytesIO(data)) as z:
                    xml = b"".join(z.read(n) for n in z.namelist()
                                   if n.endswith((".xml", ".musicxml")) and not n.startswith("META-INF"))
            except zipfile.BadZipFile:
                continue
            nf = xml.count(b"<fingering")
            if not nf:
                continue
            n_fing += 1
            two_staves = b"<staves>2</staves>" in xml
            if not (two_staves or keyboard_rx.search(xml)):
                continue
            sp = safe_relpath(member.name)
            if sp is None:
                continue
            target = out.joinpath("mxl", *sp.parts[-3:])
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            rows.append({"path": "/".join(sp.parts[-3:]), "fingering_tags": nf, "note_tags": xml.count(b"<note"),
                         "two_staves": two_staves})
    with open(out / "fingered_keyboard_index.json", "w", encoding="utf-8") as f:
        json.dump(rows, f, indent=0)
    shutil.copyfile(src["PDMX.csv"], out / "PDMX.csv")
    return {"record": "https://doi.org/10.5281/zenodo.15571083", "license": "CC BY 4.0 (scores public domain/CC0)",
            "mxl_scanned": n_total, "mxl_with_fingering": n_fing, "fingered_keyboard_kept": len(rows)}


register(Source("pdmx_fingered", "PDMX (MuseScore public domain MusicXML): fingered keyboard subset (1.9 GB dl)",
                build_pdmx_fingered, default=False))

# --------------------------------------------------------------------------------------
# driver
# --------------------------------------------------------------------------------------

def is_complete(target: Path) -> bool:
    return (target / STAMP).exists()


def run_source(src: Source, force: bool = False, write_manifest: bool = False) -> None:
    target = DATA / src.name
    with FileLock(src.name):
        if is_complete(target) and not force:
            log(f"{src.name}: already present ({target}); skipping")
            return
        tmp = Path(tempfile.mkdtemp(prefix=f".{src.name}.partial-", dir=DATA))
        try:
            info = src.build(tmp)
            man_path = MANIFESTS / src.manifest if src.manifest else None
            if man_path is not None:
                if write_manifest or not man_path.exists():
                    MANIFESTS.mkdir(parents=True, exist_ok=True)
                    man_path.write_text(json.dumps({"source": src.name, "files": file_manifest(tmp)},
                                                   indent=1, sort_keys=True), encoding="utf-8")
                    log(f"{src.name}: wrote manifest {man_path}")
                else:
                    problems = verify_against_manifest(tmp, man_path)
                    if problems:
                        raise RuntimeError(f"{src.name}: content does not match manifest: {problems[:10]}")
                    log(f"{src.name}: verified against {man_path.name}")
            info.update({"source": src.name, "description": src.description,
                         "completed_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
            (tmp / STAMP).write_text(json.dumps(info, indent=1), encoding="utf-8")
            if target.exists():
                old = DATA / f".{src.name}.old-{os.getpid()}-{int(time.time())}"
                os.replace(target, old)
                shutil.rmtree(old, ignore_errors=True)
            os.replace(tmp, target)
            log(f"{src.name}: done -> {target}")
        except BaseException:
            shutil.rmtree(tmp, ignore_errors=True)
            raise


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("sources", nargs="*", help="sources to fetch (default: all default sources)")
    ap.add_argument("--list", action="store_true", help="list sources and exit")
    ap.add_argument("--force", action="store_true", help="re-download/re-extract even if complete")
    ap.add_argument("--verify", action="store_true", help="verify extracted dirs against manifests")
    ap.add_argument("--write-manifest", action="store_true", help=argparse.SUPPRESS)
    args = ap.parse_args(argv)

    if args.list:
        for s in SOURCES.values():
            state = "present" if is_complete(DATA / s.name) else "missing"
            print(f"{s.name:22s} {state:8s} {'(default)' if s.default else '(opt-in)':10s} {s.description}")
        return 0

    names = args.sources or [s.name for s in SOURCES.values() if s.default]
    unknown = [n for n in names if n not in SOURCES]
    if unknown:
        ap.error(f"unknown sources: {unknown}; use --list")

    if args.verify:
        bad = 0
        for n in names:
            s = SOURCES[n]
            if not s.manifest:
                continue
            probs = verify_against_manifest(DATA / n, MANIFESTS / s.manifest)
            print(f"{n}: {'OK' if not probs else f'{len(probs)} problems, e.g. {probs[:3]}'}")
            bad += bool(probs)
        return 1 if bad else 0

    DATA.mkdir(parents=True, exist_ok=True)
    failures = []
    for n in names:
        try:
            run_source(SOURCES[n], force=args.force, write_manifest=args.write_manifest)
        except Exception as e:  # keep going with other sources
            log(f"{n}: FAILED: {e}")
            failures.append(n)
    if failures:
        log(f"failed sources: {failures}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
