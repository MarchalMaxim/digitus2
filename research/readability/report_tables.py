#!/usr/bin/env python
"""Print the markdown tables of docs/research/readability.md from the results files.

    research/.venv-readability/Scripts/python.exe -X utf8 research/readability/report_tables.py [section ...]

Sections: density, context, printed, repeats, player, reduction, predictor (default: all).
"""
from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
RESULTS = HERE / "results"
GROUPS = ("teaching", "concert", "other", "library")


def pct(x, nd=1):
    return "" if x is None else f"{100 * x:.{nd}f}"


def load(name):
    p = RESULTS / name
    if not p.exists():
        return None
    with open(p, encoding="utf-8") as f:
        return json.load(f) if name.endswith(".json") else list(csv.DictReader(f))


# ---------------------------------------------------------------------------------------
def density():
    d = load("density.json")
    print("| Group | Parts | Notes | Printed | Density (note-weighted) | Part median | IQR | p10-p90 | Parts >= 90 % | Parts < 5 % |")
    print("|---|---|---|---|---|---|---|---|---|---|")
    for g in ("teaching", "teaching_excl_clementi", "concert", "other", "library"):
        v = d["by_group"][g]
        q = v["part_density"]
        print(f"| {g} | {v['parts']} | {v['notes']:,} | {v['printed']:,} | {pct(v['density_note_weighted'])} | "
              f"{pct(q['median'])} | {pct(q['p25'])}-{pct(q['p75'])} | {pct(q['p10'])}-{pct(q['p90'])} | "
              f"{v['parts_density_ge_90pct']} | {v['parts_density_lt_5pct']} |")
    print()
    print("| Group | RH notes | RH density | LH notes | LH density |")
    print("|---|---|---|---|---|")
    for g in GROUPS:
        r, l = d["by_hand"][f"{g}/R"], d["by_hand"][f"{g}/L"]
        print(f"| {g} | {r['notes']:,} | {pct(r['density'])} | {l['notes']:,} | {pct(l['density'])} |")
    print()
    print("| Composer | Group | Parts | Notes | Printed | Density | Part median | Part min-max |")
    print("|---|---|---|---|---|---|---|---|")
    for c, v in d["by_composer"].items():
        if v["notes"] < 400 and not c.startswith("library"):
            continue
        print(f"| {c} | {v['group']} | {v['parts']} | {v['notes']:,} | {v['printed']:,} | {pct(v['density_note_weighted'])} | "
              f"{pct(v['part_density_median'])} | {pct(v['part_density_min'])}-{pct(v['part_density_max'])} |")
    print()
    print("| Library piece | Level | Notes | Printed | Density | RH | LH |")
    print("|---|---|---|---|---|---|---|")
    for v in d["library_by_piece"]:
        print(f"| {v['id'][4:]} | {v['level']} | {v['notes']} | {v['printed']} | {pct(v['density'])} | {pct(v['density_rh'])} | {pct(v['density_lh'])} |")


# ---------------------------------------------------------------------------------------
def context():
    rows = load("print_rate_by_context.csv")
    keep = {
        "first_of_hand": {"1": "first note of the hand"},
        "first_of_piece": {"1": "first note of the piece"},
        "after_rest_beat": {"1": "after a rest of >= 1 beat", "0": "no such rest"},
        "after_rest": {"1": "after any rest"},
        "after_long_note": {"1": "after a note >= 2 beats (no rest)"},
        "leap_bin": {"repeat": "repeated pitch (0 st)", "step": "step (1-2 st)", "third": "third (3-4 st)",
                     "fourth_fifth": "fourth-fifth (5-7 st)", "sixth_octave": "sixth-octave (8-12 st)",
                     "over_octave": "more than an octave"},
        "black": {"1": "black key", "0": "white key"},
        "chord_pos": {"single": "single note", "bottom": "chord, bottom", "inner": "chord, inner", "top": "chord, top"},
        "run_pos": {"start": "stepwise run, first note", "mid": "stepwise run, inside", "end": "stepwise run, last note",
                    "none": "not in a run"},
        "density_bin": {"lt2": "< 2 notes/s", "2to4": "2-4 notes/s", "4to8": "4-8 notes/s", "ge8": ">= 8 notes/s"},
        "bar_pos_bin": {"downbeat": "downbeat", "on_beat": "other beat", "off_beat": "off the beat"},
        "hand": {"R": "right hand", "L": "left hand"},
        "grace": {"1": "grace note"},
    }
    print("| Context | teaching | concert | other | library |")
    print("|---|---|---|---|---|")
    tot = {g: [0, 0] for g in GROUPS}
    for r in rows:
        if r["context"] == "hand":
            for g in GROUPS:
                tot[g][0] += int(r[f"{g}_printed"])
                tot[g][1] += int(r[f"{g}_notes"])
    print("| all notes | " + " | ".join(f"{100 * tot[g][0] / tot[g][1]:.1f} ({tot[g][1]:,})" for g in GROUPS) + " |")
    for r in rows:
        labels = keep.get(r["context"])
        if not labels or r["value"] not in labels:
            continue
        cells = []
        for g in GROUPS:
            n = int(r[f"{g}_notes"])
            cells.append(f"{r[f'{g}_rate']} ({n:,})" if n else "-")
        print(f"| {labels[r['value']]} | " + " | ".join(cells) + " |")


