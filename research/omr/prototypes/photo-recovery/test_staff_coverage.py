"""The rule that lets a staff found by its lines alone replace a partial staff (issue 129)."""
from staff_coverage import add_staffs_without_clef

UNIT = 20.0
COLUMN = (100.0, 1800.0)


class Line:
    def __init__(self, y):
        self.y = y


class Staff:
    def __init__(self, min_x, max_x, top, shift=0.0, off_lines=()):
        self.min_x, self.max_x = min_x, max_x
        self.lines = [Line(top + i * UNIT + (UNIT if i in off_lines else 0) + shift) for i in range(5)]
        self.min_y, self.max_y = self.lines[0].y, self.lines[-1].y

    def is_overlapping(self, other):
        return (self.min_x < other.max_x and other.min_x < self.max_x
                and self.min_y < other.max_y and other.min_y < self.max_y)


def line_y(line, x):
    return line.y


def run(staffs, candidates):
    return add_staffs_without_clef(staffs, candidates, COLUMN, UNIT, line_y)


def test_a_full_staff_replaces_the_right_half_it_contains():
    # Page 1 of Invention 13: the bass staff of the first system survived from x 932 only.
    partial = Staff(932, 1844, 562)
    full = Staff(139, 1844, 560)
    other = Staff(138, 1845, 377)
    result, replaced = run([other, partial], [full])
    assert result == [other, full]
    assert replaced == [(partial, full)]


def test_a_staff_without_overlap_is_added_as_before():
    existing = Staff(140, 1840, 300)
    new = Staff(140, 1840, 700)
    assert run([existing], [new]) == ([existing, new], [])


def test_a_shifted_shine_through_copy_never_replaces_a_staff():
    partial = Staff(932, 1844, 562)
    shifted = Staff(139, 1844, 562, shift=0.6 * UNIT)
    assert run([partial], [shifted]) == ([partial], [])


def test_a_staff_that_already_spans_most_of_the_column_stays():
    almost = Staff(450, 1844, 562)
    full = Staff(139, 1844, 562)
    assert run([almost], [full]) == ([almost], [])


def test_the_candidate_must_contain_the_partial_staff():
    left_part = Staff(100, 900, 562)
    right_part = Staff(700, 1844, 562)
    assert run([left_part], [right_part]) == ([left_part], [])


def test_a_candidate_touching_two_staffs_is_left_out():
    upper = Staff(932, 1844, 562)
    lower = Staff(932, 1844, 600)
    full = Staff(139, 1844, 580)
    assert run([upper, lower], [full]) == ([upper, lower], [])


def test_a_short_last_system_found_again_is_not_replaced():
    # Czerny Op. 821 No. 5: the last system really ends early, and the same staff is found again.
    short = Staff(167, 1278, 562)
    same = Staff(167, 1278, 562)
    assert run([short], [same]) == ([short], [])


def test_one_mistracked_line_is_tolerated():
    # The line tracking sometimes jumps to a neighbouring line on one of the five.
    partial = Staff(932, 1844, 562, off_lines=(4,))
    full = Staff(139, 1844, 562)
    result, replaced = run([partial], [full])
    assert result == [full] and replaced == [(partial, full)]


def test_two_mistracked_lines_are_not():
    partial = Staff(932, 1844, 562, off_lines=(3, 4))
    full = Staff(139, 1844, 562)
    assert run([partial], [full]) == ([partial], [])
