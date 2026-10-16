"""Mask a detached foreign five-line staff inside a decoder's lower margin.

Only long, mutually overlapping, evenly spaced lines entirely below the selected
staff are eligible. This removes a neighbouring staff's ink from a single-staff
model crop, rather than changing notes or trimming every lower ledger margin.
"""
from __future__ import annotations
import itertools
import cv2
import numpy as np


def mask_foreign_staves(image, staff_bottom: float, unit: float):
    audit={'profile':'detached-smaller-five-line-decoder-margin-v1','removed':[]}
    if image.ndim!=2 or not np.isfinite([staff_bottom,unit]).all() or unit<=0:
        raise ValueError('Expected grayscale staff image and finite positive staff spacing')
    h,w=image.shape
    start=max(0,int(np.ceil(staff_bottom+0.5*unit)))
    if h-start<2*unit:
        return image,audit
    background=cv2.dilate(image,cv2.getStructuringElement(cv2.MORPH_RECT,(max(7,int(unit*3))|1,)*2))
    normalized=cv2.divide(image,background,scale=255)
    dark=(normalized<170).astype(np.uint8)*255
    horizontal=cv2.morphologyEx(dark,cv2.MORPH_OPEN,cv2.getStructuringElement(cv2.MORPH_RECT,(max(12,int(w*.035)),1)))
    horizontal[:start]=0
    count,_,stats,_=cv2.connectedComponentsWithStats(horizontal)
    lines=[]
    for x,y,width,height,area in stats[1:]:
        if width>=w*.15 and height<=max(3,unit*1.5) and area/width>=.5:
            lines.append((float(y+height/2),int(x),int(x+width),int(y),int(y+height)))
    lines.sort()
    # At most the narrow lower margin is examined; cap pathological noisy pages.
    if len(lines)>16:
        audit['heldReason']='ambiguous-margin-lines'
        return image,audit
    candidates=[]
    for group in itertools.combinations(lines,5):
        centers=np.array([line[0] for line in group]);gaps=np.diff(centers);spacing=float(np.median(gaps))
        if not .5*unit<=spacing<=.95*unit or np.max(abs(gaps-spacing))>spacing*.35:
            continue
        left=max(line[1] for line in group);right=min(line[2] for line in group)
        if right-left<w*.15:
            continue
        widths=[line[2]-line[1] for line in group]
        if (right-left)/max(widths)<.6:
            continue
        # A full-width neighbour can be a subsequent system; preserve it rather
        # than silently deciding the page reading order here.
        if right-left>w*.65:
            continue
        candidates.append((spacing,group,left,right))
    result=image.copy()
    occupied=[]
    for spacing,group,left,right in candidates:
        top=max(int(np.ceil(staff_bottom+unit)),int(group[0][0]-1.5*spacing))
        bottom=min(h,int(np.ceil(group[-1][0]+2*spacing)))
        x0=max(0,min(line[1] for line in group)-int(2*spacing))
        x1=min(w,max(line[2] for line in group)+int(2*spacing))
        if top>=bottom or any(abs(group[0][0]-old)<3*spacing for old in occupied):
            continue
        occupied.append(group[0][0])
        result[top:bottom,x0:x1]=255
        audit['removed'].append({'bounds':[x0,top,x1,bottom],'staffLineCenters':[line[0] for line in group],
                                 'spacing':spacing,'reason':'detached-narrow-five-line-staff-in-lower-decoder-margin',
                                 'needsReview':True})
    return result,audit