# ---------------------------------------------------------------------------------------
def printed():
    d = load("printed_contexts.json")
    print("| | teaching | concert | other | library |")
    print("|---|---|---|---|---|")
    print("| printed digits | " + " | ".join(f"{d[g]['printed']:,}" for g in GROUPS) + " |")
    print("| ... whose previous event is also printed (adjacent pairs) | " +
          " | ".join(f"{d[g]['printed_with_printed_previous_event']:,} ({pct(d[g]['share_adjacent_pairs'])} %)" for g in GROUPS) + " |")
    for k, lab in (("0", "anchor unchanged"), ("0.5", "half column (black-key ambiguity)"), ("1", "1 column"),
                   ("1.5", "1.5"), ("2", "2"), ("2.5-3.5", "2.5-3.5"), ("4+", "4 or more")):
        print(f"| adjacent pairs: anchor change {lab} | " +
              " | ".join(f"{d[g]['anchor_delta_among_adjacent'].get(k, {'n': 0, 'share': 0})['n']:,} ({pct(d[g]['anchor_delta_among_adjacent'].get(k, {'share': 0})['share'])} %)" for g in GROUPS) + " |")
    print("| adjacent pairs: position change (anchor moves >= 1) | " +
          " | ".join(f"{d[g]['position_change_among_adjacent']['n']:,} ({pct(d[g]['position_change_among_adjacent']['share'])} %)" for g in GROUPS) + " |")
    for k, lab in (("thumb_under", "thumb under (1 after 2-4, outward)"), ("finger_over", "finger over (2-4 after 1, inward)")):
        print(f"| adjacent pairs: {lab} | " +
              " | ".join(f"{d[g]['crossing_among_adjacent'].get(k, {'n': 0})['n']:,} ({pct(d[g]['crossing_among_adjacent'].get(k, {'share': 0})['share'])} %)" for g in GROUPS) + " |")
    e = "events_since_previous_digit"
    print("| events since the previous digit: median / mean / p90 | " +
          " | ".join(f"{d[g][e]['median']:.0f} / {d[g][e]['mean']:.1f} / {d[g][e]['p90']:.0f}" for g in GROUPS) + " |")
    print("| digits whose previous event is printed (gap = 1) | " +
          " | ".join(f"{pct(d[g][e]['hist'].get('1', 0) / d[g][e]['n'])} %" for g in GROUPS) + " |")
    print()
    print("| Context of a printed digit | teaching | concert | other | library |")
    print("|---|---|---|---|---|")
    for k, lab in (("first_of_hand", "first note of the hand"), ("after_rest_beat", "after a rest >= 1 beat"),
                   ("after_long_note", "after a long note"), ("leap_ge_fourth", "leap of a fourth or more"),
                   ("chord_outer", "outer voice of a chord"), ("run_start", "first note of a stepwise run"),
                   ("crossing", "crossing (needs the previous digit)"), ("position_change", "position change (needs the previous digit)")):
        print(f"| {lab} | " + " | ".join(f"{d[g]['spec_context_counts_among_printed'].get(k, {'n': 0})['n']:,} ({pct(d[g]['spec_context_counts_among_printed'].get(k, {'share': 0})['share'])} %)" for g in GROUPS) + " |")
    print()
    print("| Isolated digits (previous event unprinted) | teaching | concert | other | library |")
    print("|---|---|---|---|---|")
    print("| isolated digits (share of all printed) | " + " | ".join(f"{d[g]['isolated_digits']['n']:,} ({pct(d[g]['isolated_digits']['share_of_printed'])} %)" for g in GROUPS) + " |")
    for k, lab in (("first_of_hand", "first note of the hand"), ("after_rest_beat", "after a rest >= 1 beat"),
                   ("after_long_note", "after a long note"), ("leap_ge_fourth", "leap of a fourth or more"),
                   ("chord_outer", "outer voice of a chord"), ("run_start", "first note of a stepwise run")):
        cells = []
        for g in GROUPS:
            c = d[g]["isolated_digits"]["contexts"].get(k)
            cells.append(f"{pct(c['share'])} % (all notes {pct(c['share_among_all_notes'])} %)" if c else "-")
        print(f"| {lab} | " + " | ".join(cells) + " |")
    print("| in at least one score-only context | " + " | ".join(f"{pct(d[g]['isolated_digits']['covered_by_score_only_context']['share'])} %" for g in GROUPS) + " |")
    print()
    print("| Coverage of printed digits | teaching | concert | other | library |")
    print("|---|---|---|---|---|")
    print("| in at least one of the above | " + " | ".join(f"{d[g]['printed_covered_by_any_spec_context']['n']:,} ({pct(d[g]['printed_covered_by_any_spec_context']['share'])} %)" for g in GROUPS) + " |")
    print("| in at least one score-only context | " + " | ".join(f"{d[g]['printed_covered_by_score_only_context']['n']:,} ({pct(d[g]['printed_covered_by_score_only_context']['share'])} %)" for g in GROUPS) + " |")


