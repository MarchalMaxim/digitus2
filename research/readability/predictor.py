"""An interpretable predictor of where an editor prints a digit.

Rows are notes of the verified Mutopia parts (``source == "mutopia"`` in the feature table); the
eight library pieces are held out for a density check. Inputs are score-only features from
:mod:`readability.features` (never the printed-derived ones, which leak the target).

Models:

1. logistic regression on standardised inputs (``C=1.0``, ``max_iter=1000``, no class weights);
2. a depth-3 decision tree (``min_samples_leaf=200``);
3. hand-coded rules: the verification spec's reduction list (print on the first note of a hand,
   after a rest of at least a beat, on leaps of at least 5 semitones, on chord outer voices and at
   the start of a stepwise run) and two variants.

Validation: 5-fold ``GroupKFold`` grouped by part (part ids permuted with
``numpy.random.default_rng(0)`` before sklearn's size-balanced assignment). Reported overall and
per level group: ROC AUC, average precision, precision/recall/F1 at 0.5, and precision/recall at
the density-matched threshold (the score quantile that makes the predicted density equal the
group's editorial density on the training folds).

Usage (from ``research/``)::

    OMP_NUM_THREADS=2 .venv-readability/Scripts/python.exe -X utf8 -m readability.predictor
"""
from __future__ import annotations

import csv
import json
import re
import sys
import time
import unicodedata
from pathlib import Path

import numpy as np

from readability.features import CHORD_POS, LEAP_BINS, RUN_POS

RESEARCH = Path(__file__).resolve().parents[1]
FEATURE_TABLE = RESEARCH / "data" / "readability" / "features.csv"
RESULTS_DIR = Path(__file__).resolve().parent / "results"
LEVEL_GROUPS = ("teaching", "concert", "other")
N_SPLITS = 5
SEED = 0
COMMAND = "cd research && OMP_NUM_THREADS=2 .venv-readability/Scripts/python.exe -X utf8 -m readability.predictor"

# (input column, clip upper bound or None); None values become 0
NUMERIC = [
    ("first_of_hand", None), ("first_of_piece", None), ("after_rest", None), ("after_rest_beat", None),
    ("gap_beats", 8.0), ("after_long_note", None), ("prev_dur_beats", 8.0), ("leap_abs", 24.0),
]
NUMERIC_2 = [("direction", None), ("black", None), ("prev_black", None), ("is_chord", None), ("chord_outer", None)]
NUMERIC_3 = [("chord_size", 6.0), ("repeated", None), ("in_run", None)]
NUMERIC_4 = [("run_len", 16.0), ("notes_per_sec", 16.0), ("dur_beats", 8.0), ("downbeat", None),
             ("on_beat", None)]
NUMERIC_5 = [("grace", None), ("rel_pos", None)]

FEATURE_NAMES: list[str] = (
    [c for c, _ in NUMERIC] + [f"leap_bin={b}" for b in LEAP_BINS] + [c for c, _ in NUMERIC_2]
    + [f"chord_pos={p}" for p in CHORD_POS] + [c for c, _ in NUMERIC_3] + [f"run_pos={p}" for p in RUN_POS]
    + [c for c, _ in NUMERIC_4] + ["hand_R"] + [c for c, _ in NUMERIC_5]
)

LEAKY = ("prev_printed", "prev_finger", "anchor", "prev_anchor", "anchor_delta", "crossing",
         "since_printed", "until_printed", "finger", "substitution")


# ---------------------------------------------------------------------------------------
# Feature matrix
# ---------------------------------------------------------------------------------------

def _num(v, hi: float | None) -> float:
    x = 0.0 if v is None else float(v)
    if hi is not None:
        x = min(max(x, 0.0), hi)
    return x


def row_vector(r: dict) -> list[float]:
    out = [_num(r.get(c), hi) for c, hi in NUMERIC]
    out += [1.0 if r.get("leap_bin") == b else 0.0 for b in LEAP_BINS]
    out += [_num(r.get(c), hi) for c, hi in NUMERIC_2]
    out += [1.0 if r.get("chord_pos") == p else 0.0 for p in CHORD_POS]
    out += [_num(r.get(c), hi) for c, hi in NUMERIC_3]
    out += [1.0 if r.get("run_pos") == p else 0.0 for p in RUN_POS]
    out += [_num(r.get(c), hi) for c, hi in NUMERIC_4]
    out.append(1.0 if r.get("hand") == "R" else 0.0)
    out += [_num(r.get(c), hi) for c, hi in NUMERIC_5]
    return out


