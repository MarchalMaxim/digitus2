"""Run a named list of configurations sequentially, skipping finished ones (resumable).

    research/.venv/Scripts/python.exe -I -m learn.experiments.grid <grid-name> [worker-index n-workers]

Grids: ``sweep`` (experiment a), ``variants`` (a, trainer variants at the best setting),
``ablation`` (b), ``partial`` (c), ``open`` (d). Two workers split a grid round-robin so the
machine never runs more than two training processes.
"""
from __future__ import annotations

import sys
from pathlib import Path

from ._common import RESULTS, log, lower_priority
from .run_config import DEFAULTS, PLAN_FAMILIES, run

FAMILY_CHAIN = ["rules", "colour", "trans", "chord", "lattice,timing", "rest", "fitts", "geo", "trColour", "latticeBins"]


def cfg(name: str, out: str, **kw) -> dict:
    c = dict(DEFAULTS)
    c.update(name=name, out=out, **kw)
    return c


def grid_sweep() -> list[dict]:
    out = []
    for rho in (0.0, 0.5, 1.0, 2.0):
        for C in (0.01, 0.05, 0.2, 1.0):
            out.append(cfg(f"pa_rho{rho}_C{C}", "sweep", rho=rho, C=C, epochs=20))
    return out


def best_sweep() -> dict:
    """The (rho, C) with the best validation m_gen among finished sweep runs (fallback: plan defaults)."""
    import json

    best, best_cfg = -1.0, {"rho": 1.0, "C": 0.05}
    for p in sorted((RESULTS / "sweep").glob("pa_rho*_C*.json")):
        r = json.loads(p.read_text(encoding="utf-8"))
        g = r["validation"]["m_gen"]
        if g > best:
            best, best_cfg = g, {"rho": r["options"]["rho"], "C": r["options"]["C"]}
    return best_cfg


def grid_variants() -> list[dict]:
    b = best_sweep()
    out = [
        cfg("pa_noproject", "variants", project=0, epochs=20, **b),
        cfg("pa_first", "variants", target="first", epochs=20, **b),
        cfg("pa_zeros", "variants", init="zeros", epochs=20, **b),
        cfg("pa_skip_infeasible", "variants", skip_infeasible=1, epochs=20, **b),
        cfg("pa_noaverage", "variants", average=0, epochs=20, **b),
        cfg("pa_seed1", "variants", seed=1, epochs=20, **b),
    ]
    for eta in (0.005, 0.02, 0.1):
        out.append(cfg(f"perceptron_eta{eta}", "variants", variant="perceptron", eta=eta, rho=b["rho"], epochs=20))
    return out


def grid_ablation() -> list[dict]:
    b = best_sweep()
    out = []
    fams: list[str] = []
    for k, fam in enumerate(FAMILY_CHAIN):
        fams.append(fam)
        out.append(cfg(f"abl{k:02d}_{fam.replace(',', '+')}", "ablation", families=",".join(fams), epochs=20, **b))
    return out


def grid_partial() -> list[dict]:
    b = best_sweep()
    ev = "mutopia-test"
    return [
        cfg("pig_only", "partial", train="pig-train", evals=ev, epochs=12, **b),
        cfg("pig_plus_mutopia", "partial", train="pig-train,mutopia-train", evals=ev, epochs=12, **b),
        cfg("mutopia_only", "partial", train="mutopia-train", evals=ev, epochs=12, **b),
    ]


def grid_open() -> list[dict]:
    b = best_sweep()
    ev = "mutopia-test"
    return [
        cfg("open_textbook_beringer", "open", train="textbook,beringer", evals=ev, epochs=12, **b),
        cfg("open_all", "open", train="textbook,beringer,mutopia-train", evals=ev, epochs=12, **b),
        cfg("open_all_zeros", "open", train="textbook,beringer,mutopia-train", evals=ev, epochs=12, init="zeros", **b),
        cfg("open_all_unweighted", "open", train="textbook,beringer,mutopia-train", evals=ev, epochs=12, sample_weights=0, **b),
    ]


def grid_cv() -> list[dict]:
    """5-fold cross-validation over all 120 PIG train pieces, fixed 3 epochs (chosen on the sweep),
    last-epoch averaged weights: tighter paired comparisons than the 20 validation pieces give."""
    b = best_sweep()
    out = []
    for k in range(5):
        tr, va = f"pig-cv{k}-train", f"pig-cv{k}-val"
        base = dict(train=tr, validation=va, epochs=3, select="last")
        out.append(cfg(f"cv{k}_plan", "cv", **base, **b))
        out.append(cfg(f"cv{k}_rho0", "cv", **base, rho=0.0, C=b["C"]))
        out.append(cfg(f"cv{k}_rules", "cv", families="rules", **base, **b))
        out.append(cfg(f"cv{k}_rules_colour_trans", "cv", families="rules,colour,trans", **base, **b))
        out.append(cfg(f"cv{k}_full", "cv", families=",".join(FAMILY_CHAIN), **base, **b))
        out.append(cfg(f"cv{k}_plan_first", "cv", target="first", **base, **b))
        out.append(cfg(f"cv{k}_plan_noproject", "cv", project=0, **base, **b))
    return out


def grid_seeds() -> list[dict]:
    """Seed variance of the best PA setting on the 20 validation pieces (best epoch of 20)."""
    b = best_sweep()
    return [cfg(f"seed{s}", "seeds", seed=s, epochs=20, **b) for s in (1, 2, 3, 4, 5)]


def grid_pigconfig() -> list[dict]:
    """The plan's research-only `pig` configuration (PIG train + textbook + Beringer) and everything."""
    b = best_sweep()
    ev = "mutopia-test"
    return [
        cfg("pig_textbook_beringer", "pigconfig", train="pig-train,textbook,beringer", evals=ev, epochs=12, **b),
        cfg("everything", "pigconfig", train="pig-train,textbook,beringer,mutopia-train", evals=ev, epochs=12, **b),
        cfg("pig_textbook_beringer_20ep", "pigconfig", train="pig-train,textbook,beringer", evals=ev, epochs=20, **b),
        cfg("pig_textbook_beringer_w0.1", "pigconfig", train="pig-train,textbook,beringer", evals=ev, epochs=20,
            corpus_weights="textbook=0.2,beringer=0.2", **b),
        cfg("pig_textbook_beringer_w0.02", "pigconfig", train="pig-train,textbook,beringer", evals=ev, epochs=20,
            corpus_weights="textbook=0.04,beringer=0.04", **b),
        cfg("pig_mutopia_w0.1", "pigconfig", train="pig-train,mutopia-train", evals=ev, epochs=12,
            corpus_weights="mutopia=0.1", **b),
    ]


GRIDS = {"sweep": grid_sweep, "cv": grid_cv, "seeds": grid_seeds, "pigconfig": grid_pigconfig, "variants": grid_variants, "ablation": grid_ablation, "partial": grid_partial,
         "open": grid_open}


def main() -> int:
    lower_priority()
    name = sys.argv[1]
    worker = int(sys.argv[2]) if len(sys.argv) > 2 else 0
    workers = int(sys.argv[3]) if len(sys.argv) > 3 else 1
    configs = GRIDS[name]()
    for k, c in enumerate(configs):
        if k % workers != worker:
            continue
        path = RESULTS / c["out"] / f"{c['name']}.json"
        if path.exists():
            log(f"skip {c['name']} (done)")
            continue
        log(f"=== {c['name']} ({k + 1}/{len(configs)})")
        run(c)
    log("grid done")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