# ---------------------------------------------------------------------------------------
def repeats():
    d = load("repeats.json")
    cats = (("all", "all repeats"), ("exact", "exact (same pitches)"), ("transposed_same_pattern", "transposed, same black/white pattern"),
            ("transposed_diff_pattern", "transposed, different pattern"), ("adjacent", "immediately adjacent to the first statement"),
            ("distant", "not adjacent"), ("len_ge_8", "at least 8 events"), ("exact_len_ge_8", "exact and at least 8 events"))
    for g in ("overall",) + GROUPS:
        G = d["groups"][g]
        base = G["baseline_no_repeat"]
        print(f"**{g}**: {G['n_parts']} parts, {G['notes']['n']:,} notes, print rate {pct(G['notes']['p'])} %; notes in no repeated segment: "
              f"{base['n']:,}, print rate {pct(base['p'])} %.\n")
        print("| Category | Later occurrences | Median / p90 / max length (events) | First-statement notes: n, print rate | Later notes: n, print rate | P(later printed given first printed) | P(later printed given first unprinted) | Same digit when both printed |")
        print("|---|---|---|---|---|---|---|---|")
        for k, lab in cats:
            c = G["categories"].get(k)
            if not c or not c["n_later_occurrences"]:
                continue
            L = c["length_events"]
            f, l = c["first_occurrence_notes"], c["later_occurrence_notes"]
            a, b, s = c["p_later_printed_given_first_printed"], c["p_later_printed_given_first_unprinted"], c["same_digit_given_both_printed"]
            print(f"| {lab} | {c['n_later_occurrences']:,} | {L['median']:.0f} / {L['p90']} / {L['max']} | {f['n']:,}, {pct(f['p'])} | {l['n']:,}, {pct(l['p'])} | "
                  f"{pct(a['p'])} ({a['n']:,}) | {pct(b['p'])} ({b['n']:,}) | {pct(s['p'])} ({s['n']:,}) |")
        print()