def build_matrix(rows: list[dict]) -> tuple[np.ndarray, list[str]]:
    """Design matrix (float64) and its column names; see ``FEATURE_NAMES``."""
    X = np.array([row_vector(r) for r in rows], dtype=np.float64).reshape(len(rows), len(FEATURE_NAMES))
    return X, list(FEATURE_NAMES)


def target(rows: list[dict]) -> np.ndarray:
    return np.array([int(r["printed"]) for r in rows], dtype=np.int64)


# ---------------------------------------------------------------------------------------
# Rule predictors
# ---------------------------------------------------------------------------------------

RULE_CLAUSES = {
    "first_of_hand": lambda r: bool(r.get("first_of_hand")),
    "after_rest_beat": lambda r: bool(r.get("after_rest_beat")),
    "leap_ge_5": lambda r: (r.get("leap_abs") or 0) >= 5,
    "chord_outer": lambda r: bool(r.get("chord_outer")),
    "run_start": lambda r: r.get("run_pos") == "start",
    "after_long_note": lambda r: bool(r.get("after_long_note")),
}
RULES = {
    # the verification spec's reduction list, in score-only terms
    "rule_spec": ("first_of_hand", "after_rest_beat", "leap_ge_5", "chord_outer", "run_start"),
    "rule_spec_plus_after_long_note": ("first_of_hand", "after_rest_beat", "leap_ge_5", "chord_outer",
                                       "run_start", "after_long_note"),
    "rule_spec_minus_chord_outer": ("first_of_hand", "after_rest_beat", "leap_ge_5", "run_start"),
}


def rule_predict(rows: list[dict], rule: str = "rule_spec") -> np.ndarray:
    clauses = [RULE_CLAUSES[c] for c in RULES[rule]]
    return np.array([int(any(f(r) for f in clauses)) for r in rows], dtype=np.int64)


# ---------------------------------------------------------------------------------------
# Thresholds, folds, metrics
# ---------------------------------------------------------------------------------------

def density_threshold(scores, density: float) -> float:
    """Threshold ``t`` such that ``mean(scores >= t)`` is as close as possible to ``density``.

    Ties are kept together, so with few distinct scores (a tree) the achieved density may differ;
    of the two thresholds bracketing the target count, the closer one wins (the lower on a tie).
    Returns ``inf`` when nothing should be predicted.
    """
    s = np.sort(np.asarray(scores, dtype=np.float64))[::-1]
    n = len(s)
    k = int(round(density * n))
    if n == 0 or k <= 0:
        return float("inf")
    if k >= n:
        return float(s[-1])
    t1 = float(s[k - 1])
    c1 = int(np.sum(s >= t1))
    higher = s[s > t1]
    if len(higher) == 0:
        return t1
    t2 = float(higher.min())
    c2 = int(np.sum(s >= t2))
    return t1 if abs(c1 - k) <= abs(c2 - k) else t2


def make_folds(part_ids: list[str], n_splits: int = N_SPLITS, seed: int = SEED) -> np.ndarray:
    """Fold index per row: part ids permuted with ``default_rng(seed)``, then sklearn ``GroupKFold``."""
    from sklearn.model_selection import GroupKFold

    uniq = sorted(set(part_ids))
    perm = np.random.default_rng(seed).permutation(len(uniq))
    rank = {uniq[p]: k for k, p in enumerate(perm)}
    groups = np.array([rank[p] for p in part_ids])
    fold = np.full(len(part_ids), -1, dtype=np.int64)
    for f, (_, te) in enumerate(GroupKFold(n_splits=n_splits).split(np.zeros(len(groups)), groups=groups)):
        fold[te] = f
    return fold


def make_logistic():
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler

    # n_jobs is not passed: sklearn 1.8 ignores it for LogisticRegression (FutureWarning); load is capped
    # through OMP_NUM_THREADS instead
    return make_pipeline(StandardScaler(), LogisticRegression(C=1.0, max_iter=1000, class_weight=None))


