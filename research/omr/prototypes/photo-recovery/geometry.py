"""Staff-line geometry diagnostic. Original pixels remain untouched."""
from pathlib import Path
import cv2
import numpy as np
from scipy.signal import find_peaks
import json, argparse
p=argparse.ArgumentParser();p.add_argument('image');p.add_argument('out');a=p.parse_args()
out=Path(a.out);out.mkdir(parents=True,exist_ok=True)
gray=cv2.imread(a.image,0)
background=cv2.GaussianBlur(cv2.dilate(gray,cv2.getStructuringElement(cv2.MORPH_RECT,(31,31))),(0,0),12)
norm=cv2.divide(gray,background,scale=255)
ink=255-norm
lines=cv2.morphologyEx(ink,cv2.MORPH_OPEN,cv2.getStructuringElement(cv2.MORPH_RECT,(25,1)))
cv2.imwrite(str(out/'lines.png'),lines)
# Middle-left avoids most right-aligned alternative staves; no music-specific coordinates.
x=gray.shape[1]//2
profile=lines[:,x-20:x+20].mean(axis=1)
peaks,_=find_peaks(profile,prominence=20,distance=5)
print([(int(y),round(float(profile[y]),1)) for y in peaks])
(out/'peaks.json').write_text(json.dumps({'shape':gray.shape,'x':x,'peaks':[(int(y),float(profile[y])) for y in peaks]},indent=2))