# ---------------------------------------------------------------------------------------
def player():
    d = load("player_model.json")
    groups = ("teaching", "concert", "other", "library", "all")
    print("| Model | Group | Hidden per seed | Coverage | Accuracy | Reconstruction |")
    print("|---|---|---|---|---|---|")
    for m in ("copy_previous", "rules", "rules_plus_textbook", "rules_column_steps"):
        for g in groups:
            if m in ("copy_previous", "rules_column_steps") and g != "all":
                continue
            x = d["hide20"][m][g]
            cell = lambda k: f"{pct(x[k]['mean'])} [{pct(x[k]['min'])}-{pct(x[k]['max'])}]"
            print(f"| {m} | {g} | {x['n_hidden']['mean']:.0f} | {cell('coverage')} | {cell('accuracy')} | {cell('reconstruction')} |")
    print()
    print("| Model | Group | Digits | Coverage | Accuracy | Reconstruction |")
    print("|---|---|---|---|---|---|")
    for m in ("copy_previous", "rules", "rules_plus_textbook"):
        for g in groups:
            if m == "copy_previous" and g != "all":
                continue
            x = d["loo"][m][g]
            print(f"| {m} | {g} | {x['n_hidden']:,} | {pct(x['coverage'])} | {pct(x['accuracy'])} | {pct(x['reconstruction'])} |")
    print()
    print("| Rule | Rules model: n | share | accuracy | With textbook: n | share | accuracy |")
    print("|---|---|---|---|---|---|---|")
    r = d["hide20_by_rule_all_groups"]

    def fa(x):
        if not x:
            return "- | - | -"
        acc = pct(x["accuracy"]) if x["accuracy"] is not None else "-"
        return f"{x['n']:,} | {pct(x['share'])} | {acc}"
    for k in ("textbook", "R1", "R2", "R3", "R4", "R4_ref", "none"):
        print(f"| {k} | {fa(r['rules'].get(k))} | {fa(r['rules_plus_textbook'].get(k))} |")
    print()
    rows = load("player_model_by_rule.csv")
    print("| Rule | teaching n / accuracy | concert | other | library |")
    print("|---|---|---|---|---|")
    for k in ("R1", "R2", "R3", "R4", "R4_ref", "none"):
        cells = []
        for g in GROUPS:
            x = [q for q in rows if q["protocol"] == "hide20" and q["model"] == "rules" and q["level_group"] == g and q["rule"] == k]
            if not x:
                cells.append("-")
            elif x[0]["accuracy"]:
                cells.append(f"{int(x[0]['n']):,} / {float(x[0]['accuracy']) * 100:.1f}")
            else:
                cells.append(f"{int(x[0]['n']):,} / -")
        print(f"| {k} | " + " | ".join(cells) + " |")
    print()
    dd = d["hide20_by_distance_since_visible"]["rules"]
    keys = ("0", "1", "2", "3", "4", "5-8", "9-16", "17+", "none")
    print("| Events since the last visible digit | 0 (same chord) | 1 | 2 | 3 | 4 | 5-8 | 9-16 | 17+ | no digit before |")
    print("|---|---|---|---|---|---|---|---|---|---|")
    print("| hidden digits | " + " | ".join(f"{dd[k]['n']:,}" for k in keys) + " |")
    print("| coverage | " + " | ".join(pct(dd[k]["coverage"]) for k in keys) + " |")
    print("| accuracy | " + " | ".join((pct(dd[k]["accuracy"]) if dd[k]["accuracy"] is not None else "-") for k in keys) + " |")
    print()
    ctx = load("player_model_by_context.csv")
    labels = (("leap_bin", "none", "first note of the hand"), ("leap_bin", "repeat", "repeated pitch"), ("leap_bin", "step", "step"),
              ("leap_bin", "third", "third"), ("leap_bin", "fourth_fifth", "fourth-fifth"), ("leap_bin", "sixth_octave", "sixth-octave"),
              ("leap_bin", "over_octave", "over an octave"), ("chord_pos", "single", "single note"), ("chord_pos", "bottom", "chord bottom"),
              ("chord_pos", "inner", "chord inner"), ("chord_pos", "top", "chord top"), ("run_pos", "start", "stepwise run, first"),
              ("run_pos", "mid", "stepwise run, inside"), ("run_pos", "end", "stepwise run, last"), ("after_rest_beat", "1", "after a rest >= 1 beat"),
              ("after_long_note", "1", "after a long note"), ("black", "0", "white key"), ("black", "1", "black key"),
              ("density_bin", "lt2", "< 2 notes/s"), ("density_bin", "ge8", ">= 8 notes/s"), ("hand", "R", "right hand"), ("hand", "L", "left hand"))
    print("| Context | teaching | concert | other | library |")
    print("|---|---|---|---|---|")
    for c, v, lab in labels:
        cells = []
        for g in GROUPS:
            x = [q for q in ctx if q["model"] == "rules" and q["level_group"] == g and q["context"] == c and q["value"] == v]
            if x and int(x[0]["n"]) > 0:
                x = x[0]
                acc = f"{float(x['accuracy']) * 100:.0f}" if x["accuracy"] else "-"
                cells.append(f"{float(x['coverage']) * 100:.0f} / {acc} ({int(x['n']):,})")
            else:
                cells.append("-")
        print(f"| {lab} | " + " | ".join(cells) + " |")
    print()
    conf = d["hide20_confusion_rules"]["counts"]
    print("| editor's finger \\ inferred | 1 | 2 | 3 | 4 | 5 |")
    print("|---|---|---|---|---|---|")
    for i, row in enumerate(conf, start=1):
        print(f"| {i} | " + " | ".join(f"{c:,}" for c in row) + " |")


