"""One training configuration end to end: load corpora (cached features), train with
validation-selected epoch, score every requested oracle, save a compact JSON result.

    research/.venv/Scripts/python.exe -I -m learn.experiments.run_config name=quick rho=1 C=0.05 epochs=3

Keys (defaults in DEFAULTS): train (comma list of corpora), validation, evals (comma list),
families (comma list), variant, C, eta, rho, epochs, seed, init, project, target,
skip_infeasible, average, out (results subdirectory).
"""
from __future__ import annotations

import sys
import time
from dataclasses import asdict

import numpy as np

from ._common import RESULTS, command_line, log, lower_priority, save_json

PLAN_FAMILIES = "rules,colour,trans,chord,lattice,timing"
DEFAULTS = {
    "name": "run",
    "train": "pig-train",
    "validation": "pig-validation",
    "evals": "",
    "families": PLAN_FAMILIES,
    "variant": "pa",
    "C": 0.05,
    "eta": 0.01,
    "rho": 1.0,
    "epochs": 12,
    "seed": 20261013,
    "init": "parncutt",
    "project": 1,
    "target": "latent",
    "skip_infeasible": 0,
    "average": 1,
    "out": "runs",
    "baseline": 1,
    "select": "best",
    "sample_weights": 1,
    "corpus_weights": "",  # e.g. "textbook=0.1,beringer=0.1": multiplies the sample weights of a corpus
}

_CORPORA: dict[str, list] = {}


def corpus(name: str) -> list:
    from learn.corpus import load_corpus_with_features

    if name not in _CORPORA:
        _CORPORA[name] = load_corpus_with_features(name, log)
    return _CORPORA[name]


def parse_args(argv: list[str]) -> dict:
    cfg = dict(DEFAULTS)
    for a in argv:
        if "=" not in a:
            raise SystemExit(f"expected key=value, got {a!r}")
        k, v = a.split("=", 1)
        if k not in cfg:
            raise SystemExit(f"unknown key {k!r}")
        d = cfg[k]
        cfg[k] = type(d)(v) if not isinstance(d, bool) else v not in ("0", "false", "False")
    return cfg


def run(cfg: dict, save: bool = True) -> dict:
    from learn.corpus import examples_of
    from learn.features import FeatureSet
    from learn.scoring import macro, score_pieces
    from learn.trainer import TrainOptions, train

    t_all = time.perf_counter()
    fs = FeatureSet([f.strip() for f in cfg["families"].split(",") if f.strip()])
    train_pieces = [p for name in cfg["train"].split(",") if name for p in corpus(name)]
    examples = examples_of(train_pieces)
    if not int(cfg.get("sample_weights", 1)):
        for ex in examples:
            ex.weight = 1.0
    if cfg.get("corpus_weights"):
        scale = {k: float(v) for k, v in (kv.split("=") for kv in cfg["corpus_weights"].split(","))}
        for ex in examples:
            if ex.corpus in scale:
                ex.weight = ex.weight * scale[ex.corpus]
    validation = corpus(cfg["validation"]) if cfg["validation"] else None
    evals = [e for e in cfg["evals"].split(",") if e]
    opts = TrainOptions(
        variant=cfg["variant"], C=float(cfg["C"]), eta=float(cfg["eta"]), rho=float(cfg["rho"]),
        epochs=int(cfg["epochs"]), seed=int(cfg["seed"]), init=cfg["init"], project=bool(int(cfg["project"])),
        target=cfg["target"], skip_infeasible=bool(int(cfg["skip_infeasible"])), average=bool(int(cfg["average"])),
        select=cfg.get("select", "best"),
    )
    n_notes = sum(ex.n for ex in examples)
    n_fingered = sum(ex.fingered() for ex in examples)
    log(f"{cfg['name']}: {len(examples)} hand examples, {n_notes} notes ({n_fingered} fingered), "
        f"{fs.n} features [{'+'.join(fs.families)}], {asdict(opts)}")
    result: dict = {"config": cfg, "options": asdict(opts), "features": fs.n, "families": list(fs.families),
                    "train_examples": len(examples), "train_notes": n_notes, "train_fingered": n_fingered,
                    "command": command_line()}
    if validation and cfg.get("baseline"):
        t0 = time.perf_counter()
        base = score_pieces(validation, fs.parncutt_weights(), fs)
        result["baseline_validation"] = macro(base)
        result["baseline_validation_per_piece"] = {r.piece: 100 * r.m_gen for r in base}
        log(f"Parncutt baseline on validation: {result['baseline_validation']} ({time.perf_counter() - t0:.1f} s)")
    res = train(examples, fs, opts, validation=validation, log=log)
    result["best_epoch"] = res.best_epoch
    result["epochs"] = [asdict(e) for e in res.epochs]
    result["train_seconds"] = res.seconds
    result["seconds_per_epoch"] = float(np.mean([e.seconds for e in res.epochs]))
    if validation:
        scored = score_pieces(validation, res.weights, fs)
        result["validation"] = macro(scored)
        result["validation_per_piece"] = {r.piece: 100 * r.m_gen for r in scored}
        result["validation_per_piece_all"] = {r.piece: r.as_dict() for r in scored}
    for name in evals:
        t0 = time.perf_counter()
        pieces = corpus(name)
        scored = score_pieces(pieces, res.weights, fs)
        result.setdefault("evals", {})[name] = macro(scored)
        result.setdefault("evals_per_piece", {})[name] = {r.piece: 100 * r.m_gen for r in scored}
        if cfg.get("baseline"):
            base = score_pieces(pieces, fs.parncutt_weights(), fs)
            result.setdefault("baseline_evals", {})[name] = macro(base)
            result.setdefault("baseline_evals_per_piece", {})[name] = {r.piece: 100 * r.m_gen for r in base}
        log(f"{name}: {result['evals'][name]} ({time.perf_counter() - t0:.1f} s)")
    result["weights"] = fs.weights_to_dict(res.weights)
    result["total_seconds"] = time.perf_counter() - t_all
    if save:
        path = save_json(f"{cfg['out']}/{cfg['name']}.json", result)
        log(f"saved {path}")
    return result


def main() -> int:
    lower_priority()
    cfg = parse_args(sys.argv[1:])
    run(cfg)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
