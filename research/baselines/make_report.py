"""Merge registry.json (metadata) with the scores in results.json and write

  * results.json            -- adds an "implementations" view, the human leave-one-out
                               reference and the paper's Table 2 numbers;
  * results_table.md        -- the markdown results table used in docs/research/baselines.md.

    python make_report.py
"""
from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from _common import RESEARCH_DIR, default_pig_dir, gt_files, load_split, read_pig  # noqa: E402

METRICS = ("m_gen", "m_high", "m_soft", "m_rec")
PAPER_TABLE2 = {  # Nakamura, Saito & Yoshii 2020, Table 2 (PIG v1.0, 30 test pieces)
    "1st-order HMM": [61.7, 68.3, 82.8, 74.0], "2nd-order HMM": [64.3, 70.8, 85.3, 77.6],
    "3rd-order HMM": [64.5, 71.0, 85.5, 77.8], "Chord HMM": [61.2, 67.7, 81.7, 73.8],
    "DNN (FF)": [61.5, 66.2, 82.5, 69.5], "DNN (LSTM)": [61.3, 66.1, 82.8, 69.5],
    "Human (leave-one-out)": [71.4, 79.1, 90.8, 84.3],
}
VARIANT_LABEL = {
    "nakamura_fhmm1": "FHMM1 (1st-order)", "nakamura_fhmm2": "FHMM2 (2nd-order)",
    "nakamura_fhmm3": "FHMM3 (3rd-order)", "nakamura_chmm": "CHMM (chord HMM)",
    "nakamura_fhmm1_released_files": "FHMM1, authors' released outputs (PIG v1.0 hands)",
    "nakamura_fhmm2_released_files": "FHMM2, authors' released outputs (PIG v1.0 hands)",
    "nakamura_fhmm3_released_files": "FHMM3, authors' released outputs (PIG v1.0 hands)",
    "ramoneda_argnn_beam10": "ArGNN, beam 10", "ramoneda_argnn": "ArGNN, greedy",
    "ramoneda_arlstm_beam10": "ArLSTM, beam 10", "ramoneda_arlstm": "ArLSTM, greedy",
    "lumikey_pretrained": "released checkpoints",
    "lumikey_retrained_pigtrain": "retrained on PIG train split",
    "apfgen_pretrained": "released best.pt, beam",
    "apfgen_pretrained_nobeam": "released best.pt, argmax",
    "apfgen_retrained_official": "retrained on official split, beam",
    "apfgen_retrained_official_nobeam": "retrained on official split, argmax",
    "fingerflow_learned": "learned weights (031-150)", "fingerflow_default": "hand-tuned weights",
    "chirality_parncutt_viterbi_learned": "Parncutt rules, learned weights",
    "chirality_parncutt_viterbi_uniform": "Parncutt rules, uniform weights",
    "pydactyl_parncutt": "Parncutt 1997", "pydactyl_jacobs": "Jacobs 2001", "pydactyl_badgerow": "Badgerow 2009",
    "pydactyl_balliauw": "Balliauw 2017 rules", "pydactyl_hart": "Hart 2000", "pydactyl_random": "random",
    "pianoplayer": "MusicXML-path emulation (x fix + chord stagger)",
    "pianoplayer_pigreader_nostagger": "upstream PIG reader (+ x fix)",
    "opennote_rules_consensus": "rules: consensus", "opennote_rules_parncutt": "rules: Parncutt",
    "opennote_rules_jacobs": "rules: Jacobs", "huukhang_simple": "simple DP", "huukhang_phraseaware": "phrase-aware pipeline",
    "valhala_bilateral": "as shipped (LH = RH model)", "valhala_mirrored": "LH mirrored (our change)",
    "ackyedy_h2": "H2 interval HMM", "ackyedy_h1": "H1 interval HMM", "ackyedy_b0": "B0 most frequent finger",
    "ackyedy_b1": "B1 direction rule", "nakamura_fhmm1_webdemo_js": "web demo FHMM1 (JS)",
}


TRAINED_ON = {
    "lumikey_pretrained": "all 309 PIG files incl. the test pieces",
    "lumikey_retrained_pigtrain": "PIG 031-150 (retrained here)",
    "apfgen_pretrained": "random 70% of PIG files incl. most test pieces",
    "apfgen_pretrained_nobeam": "random 70% of PIG files incl. most test pieces",
    "apfgen_retrained_official": "PIG 031-150 (retrained here)",
    "apfgen_retrained_official_nobeam": "PIG 031-150 (retrained here)",
    "fingerflow_default": "none (hand-tuned)",
    "chirality_parncutt_viterbi_uniform": "none (uniform rule weights)",
    "ackyedy_b1": "none",
}