# ---------------------------------------------------------------------------------------
def reduction():
    d = load("reduction.json")
    print("| Model | Parts | Notes | Printed by the editor | Kept by the reduction | Editorial density | Kept density | Median part kept density (min-max) | Kept / printed |")
    print("|---|---|---|---|---|---|---|---|---|")
    for m in ("rules", "rules_plus_textbook", "rules_plus_repeats", "rules_plus_textbook_plus_repeats"):
        if m not in d["models"]:
            continue
        for label, name in (("density_ge_90", "fully fingered parts (>= 90 %)"), ("density_ge_70", "parts >= 70 %"),
                            ("teaching", "teaching (all)"), ("concert", "concert"), ("other", "other"), ("library", "library"), ("all", "all")):
            x = d["models"][m][label]
            print(f"| {m} | {name}: {x['parts']} | {x['notes']:,} | {x['printed']:,} | {x['kept']:,} | {pct(x['editorial_density'])} | "
                  f"{pct(x['kept_density'])} | {pct(x['part_kept_density_median'])} ({pct(x['part_kept_density_min'])}-{pct(x['part_kept_density_max'])}) | "
                  f"{pct(x['kept_share_of_printed'])} |")
    print()
    x = d["models"]["rules"]["density_ge_90"]["why_kept"]
    tot = sum(x.values())
    print("| Reader outcome without the digit | Kept digits | Share |")
    print("|---|---|---|")
    for k, v in x.items():
        print(f"| {k} | {v:,} | {pct(v / tot)} |")
    print()
    c = d["models"]["rules"]["kept_by_context_density_ge_90"]
    print("| Context | Kept | Dropped | Kept share |")
    print("|---|---|---|---|")
    for col, lab in (("leap_bin", "interval"), ("chord_pos", "chord position"), ("run_pos", "stepwise run"),
                     ("after_rest_beat", "after a rest >= 1 beat"), ("first_of_hand", "first of hand"), ("hand", "hand"), ("black", "black key")):
        for v, y in c[col].items():
            print(f"| {lab} = {v} | {y['kept']:,} | {y['dropped']:,} | {pct(y['kept_rate'])} |")


