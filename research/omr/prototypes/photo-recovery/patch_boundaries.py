"""Patch decoder crop isolation in an explicitly prepared HOMR source copy."""
from pathlib import Path
import argparse,difflib,hashlib

p=argparse.ArgumentParser(description=__doc__);p.add_argument('source',type=Path);a=p.parse_args()
module=a.source/'homr/staff_parsing.py';before=module.read_text(encoding='utf-8')
needle='    before_canvas_shape = staff_image.shape'
if before.count(needle)!=1:raise ValueError('Unexpected upstream staff crop; no patch applied')
after=before.replace('import math\n','import math\nimport json\n',1)
after=after.replace('from homr.debug import Debug\n','from homr.debug import Debug\nfrom homr.foreign_staff import mask_foreign_staves\n',1)
replacement='''    if staff.is_grandstaff:
        mapped_staff = _dewarp_staff(staff, dewarp, top_left, scaling_factor)
        staff_image, margin_audit = mask_foreign_staves(
            staff_image, mapped_staff.max_y, float(np.median([
                gap for point in mapped_staff.grid for gap in np.diff(point.y)
            ]))
        )
        margin_audit.update({"coordinateSpace": "dewarped-staff-crop-before-canvas",
                             "staffBottom": float(mapped_staff.max_y),
                             "staffSpacing": float(np.median([
                                 gap for point in mapped_staff.grid for gap in np.diff(point.y)
                             ])),
                             "imageShape": list(staff_image.shape)})
        with open(debug.base_filename + f"_foreign-staff-{index}.json", "w") as audit_file:
            json.dump(margin_audit, audit_file, indent=2)
    before_canvas_shape = staff_image.shape'''
after=after.replace(needle,replacement,1);module.write_text(after,encoding='utf-8',newline='\r\n')
helper=Path(__file__).with_name('foreign_staff.py')
(a.source/'homr/foreign_staff.py').write_text(helper.read_text(encoding='utf-8'),encoding='utf-8',newline='\r\n')
diff=''.join(difflib.unified_diff(before.splitlines(keepends=True),after.splitlines(keepends=True),fromfile='a/homr/staff_parsing.py',tofile='b/homr/staff_parsing.py'))
diff+=''.join(difflib.unified_diff([],helper.read_text(encoding='utf-8').splitlines(keepends=True),fromfile='/dev/null',tofile='b/homr/foreign_staff.py'))
retained=Path(__file__).with_name('upstream-boundaries.patch').read_text(encoding='utf-8')
if retained != diff:raise ValueError('Generated boundary patch differs from the retained upstream diff')
print(hashlib.sha256(diff.encode()).hexdigest())
