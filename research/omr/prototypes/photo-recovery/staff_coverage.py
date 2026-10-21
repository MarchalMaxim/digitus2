"""Let a staff found by its lines alone replace a partial staff it completes.

homr's line tracking can break a staff in two when its clef is missed. The
duplicate filter then keeps only the part with more anchors, and the decoder
never sees the rest of the system. The staffs homr finds by their lines alone
are added only where no staff is yet, so the complete staff was discarded too.
Here such a staff replaces the one staff it overlaps when it contains it, the
partial staff spans clearly less of the page's column, and four of the five
lines agree within half a staff space. The line check keeps out the shifted
copies that lines shining through the paper create.
"""
from __future__ import annotations

PARTIAL_SHARE = 0.75
LINES_THAT_AGREE = 4


def _completes(partial, candidate, column, unit_size, line_y) -> bool:
    if candidate.min_x > partial.min_x + unit_size or candidate.max_x < partial.max_x - unit_size:
        return False
    if partial.max_x - partial.min_x >= PARTIAL_SHARE * (column[1] - column[0]):
        return False
    x = (max(partial.min_x, candidate.min_x) + min(partial.max_x, candidate.max_x)) / 2
    agree = sum(
        abs(line_y(mine, x) - line_y(theirs, x)) <= unit_size / 2
        for mine, theirs in zip(partial.lines, candidate.lines, strict=True)
    )
    return agree >= LINES_THAT_AGREE


def add_staffs_without_clef(staffs, candidates, column, unit_size, line_y):
    """
    The staffs with the candidates added where no staff is yet, and a candidate in place
    of the one partial staff it completes. Returns the staffs and the (partial, candidate)
    pairs replaced.
    """
    result = list(staffs)
    replaced = []
    for candidate in candidates:
        overlapping = [s for s in staffs if candidate.is_overlapping(s)]
        if not overlapping:
            result.append(candidate)
        elif len(overlapping) == 1 and overlapping[0] in result and _completes(
            overlapping[0], candidate, column, unit_size, line_y
        ):
            result[result.index(overlapping[0])] = candidate
            replaced.append((overlapping[0], candidate))
    return result, replaced