def make_tree():
    from sklearn.tree import DecisionTreeClassifier

    return DecisionTreeClassifier(max_depth=3, min_samples_leaf=200, random_state=0)


def _r(x) -> float | None:
    return None if x is None or (isinstance(x, float) and not np.isfinite(x)) else round(float(x), 4)


def metrics(y: np.ndarray, score: np.ndarray, pred_dm: np.ndarray | None = None) -> dict:
    """AUC, AP, P/R/F1 at 0.5 and (if given) P/R at the density-matched predictions."""
    from sklearn.metrics import average_precision_score, roc_auc_score

    y = np.asarray(y)
    score = np.asarray(score, dtype=np.float64)
    out: dict = {"n": int(len(y)), "n_printed": int(y.sum()), "density": _r(y.mean()) if len(y) else None}
    both = len(y) > 0 and 0 < y.sum() < len(y)
    out["auc"] = _r(roc_auc_score(y, score)) if both else None
    out["ap"] = _r(average_precision_score(y, score)) if both else None

    def prf(pred):
        tp = int(np.sum((pred == 1) & (y == 1)))
        npred = int(pred.sum())
        p = tp / npred if npred else None
        rc = tp / int(y.sum()) if y.sum() else None
        f = 2 * p * rc / (p + rc) if p and rc else (0.0 if p is not None and rc is not None else None)
        return {"precision": _r(p), "recall": _r(rc), "f1": _r(f), "pred_density": _r(npred / len(y)) if len(y) else None}

    out["at_0_5"] = prf((score >= 0.5).astype(np.int64))
    if pred_dm is not None:
        out["density_matched"] = prf(np.asarray(pred_dm, dtype=np.int64))
    return out


def group_masks(rows: list[dict]) -> dict[str, np.ndarray]:
    lg = np.array([r["level_group"] for r in rows])
    out = {"overall": np.ones(len(rows), dtype=bool)}
    for g in LEVEL_GROUPS:
        out[g] = lg == g
    return out


def cross_validate(make_model, X: np.ndarray, y: np.ndarray, fold: np.ndarray, masks: dict[str, np.ndarray],
                   subset: np.ndarray | None = None) -> dict:
    """Out-of-fold scores and density-matched predictions.

    ``subset`` restricts training and testing to those rows (teaching-only model). Thresholds per
    group are computed on the in-sample training scores of that group; ``pred_dm_overall`` uses the
    overall threshold, ``pred_dm_group`` the row's own group threshold.
    """
    n = len(y)
    use = np.ones(n, dtype=bool) if subset is None else subset
    score = np.full(n, np.nan)
    pred_overall = np.zeros(n, dtype=np.int64)
    pred_group = np.zeros(n, dtype=np.int64)
    thresholds = []
    for f in range(int(fold.max()) + 1):
        tr = (fold != f) & use
        te = (fold == f) & use
        m = make_model()
        m.fit(X[tr], y[tr])
        s_tr = m.predict_proba(X[tr])[:, 1]
        s_te = m.predict_proba(X[te])[:, 1]
        score[te] = s_te
        thr = {}
        for g, mask in masks.items():
            gm_tr = mask[tr]
            if gm_tr.sum() == 0:
                continue
            thr[g] = density_threshold(s_tr[gm_tr], y[tr][gm_tr].mean())
        thresholds.append({g: _r(t) for g, t in thr.items()})
        te_idx = np.where(te)[0]
        pred_overall[te_idx] = (s_te >= thr["overall"]).astype(np.int64)
        for g in LEVEL_GROUPS:
            if g in thr:
                sel = masks[g][te_idx]
                pred_group[te_idx[sel]] = (s_te[sel] >= thr[g]).astype(np.int64)
    return {"score": score, "pred_overall": pred_overall, "pred_group": pred_group, "thresholds": thresholds,
            "use": use}


def report_cv(cv: dict, y: np.ndarray, masks: dict[str, np.ndarray], groups=("overall",) + LEVEL_GROUPS) -> dict:
    out = {}
    for g in groups:
        m = masks[g] & cv["use"]
        if m.sum() == 0:
            continue
        pred = cv["pred_overall"] if g == "overall" else cv["pred_group"]
        out[g] = metrics(y[m], cv["score"][m], pred[m])
    out["fold_thresholds"] = cv["thresholds"]
    return out