# ---------------------------------------------------------------------------------------
def predictor():
    d = load("predictor.json")
    print("| Model | Group | Notes | Editorial density | AUC | Average precision | Precision / recall / predicted density at 0.5 | Precision / recall at the density-matched threshold |")
    print("|---|---|---|---|---|---|---|---|")
    for m, name in (("logistic", "logistic regression"), ("tree_depth3", "depth-3 tree"), ("rule_spec", "spec rule list"),
                    ("rule_spec_minus_chord_outer", "spec rules without chord outer voice"), ("rule_spec_plus_after_long_note", "spec rules plus after a long note")):
        for g in ("overall", "teaching", "concert", "other"):
            x = d["models"][m][g]
            a = x["at_0_5"]
            dm = x.get("density_matched")
            dm_cell = f"{pct(dm['precision'])} / {pct(dm['recall'])}" if dm else "(binary rule)"
            print(f"| {name} | {g} | {x['n']:,} | {pct(x['density'])} | {x['auc']:.3f} | {x['ap']:.3f} | {pct(a['precision'])} / {pct(a['recall'])} / {pct(a['pred_density'])} | {dm_cell} |")
    t = d["teaching_only"]
    x = t["logistic"]["teaching"]
    y = t["global_logistic_on_teaching"]
    print(f"| logistic, trained on teaching only | teaching | {x['n']:,} | {pct(x['density'])} | {x['auc']:.3f} | {x['ap']:.3f} | "
          f"{pct(x['at_0_5']['precision'])} / {pct(x['at_0_5']['recall'])} / {pct(x['at_0_5']['pred_density'])} | {pct(x['density_matched']['precision'])} / {pct(x['density_matched']['recall'])} |")
    print()
    print("| Rank | Feature | Standardised coefficient | Odds ratio per SD | Teaching-only model | Mean | SD | Print rate when non-zero |")
    print("|---|---|---|---|---|---|---|---|")
    for r in load("predictor_coefficients.csv")[:16]:
        print(f"| {r['rank']} | {r['feature']} | {float(r['coef_std']):+.3f} | {float(r['odds_ratio_per_sd']):.2f} | {float(r['coef_std_teaching_model']):+.3f} | {float(r['mean']):.3f} | {float(r['std']):.3f} | {pct(float(r['print_rate_when_nonzero']))} |")
    print(f"\nIntercept {d['logistic_coefficients']['intercept']:+.3f} (teaching-only model {d['logistic_coefficients']['intercept_teaching_model']:+.3f}).\n")
    print("| Clause | Fires on (share of notes) | Precision (print rate when it fires) | Recall |")
    print("|---|---|---|---|")
    for k, lab in (("first_of_hand", "first note of the hand"), ("after_rest_beat", "rest of >= 1 beat before"), ("after_long_note", "after a long note"),
                   ("leap_ge_5", "leap of >= 5 semitones"), ("chord_outer", "outer voice of a chord"), ("run_start", "first note of a stepwise run")):
        c = d["rule_clauses"][k]
        print(f"| {lab} | {pct(c['fires_share'])} | {pct(c['precision'])} | {pct(c['recall'])} |")
    print()
    print("| Stratum | Notes | Editorial density | Spec rules: predicted density | precision | recall | leap >= 5: print rate when it fires / otherwise | rest >= 1 beat: fires / otherwise | run start: fires / otherwise |")
    print("|---|---|---|---|---|---|---|---|---|")
    for s, lab in (("RH_single", "RH single notes"), ("RH_chord", "RH chord notes"), ("LH_single", "LH single notes"), ("LH_chord", "LH chord notes"),
                   ("RH_single_teaching", "RH single notes, teaching"), ("RH_single_concert", "RH single notes, concert"), ("RH_single_other", "RH single notes, other")):
        x = d["rule_clauses_by_stratum"][s]
        rs = x["rule_spec"]
        f = lambda k: f"{pct(x[k]['print_rate_when_fires'])} / {pct(x[k]['print_rate_otherwise'])}"
        print(f"| {lab} | {x['n']:,} | {pct(x['editor_density'])} | {pct(rs['pred_density'])} | {pct(rs['precision'])} | {pct(rs['recall'])} | {f('leap_ge_5')} | {f('after_rest_beat')} | {f('run_start')} |")
    print()
    print("| Library piece | Level | Notes | Editorial density | Mean predicted probability | Predicted density at 0.5 | Predicted density at the teaching density-matched threshold | AUC on the piece |")
    print("|---|---|---|---|---|---|---|---|")
    for r in load("predictor_library.csv"):
        if r["model"] != "logistic_global":
            continue
        print(f"| {r['piece'][4:]} | {r['level']} | {r['n_notes']} | {pct(float(r['editor_density']))} | {pct(float(r['mean_prob']))} | {pct(float(r['pred_density_0_5']))} | {pct(float(r['pred_density_teach_dm']))} | {float(r['auc']):.3f} |")


SECTIONS = {"density": density, "context": context, "printed": printed, "repeats": repeats, "player": player,
            "reduction": reduction, "predictor": predictor}


def main(argv):
    names = argv or list(SECTIONS)
    for n in names:
        if n in SECTIONS:
            print(f"\n## {n}\n")
            SECTIONS[n]()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
