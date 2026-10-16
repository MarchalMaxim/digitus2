import json
import os
from pathlib import Path
from homr.main import ProcessingConfig, detect_staffs_in_image
for name in ("sharper-original", "smaller-original"):
    job=Path("research/omr/results/photo-options")/name
    config=ProcessingConfig(False, True, False, False, -1, False, False, False, False)
    rows,*_=detect_staffs_in_image(str(job/"original.jpeg"),config)
    items=[]
    for row in rows:
        members=[]
        for staff in row.staffs:
            spacing=[]
            for point in staff.grid:
                for first in range(0,len(point.y),5):
                    spacing.extend(point.y[i+1]-point.y[i] for i in range(first,min(first+4,len(point.y)-1)))
            import statistics
            members.append({"grand":staff.is_grandstaff,"x":[staff.min_x,staff.max_x],"y":[staff.min_y,staff.max_y],"spacing":statistics.median(spacing),"symbols":[{"type":type(s).__name__,"center":list(s.center)} for s in staff.symbols],"grid":[{"x":p.x,"y":p.y} for p in staff.grid]})
        items.append({"connections":len(row.connections),"staffs":members})
    (job/"detected-geometry.json").write_text(json.dumps(items,indent=2))
    print(name, [{**s,"grid":len(s["grid"]),"symbols":len(s["symbols"]),"supportX":[min((p["center"][0] for p in s["symbols"]), default=None),max((p["center"][0] for p in s["symbols"]), default=None)]} for row in items for s in row["staffs"]])