# ---------------------------------------------------------------------------------------
# Tree description
# ---------------------------------------------------------------------------------------

def tree_leaves(tree, names: list[str], X: np.ndarray, y: np.ndarray) -> list[dict]:
    t = tree.tree_
    leaf_of = tree.apply(X)
    paths: dict[int, list[str]] = {}

    def walk(node: int, conds: list[str]) -> None:
        if t.children_left[node] == t.children_right[node]:
            paths[node] = conds
            return
        nm, th = names[t.feature[node]], t.threshold[node]
        walk(t.children_left[node], conds + [f"{nm} <= {th:.3f}"])
        walk(t.children_right[node], conds + [f"{nm} > {th:.3f}"])

    walk(0, [])
    out = []
    for node, conds in paths.items():
        m = leaf_of == node
        out.append({"leaf": int(node), "path": " AND ".join(conds), "n": int(m.sum()),
                    "n_printed": int(y[m].sum()), "print_rate": _r(y[m].mean()) if m.sum() else None})
    out.sort(key=lambda d: -(d["print_rate"] or 0))
    return out


# ---------------------------------------------------------------------------------------
# Library overlap
# ---------------------------------------------------------------------------------------

def _fold(s: str) -> str:
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii").lower()


def _lib_matchers():
    def m(composer_prefix, test):
        return lambda comp, text: _fold(comp).startswith(composer_prefix) and test(text)

    return {
        "burgmuller-op100-no1-la-candeur": m("burgmuller", lambda t: "candeur" in t),
        "burgmuller-op100-no2-arabesque": m("burgmuller", lambda t: "arabesque" in t),
        "burgmuller-op100-no3-pastorale": m("burgmuller", lambda t: "pastorale" in t),
        "burgmuller-op100-no5-innocence": m("burgmuller", lambda t: "innocence" in t),
        "schumann-op68-no1-melody": m("schumann", lambda t: ("melodie" in t or "melody" in t) and "68" in t),
        "mozart-sonata-k545-mvt1": m("mozart", lambda t: "545" in t and ("first" in t or "1st" in t
                                                                         or re.search(r"\b1\b", t) is not None)),
        "beethoven-moonlight-sonata-mvt1": m("beethoven", lambda t: any(w in t for w in (
            "moonlight", "mondschein", "quasi una fantasia")) and any(w in t for w in ("1st", "first", "adagio"))),
        "chopin-waltz-op69-no2": m("chopin", lambda t: re.search(r"\b69\b", t) is not None
                                   and re.search(r"\bno\.?\s*2\b", t) is not None),
    }


def overlapping_mutopia_parts(manifest: list[dict], part_ids: set[str]) -> dict[str, list[str]]:
    """Library slug -> Mutopia part ids (among ``part_ids``) that hold the same piece."""
    out: dict[str, list[str]] = {}
    for slug, test in _lib_matchers().items():
        hits = []
        for row in manifest:
            if row["piece_id"] not in part_ids:
                continue
            text = _fold(f"{row['title']} | {row.get('opus', '')}")
            if test(row["composer"], text):
                hits.append(row["piece_id"])
        out[slug] = sorted(hits)
    return out


# ---------------------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------------------

def _fold_sizes(rows, y, fold) -> list[dict]:
    out = []
    lg = np.array([r["level_group"] for r in rows])
    pid = np.array([r["part_id"] for r in rows])
    for f in range(int(fold.max()) + 1):
        m = fold == f
        d = {"fold": f, "rows": int(m.sum()), "parts": int(len(set(pid[m]))), "printed": int(y[m].sum())}
        for g in LEVEL_GROUPS:
            d[f"rows_{g}"] = int((m & (lg == g)).sum())
            d[f"parts_{g}"] = int(len(set(pid[m & (lg == g)])))
        out.append(d)
    return out


def _fmt_m(m: dict | None) -> str:
    if m is None:
        return "-"
    dm = m.get("density_matched")
    s = (f"AUC {m['auc']} AP {m['ap']} | @0.5 P {m['at_0_5']['precision']} R {m['at_0_5']['recall']} "
         f"F1 {m['at_0_5']['f1']} dens {m['at_0_5']['pred_density']}")
    if dm:
        s += f" | @dm P {dm['precision']} R {dm['recall']} dens {dm['pred_density']}"
    return s + f" | editor dens {m['density']} n {m['n']}"


