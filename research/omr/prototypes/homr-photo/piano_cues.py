"""Experimental geometry-only exclusion of inset examples on piano pages.

This is a proposal for source review, not a claim that every excluded region is
irrelevant. A legitimate indented single-staff coda can look like a cue. Consumers
must retain the structured audit and source image for review.
"""
from __future__ import annotations
import math
from statistics import median

PROFILE = "dominant-piano-inset-single-v1"

def select_piano_systems(rows):
    audit = {"profile": PROFILE, "experimental": True, "coordinateSpace": "homr-preprocessed-image",
             "inputSystems": len(rows), "removed": [], "reason": "no-dominant-unambiguous-piano-layout"}
    if not rows or any(len(row.staffs) != 1 for row in rows):
        return rows, audit
    grands = [row.staffs[0] for row in rows if row.staffs[0].is_grandstaff]
    if len(grands) < 3 or len(grands) / len(rows) < 2 / 3:
        return rows, audit
    widths = [s.max_x - s.min_x for s in grands]
    if any(not math.isfinite(w) or w <= 0 for w in widths):
        return rows, audit
    width = median(widths)
    left = median(s.min_x for s in grands)
    right = left + width
    audit.update({"reason": "dominant-piano-layout", "grandSystems": len(grands),
                  "referenceBoundsX": [float(left), float(right)], "referenceWidth": float(width)})
    kept = []
    for index, row in enumerate(rows):
        staff = row.staffs[0]
        if staff.is_grandstaff or row.connections:
            kept.append(row)
            continue
        centers = [s.center for s in staff.symbols
                   if len(s.center) == 2 and all(math.isfinite(float(v)) for v in s.center)]
        if len(centers) < 3:
            kept.append(row)
            continue
        support_left = min(p[0] for p in centers)
        support_right = max(p[0] for p in centers)
        support_width = support_right - support_left
        # Distinct short inset support, even when faint lines inflate the staff
        # rectangle across blank paper. No pitches, durations, XML or image-specific
        # absolute coordinates enter this decision.
        short_inset = (0 < support_width <= 0.4 * width
                       and support_left >= left + 0.5 * width
                       and support_right <= right + 0.1 * width
                       and staff.max_x - staff.min_x <= 1.15 * width)
        detached = all(staff.max_y < main.min_y or staff.min_y > main.max_y for main in grands)
        if not short_inset or not detached:
            kept.append(row)
            continue
        audit["removed"].append({
            "systemIndex": index, "staffCount": 1, "isGrandstaff": False,
            "bounds": [float(staff.min_x), float(staff.min_y), float(staff.max_x), float(staff.max_y)],
            "symbolCount": len(centers), "supportBoundsX": [float(support_left), float(support_right)],
            "supportWidthFraction": float(support_width / width),
            "leftInsetFraction": float((support_left - left) / width),
            "reason": "detached-single-staff-with-short-far-inset-symbol-support",
            "certainty": "possible-auxiliary-example-review-required",
        })
    audit["outputSystems"] = len(kept)
    return kept, audit