def human_reference(pieces):
    sys.path.insert(0, str(RESEARCH_DIR))
    from fingering_eval import metrics as M  # noqa: E402
    out = {}
    for mode in ("official", "press"):
        rows = []
        for pc in pieces:
            anns = {p.name: [n.finger for n in read_pig(p)] for p in gt_files(pc)}
            loo = M.leave_one_out(anns, pc, mode=mode)
            rows.append([sum(getattr(x, m) for x in loo) / len(loo) for m in METRICS])
        out[mode] = {f"macro_{m}": round(100 * sum(r[i] for r in rows) / len(rows), 2) for i, m in enumerate(METRICS)}
    return out


def per_piece(csv_path):
    data = {}
    if not csv_path.is_file():
        return data
    with open(csv_path, encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            data.setdefault(row["baseline"], {})[row["piece"]] = {m: float(row[f"official_{m}"]) for m in METRICS}
    return data


def main() -> None:
    reg = json.loads((HERE / "registry.json").read_text(encoding="utf-8"))
    res_path = HERE / "results.json"
    res = json.loads(res_path.read_text(encoding="utf-8"))
    split = load_split()
    pp = per_piece(HERE / "results_per_piece_test.csv")
    res["human_reference_test"] = human_reference(split["test"])
    res["paper_table2_reference"] = PAPER_TABLE2
    rows = []
    impls = []
    for imp in reg["implementations"]:
        entry = dict(imp)
        entry["scores_test"] = {}
        for name in imp.get("outputs", []):
            t = res.get("baselines", {}).get(name, {}).get("test")
            if not t or "official" not in t:
                continue
            sc = {m: t["official"][f"macro_{m}"] for m in METRICS}
            sc.update({"coverage": f"{t['n_scored']}/{t['n_pieces_in_split']}",
                       "mean_seconds_per_piece": t.get("runtime", {}).get("mean_seconds_per_piece")})
            if t["n_scored"] < t["n_pieces_in_split"] and name in pp:
                covered = sorted(pp[name])
                for ref in ("nakamura_fhmm3", "fingerflow_learned"):
                    if ref in pp and all(p in pp[ref] for p in covered):
                        sc[f"{ref}_on_same_pieces"] = {
                            m: round(100 * sum(pp[ref][p][m] for p in covered) / len(covered), 2) for m in METRICS}
            entry["scores_test"][name] = sc
            rows.append((name, imp, sc))
        impls.append(entry)
    res["implementations"] = impls
    res["not_run"] = reg["not_run"]
    res_path.write_text(json.dumps(res, indent=1), encoding="utf-8")

    rows.sort(key=lambda r: -r[2]["m_gen"])
    hum = res["human_reference_test"]["official"]
    lines = ["| # | Implementation | Variant | Approach | License | Trained on | M_gen | M_high | M_soft | M_rec | Pieces | s/piece |",
             "|---|---|---|---|---|---|---|---|---|---|---|---|",
             f"| - | *Human annotators (leave-one-out)* | | | | | *{hum['macro_m_gen']:.1f}* | *{hum['macro_m_high']:.1f}* | "
             f"*{hum['macro_m_soft']:.1f}* | *{hum['macro_m_rec']:.1f}* | 30/30 | |"]
    for i, (name, imp, sc) in enumerate(rows, 1):
        flag = " **(contaminated)**" if imp.get("contaminated") and ("pretrained" in name) else ""
        trained = TRAINED_ON.get(name, imp["trained_on"])
        secs = sc.get("mean_seconds_per_piece")
        secs = "" if secs is None else (f"{secs:.2f}" if secs < 10 else f"{secs:.0f}")
        lines.append(f"| {i} | {imp['name']} | {VARIANT_LABEL.get(name, name)}{flag} | {imp['family']} | {imp['license']} | "
                     f"{trained} | "
                     f"{sc['m_gen']:.1f} | {sc['m_high']:.1f} | {sc['m_soft']:.1f} | {sc['m_rec']:.1f} | "
                     f"{sc['coverage']} | {secs} |")
    (HERE / "results_table.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