def main(argv: list[str] | None = None) -> int:
    from sklearn.tree import export_text

    from readability.corpus import load_manifest
    from readability.features import read_feature_table

    t0 = time.time()
    all_rows = read_feature_table(FEATURE_TABLE)
    rows = [r for r in all_rows if r["source"] == "mutopia"]
    lib_rows = [r for r in all_rows if r["source"] == "library"]
    X, names = build_matrix(rows)
    y = target(rows)
    masks = group_masks(rows)
    part_ids = [r["part_id"] for r in rows]
    fold = make_folds(part_ids)
    t_load = time.time() - t0
    print(f"{len(rows)} Mutopia rows ({len(set(part_ids))} parts), {len(lib_rows)} library rows, "
          f"{X.shape[1]} features; loaded in {t_load:.1f} s")

    result: dict = {
        "command": COMMAND,
        "feature_table": str(FEATURE_TABLE.relative_to(RESEARCH.parent)).replace("\\", "/"),
        "features": names,
        "feature_preprocessing": {
            "clipped": {c: [0, hi] for c, hi in NUMERIC + NUMERIC_2 + NUMERIC_3 + NUMERIC_4 + NUMERIC_5 if hi},
            "none_to_zero": "every numeric input (gap_beats, prev_dur_beats, leap_abs, prev_black, ...)",
            "one_hot": {"leap_bin": list(LEAP_BINS), "chord_pos": list(CHORD_POS), "run_pos": list(RUN_POS)},
            "hand_R": "1 = right hand",
            "excluded_leaky_columns": list(LEAKY),
            "collinearity": "exact linear dependencies exist by construction (is_chord = 1 - chord_pos=single, "
                            "chord_outer = chord_pos=bottom + chord_pos=top, in_run = 1 - run_pos=none, "
                            "leap_bin=none = first_of_hand, repeated = leap_bin=repeat); the L2 penalty splits "
                            "such effects among the columns, so read a group's coefficients together",
        },
        "validation": {"scheme": f"{N_SPLITS}-fold GroupKFold by part_id; part ids permuted with "
                                 f"numpy.random.default_rng({SEED}) and encoded as their permuted rank before "
                                 "sklearn's size-balanced assignment",
                       "density_matched_threshold": "per fold, the threshold on the training-fold in-sample "
                                                    "scores of the group (overall for 'overall') that makes "
                                                    "the predicted density equal the group's editorial density "
                                                    "on the training folds; applied to the test fold",
                       "fold_sizes": _fold_sizes(rows, y, fold)},
        "model_params": {
            "logistic": "make_pipeline(StandardScaler(), LogisticRegression(C=1.0, max_iter=1000, class_weight=None)); "
                        "n_jobs not passed because scikit-learn 1.8 ignores it for LogisticRegression (FutureWarning); "
                        "threads capped with OMP_NUM_THREADS=2",
            "tree": "DecisionTreeClassifier(max_depth=3, min_samples_leaf=200, random_state=0)",
            "rules": {k: list(v) for k, v in RULES.items()},
            "sklearn_version": __import__("sklearn").__version__, "numpy_version": np.__version__,
        },
        "n_rows": len(rows), "n_parts": len(set(part_ids)), "n_printed": int(y.sum()),
        "models": {}, "teaching_only": {},
    }

    # --- cross-validated models ---------------------------------------------------------
    t1 = time.time()
    cv_lr = cross_validate(make_logistic, X, y, fold, masks)
    cv_tree = cross_validate(make_tree, X, y, fold, masks)
    result["models"]["logistic"] = report_cv(cv_lr, y, masks)
    result["models"]["tree_depth3"] = report_cv(cv_tree, y, masks)
    for rule in RULES:
        pred = rule_predict(rows, rule)
        result["models"][rule] = {g: metrics(y[m], pred[m]) for g, m in masks.items()}
        result["models"][rule]["note"] = "binary predictor, no fitting; AUC of a 0/1 score = (TPR + TNR) / 2"
    # clause-level view of the spec rule
    clauses = {}
    for c in RULE_CLAUSES:
        fires = np.array([int(RULE_CLAUSES[c](r)) for r in rows])
        clauses[c] = {"fires_share": _r(fires.mean()), "precision": _r(y[fires == 1].mean()) if fires.sum() else None,
                      "recall": _r(fires[y == 1].mean())}
    result["rule_clauses"] = clauses
    # the same clauses inside strata (hand x single note / chord, and level group for RH single notes),
    # because chord notes and the left hand dominate the pooled numbers
    hand_r = np.array([r["hand"] == "R" for r in rows])
    single = np.array([r["chord_size"] == 1 for r in rows])
    strata = {"RH_single": hand_r & single, "RH_chord": hand_r & ~single,
              "LH_single": ~hand_r & single, "LH_chord": ~hand_r & ~single}
    for g in LEVEL_GROUPS:
        strata[f"RH_single_{g}"] = hand_r & single & masks[g]
    fires_all = {c: np.array([int(RULE_CLAUSES[c](r)) for r in rows]) for c in RULE_CLAUSES}
    spec_pred = rule_predict(rows, "rule_spec")
    by_stratum = {}
    for sname, sm in strata.items():
        d = {"n": int(sm.sum()), "editor_density": _r(y[sm].mean()),
             "rule_spec": {"pred_density": _r(spec_pred[sm].mean()),
                           "precision": _r(y[sm][spec_pred[sm] == 1].mean()) if spec_pred[sm].sum() else None,
                           "recall": _r(spec_pred[sm][y[sm] == 1].mean()) if y[sm].sum() else None}}
        for c, fa in fires_all.items():
            fs = fa[sm]
            d[c] = {"fires_share": _r(fs.mean()),
                    "print_rate_when_fires": _r(y[sm][fs == 1].mean()) if fs.sum() else None,
                    "print_rate_otherwise": _r(y[sm][fs == 0].mean()) if (fs == 0).sum() else None}
        by_stratum[sname] = d
    result["rule_clauses_by_stratum"] = by_stratum

    teach = masks["teaching"]
    cv_lr_t = cross_validate(make_logistic, X, y, fold, masks, subset=teach)
    cv_tree_t = cross_validate(make_tree, X, y, fold, masks, subset=teach)
    result["teaching_only"] = {
        "logistic": report_cv(cv_lr_t, y, masks, groups=("teaching",)),
        "tree_depth3": report_cv(cv_tree_t, y, masks, groups=("teaching",)),
        "global_logistic_on_teaching": result["models"]["logistic"]["teaching"],
        "global_tree_on_teaching": result["models"]["tree_depth3"]["teaching"],
        "note": "teaching-only models are trained and tested on teaching rows with the same part folds; "
                "density-matched thresholds use the teaching density of the training folds for both",
    }
    t_cv = time.time() - t1

    # --- full fits: coefficients and tree ------------------------------------------------
    lr_all = make_logistic().fit(X, y)
    lr_teach = make_logistic().fit(X[teach], y[teach])
    tree_all = make_tree().fit(X, y)
    scaler, lr = lr_all[0], lr_all[-1]
    coef = lr.coef_[0]
    coef_t = lr_teach[-1].coef_[0]
    order = np.argsort(-np.abs(coef))
    coef_rows = [{"rank": k + 1, "feature": names[i], "coef_std": round(float(coef[i]), 4),
                  "odds_ratio_per_sd": round(float(np.exp(coef[i])), 4),
                  "coef_std_teaching_model": round(float(coef_t[i]), 4),
                  "mean": round(float(scaler.mean_[i]), 4), "std": round(float(scaler.scale_[i]), 4),
                  "print_rate_when_nonzero": _r(y[X[:, i] != 0].mean()) if (X[:, i] != 0).any() else None,
                  "share_nonzero": _r((X[:, i] != 0).mean())}
                 for k, i in enumerate(order)]
    result["logistic_coefficients"] = {"intercept": round(float(lr.intercept_[0]), 4),
                                       "intercept_teaching_model": round(float(lr_teach[-1].intercept_[0]), 4),
                                       "sorted_by_abs": coef_rows}
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    with open(RESULTS_DIR / "predictor_coefficients.csv", "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(coef_rows[0].keys()))
        w.writeheader()
        w.writerows(coef_rows)
        w.writerow({"rank": "", "feature": "(intercept)", "coef_std": round(float(lr.intercept_[0]), 4),
                    "coef_std_teaching_model": round(float(lr_teach[-1].intercept_[0]), 4)})

    tree_txt = export_text(tree_all, feature_names=names, decimals=3, show_weights=True)
    leaves = tree_leaves(tree_all, names, X, y)
    result["tree"] = {"text": tree_txt, "leaves": leaves,
                      "fit": "all Mutopia rows; class weights shown by export_text are [unprinted, printed]"}
    with open(RESULTS_DIR / "predictor_tree.txt", "w", encoding="utf-8") as f:
        f.write("DecisionTreeClassifier(max_depth=3, min_samples_leaf=200, random_state=0), "
                f"fitted on all {len(rows)} Mutopia rows; weights = [unprinted, printed]\n\n")
        f.write(tree_txt)
        f.write("\nLeaves (sorted by print rate):\n")
        f.write(f"{'leaf':>5} {'n':>7} {'printed':>8} {'rate':>6}  path\n")
        for lf in leaves:
            f.write(f"{lf['leaf']:5d} {lf['n']:7d} {lf['n_printed']:8d} {lf['print_rate']:6.3f}  {lf['path']}\n")

    # --- library check -------------------------------------------------------------------
    manifest = load_manifest()
    overlap = overlapping_mutopia_parts(manifest, set(part_ids))
    excluded = sorted({p for v in overlap.values() for p in v})
    keep = np.array([p not in set(excluded) for p in part_ids])
    print("Mutopia parts excluded for the clean library check:")
    for slug, ids in overlap.items():
        print(f"  {slug}: {', '.join(ids) if ids else '(none found)'}")

    def fit_pair(train_mask):
        g = make_logistic().fit(X[train_mask], y[train_mask])
        tm = train_mask & teach
        tmod = make_logistic().fit(X[tm], y[tm])
        teach_density = y[tm].mean()
        thr_g = density_threshold(g.predict_proba(X[tm])[:, 1], teach_density)
        thr_t = density_threshold(tmod.predict_proba(X[tm])[:, 1], teach_density)
        return (g, thr_g), (tmod, thr_t)

    g_all, t_all = lr_all, lr_teach
    teach_density = float(y[teach].mean())
    thr_g_all = density_threshold(lr_all.predict_proba(X[teach])[:, 1], teach_density)
    thr_t_all = density_threshold(lr_teach.predict_proba(X[teach])[:, 1], teach_density)
    (g_ex, thr_g_ex), (t_ex, thr_t_ex) = fit_pair(keep)
    lib_models = {
        "logistic_global": (g_all, thr_g_all), "logistic_teaching": (t_all, thr_t_all),
        "logistic_global_excl_overlap": (g_ex, thr_g_ex), "logistic_teaching_excl_overlap": (t_ex, thr_t_ex),
    }
    Xl, _ = build_matrix(lib_rows)
    yl = target(lib_rows)
    lib_pid = np.array([r["part_id"] for r in lib_rows])
    lib_level = {r["part_id"]: r["level"] for r in lib_rows}
    lib_scores = {k: m.predict_proba(Xl)[:, 1] for k, (m, _) in lib_models.items()}
    rule_l = rule_predict(lib_rows, "rule_spec")
    lib_out = []
    for pid in sorted(set(lib_pid)) + ["ALL"]:
        m = np.ones(len(lib_pid), dtype=bool) if pid == "ALL" else lib_pid == pid
        base = {"piece": pid, "level": lib_level.get(pid), "n_notes": int(m.sum()), "n_printed": int(yl[m].sum()),
                "editor_density": _r(yl[m].mean())}
        for k, (_, thr) in lib_models.items():
            s = lib_scores[k][m]
            mm = metrics(yl[m], s)
            lib_out.append({**base, "model": k, "mean_prob": _r(s.mean()),
                            "pred_density_0_5": _r((s >= 0.5).mean()), "teach_dm_threshold": _r(thr),
                            "pred_density_teach_dm": _r((s >= thr).mean()), "auc": mm["auc"], "ap": mm["ap"]})
        mm = metrics(yl[m], rule_l[m])
        lib_out.append({**base, "model": "rule_spec", "mean_prob": None,
                        "pred_density_0_5": _r(rule_l[m].mean()), "teach_dm_threshold": None,
                        "pred_density_teach_dm": None, "auc": mm["auc"], "ap": mm["ap"]})
    with open(RESULTS_DIR / "predictor_library.csv", "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(lib_out[0].keys()))
        w.writeheader()
        w.writerows(lib_out)
    result["library_check"] = {
        "overlap_note": "The eight library pieces (Burgmuller Op. 100 Nos. 1/2/3/5, Schumann Op. 68/1, Mozart "
                        "K545 i, Moonlight i, Chopin Op. 69/2) are also in the Mutopia corpus, so models fitted "
                        "on all Mutopia rows have seen the same music (with Mutopia's fingerings, which may come "
                        "from the same or a different edition). This is not a clean hold-out; the *_excl_overlap "
                        "models are refitted without the matching Mutopia parts.",
        "excluded_mutopia_parts": overlap,
        "n_excluded_parts": len(excluded), "n_excluded_rows": int((~keep).sum()),
        "teaching_density_matched_threshold": "threshold on the model's own training rows of the teaching group "
                                              "that makes the predicted density equal the teaching density",
        "rows": lib_out,
    }
    result["runtime_sec"] = {"load": round(t_load, 1), "cv": round(t_cv, 1), "total": round(time.time() - t0, 1)}
    with open(RESULTS_DIR / "predictor.json", "w", encoding="utf-8") as f:
        json.dump(result, f, indent=1)

    # --- summary -------------------------------------------------------------------------
    print(f"\nCross-validated ({N_SPLITS}-fold by part), {t_cv:.1f} s")
    for name, rep in result["models"].items():
        print(f"{name}")
        for g in ("overall",) + LEVEL_GROUPS:
            print(f"  {g:9} {_fmt_m(rep.get(g))}")
    print("Teaching-only vs global on teaching rows")
    for k in ("logistic", "tree_depth3"):
        print(f"  {k:12} teaching-only: {_fmt_m(result['teaching_only'][k]['teaching'])}")
    print(f"  {'logistic':12} global:        {_fmt_m(result['teaching_only']['global_logistic_on_teaching'])}")
    print(f"  {'tree_depth3':12} global:        {_fmt_m(result['teaching_only']['global_tree_on_teaching'])}")
    print("Spec rule clauses (share firing, precision, recall)")
    for c, d in clauses.items():
        print(f"  {c:16} fires {d['fires_share']} P {d['precision']} R {d['recall']}")
    print("Spec rule and clause print rates by stratum (rate when the clause fires / otherwise)")
    for sname, d in result["rule_clauses_by_stratum"].items():
        cl = "; ".join(f"{c} {d[c]['print_rate_when_fires']}/{d[c]['print_rate_otherwise']}" for c in RULE_CLAUSES)
        print(f"  {sname:22} n {d['n']:6d} editor {d['editor_density']} rule dens {d['rule_spec']['pred_density']} "
              f"P {d['rule_spec']['precision']} R {d['rule_spec']['recall']} | {cl}")
    print(f"Logistic coefficients (standardised), intercept {result['logistic_coefficients']['intercept']}")
    for cr in coef_rows[:15]:
        print(f"  {cr['rank']:2d} {cr['feature']:22} {cr['coef_std']:+.3f} (teaching {cr['coef_std_teaching_model']:+.3f}) "
              f"mean {cr['mean']} std {cr['std']}")
    print("Tree (all Mutopia rows)")
    print(tree_txt)
    for lf in leaves:
        print(f"  leaf {lf['leaf']:2d} n {lf['n']:6d} rate {lf['print_rate']:.3f}  {lf['path']}")
    print("Library pieces: editor density vs predicted (0.5 / teaching density-matched), AUC")
    for r in lib_out:
        print(f"  {r['piece'][:40]:40} {r['model'][:30]:30} editor {r['editor_density']} "
              f"mean_p {r['mean_prob']} @0.5 {r['pred_density_0_5']} @dm {r['pred_density_teach_dm']} AUC {r['auc']}")
    print(f"wrote {RESULTS_DIR}/predictor.json, predictor_coefficients.csv, predictor_tree.txt, "
          f"predictor_library.csv; total {result['runtime_sec']['total']} s")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
