"""Image-evidence corrections; no score IDs, reference XML or inferred meter."""
import cv2
import numpy as np


def enclosed_white_areas(image, box):
    x1, y1, x2, y2 = map(int, box)
    gray = cv2.cvtColor(image[y1:y2, x1:x2], cv2.COLOR_BGR2GRAY)
    if not gray.size:
        return []
    white = np.uint8(gray > 180)
    count, _, stats, _ = cv2.connectedComponentsWithStats(white, 8)
    return [int(area) for x, y, w, h, area in stats[1:]
            if x > 0 and y > 0 and x+w < white.shape[1] and y+h < white.shape[0]]


def hollow_evidence(image, box):
    x1, y1, x2, y2 = box
    area = (x2-x1)*(y2-y1)
    holes = enclosed_white_areas(image, box)
    valid = [x for x in holes if x >= max(3, area*.04)]
    return {"accepted":bool(valid and sum(valid) >= area*.10),
            "enclosedWhiteAreas":holes, "boxArea":int(area)}


def metronome_evidence(image, box, staff_top, unit):
    x1, y1, x2, y2 = map(int, box)
    rejected = {"accepted":False}
    if y2 >= staff_top-unit or unit < 3:
        return rejected
    left, right = x2, min(image.shape[1], int(x2+9*unit))
    top, bottom = max(0,int(y1-2*unit)), min(image.shape[0],int(y2+unit))
    gray = cv2.cvtColor(image[top:bottom,left:right],cv2.COLOR_BGR2GRAY)
    _, _, stats, _ = cv2.connectedComponentsWithStats(np.uint8(gray<120),8)
    strokes = []
    components = []
    for x,y,w,h,area in stats[1:]:
        item = (int(x+left),int(y+top),int(w),int(h),int(area))
        components.append(item)
        if .45*unit <= w <= 2*unit and h <= .30*unit and w >= 2*h:
            strokes.append(item)
    candidates=[]
    for a in strokes:
        for b in strokes:
            if a[1]>=b[1]:
                continue
            overlap=max(0,min(a[0]+a[2],b[0]+b[2])-max(a[0],b[0]))
            gap=b[1]-(a[1]+a[3])
            if overlap < .75*max(a[2],b[2]) or not .12*unit <= gap <= .75*unit:
                continue
            end=max(a[0]+a[2],b[0]+b[2])
            digits=[c for c in components if end < c[0] < end+4*unit
                    and .55*unit <= c[3] <= 1.8*unit and .15*unit <= c[2] <= 1.5*unit
                    and abs((c[1]+c[3]/2)-(a[1]+b[1]+b[3])/2) <= .6*unit]
            if digits:
                candidates.append({"equalsStrokes":[a,b],"followingGlyphs":digits})
    if len(candidates)!=1:
        return {**rejected,"candidateCount":len(candidates)}
    return {"accepted":True,**candidates[0]}


def apply(notes, image, staffs, note_types):
    changes=[]
    retained=[]
    for note in notes:
        staff_candidates=[s for s in np.asarray(staffs,dtype=object).flat
                          if s.group==note.group and s.track==note.track]
        if note.track==0 and staff_candidates:
            staff=min(staff_candidates,key=lambda s:abs(s.x_center-(note.bbox[0]+note.bbox[2])/2))
            evidence=metronome_evidence(image,note.bbox,staff.y_upper,staff.unit_size)
            if evidence["accepted"]:
                changes.append({"kind":"exclude-metronome-glyph","box":list(map(int,note.bbox)),"evidence":evidence})
                continue
        if note.label is None:
            evidence=hollow_evidence(image,note.bbox)
            if evidence["accepted"]:
                note.label=note_types.HALF_OR_WHOLE
                changes.append({"kind":"restore-hollow-notehead","box":list(map(int,note.bbox)),"evidence":evidence})
        retained.append(note)
    return retained,changes
