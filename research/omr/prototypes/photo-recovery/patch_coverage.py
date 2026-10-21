"""Let a staff found by its lines alone replace a partial staff, in an explicitly prepared HOMR source copy."""
from pathlib import Path
import argparse,difflib,hashlib

p=argparse.ArgumentParser(description=__doc__);p.add_argument('source',type=Path)
p.add_argument('--write-patch',action='store_true',help='write the retained diff instead of checking it')
a=p.parse_args()
module=a.source/'homr/staff_detection.py';before=module.read_text(encoding='utf-8')
edits=[
    ('from homr.simple_logging import eprint\n',
     'from homr.simple_logging import eprint\nfrom homr.staff_coverage import add_staffs_without_clef\n'),
    ('''    if len(raw_staffs) == 0 or len(clef_anchors) == 0:
        return []
''','''    if len(raw_staffs) == 0 or len(clef_anchors) == 0:
        return raw_staffs
'''),
    ('''    return [
        c
        for c in candidates
        if c.max_x - c.min_x >= min_width
        and _share_in_column(c.min_x, c.max_x, column) >= 0.9
        and not any(c.is_overlapping(s) for s in raw_staffs)
    ]
''','''    eligible = [
        c
        for c in candidates
        if c.max_x - c.min_x >= min_width and _share_in_column(c.min_x, c.max_x, column) >= 0.9
    ]
    staffs, replaced = add_staffs_without_clef(
        raw_staffs, eligible, column, unit_size, _extrapolated_line_y
    )
    for partial, staff in replaced:
        eprint(
            f"Replaced a partial staff at x {partial.min_x:.0f}-{partial.max_x:.0f}"
            f" with one at x {staff.min_x:.0f}-{staff.max_x:.0f}"
        )
    return staffs
'''),
    ('''    staffs_without_clef = find_staffs_without_clef(raw_staffs, clef_anchors, staff_fragments, image)
    if len(staffs_without_clef) > 0:
        eprint("Found " + str(len(staffs_without_clef)) + " staffs without clef")
    raw_staffs.extend(staffs_without_clef)
''','''    number_of_staffs = len(raw_staffs)
    raw_staffs = find_staffs_without_clef(raw_staffs, clef_anchors, staff_fragments, image)
    if len(raw_staffs) > number_of_staffs:
        eprint("Found " + str(len(raw_staffs) - number_of_staffs) + " staffs without clef")
'''),
]
after=before
for needle,replacement in edits:
    if after.count(needle)!=1:raise ValueError('Unexpected upstream staff detection; no patch applied')
    after=after.replace(needle,replacement,1)
module.write_text(after,encoding='utf-8',newline='\r\n')
helper=Path(__file__).with_name('staff_coverage.py')
(a.source/'homr/staff_coverage.py').write_text(helper.read_text(encoding='utf-8'),encoding='utf-8',newline='\r\n')
diff=''.join(difflib.unified_diff(before.splitlines(keepends=True),after.splitlines(keepends=True),fromfile='a/homr/staff_detection.py',tofile='b/homr/staff_detection.py'))
diff+=''.join(difflib.unified_diff([],helper.read_text(encoding='utf-8').splitlines(keepends=True),fromfile='/dev/null',tofile='b/homr/staff_coverage.py'))
retained_path=Path(__file__).with_name('upstream-coverage.patch')
if a.write_patch:retained_path.write_text(diff,encoding='utf-8',newline='\n')
if retained_path.read_text(encoding='utf-8') != diff:raise ValueError('Generated coverage patch differs from the retained upstream diff')
print(hashlib.sha256(diff.encode()).hexdigest())
