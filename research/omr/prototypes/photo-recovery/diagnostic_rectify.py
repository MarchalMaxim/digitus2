"""Bounded diagnostic crop with traced staff lines, no note/XML repair."""
from pathlib import Path
import cv2,numpy as np,json,hashlib,argparse
from scipy.ndimage import gaussian_filter1d
p=argparse.ArgumentParser();p.add_argument('image');p.add_argument('out');p.add_argument('--bounds',nargs=4,type=int,required=True);p.add_argument('--seeds',nargs='+',type=int,required=True);a=p.parse_args()
out=Path(a.out);out.mkdir(parents=True,exist_ok=False)
gray=cv2.imread(a.image,0);h,w=gray.shape
background=cv2.GaussianBlur(cv2.dilate(gray,cv2.getStructuringElement(cv2.MORPH_RECT,(31,31))),(0,0),12)
norm=cv2.divide(gray,background,scale=255);ink=255-norm
strength=cv2.morphologyEx(ink,cv2.MORPH_OPEN,cv2.getStructuringElement(cv2.MORPH_RECT,(25,1))).astype(float)/255
x0,y0,x1,y1=a.bounds;xs=np.arange(x0,x1,4);mid=len(xs)//2
paths=[]
for group in np.array(a.seeds).reshape(-1,5):
    seed=group[2]; spacing=float(np.median(np.diff(group)))
    ys=np.arange(max(y0+30,seed-60),min(y1-30,seed+61))
    costs=np.zeros((len(xs),len(ys))); spacings=np.zeros_like(costs)
    choices_d=np.arange(spacing-2,spacing+2.1,0.5)
    for i,x in enumerate(xs):
        column=strength[:,max(0,x-3):min(w,x+4)].mean(axis=1)
        comb=np.array([np.mean([np.interp(ys+k*d,np.arange(h),column) for k in range(-2,3)],axis=0) for d in choices_d])
        best=comb.argmax(axis=0);costs[i]=comb[best,np.arange(len(ys))];spacings[i]=choices_d[best]
    full=np.zeros(len(xs));full[mid]=seed
    for indices in [list(range(mid,len(xs))),list(range(mid,-1,-1))]:
        dp=np.full(len(ys),-1e6);dp[np.abs(ys-seed)<=1]=0
        backs=[]
        for ix in indices[1:]:
            choices=np.full((5,len(ys)),-1e6)
            for k,d in enumerate(range(-2,3)):
                previous=np.arange(len(ys))+d;valid=(previous>=0)&(previous<len(ys))
                choices[k,valid]=dp[previous[valid]]-0.12*d*d
            best=choices.argmax(axis=0);backs.append(np.arange(len(ys))+best-2)
            dp=choices[best,np.arange(len(ys))]+costs[ix]
        cur=int(dp.argmax())
        for ix,back in zip(indices[:0:-1],backs[::-1]):full[ix]=ys[cur];cur=int(back[cur])
    center=gaussian_filter1d(full,3)
    ds=gaussian_filter1d(np.array([spacings[i,int(np.argmin(abs(ys-y)))] for i,y in enumerate(center)]),5)
    for k in range(-2,3):paths.append(center+k*ds)
paths=np.array(paths)
assert np.min(np.diff(paths,axis=0))>5, "Crossing/nonmonotonic staff maps rejected"
# Flatten each staff's 5 actual traced lines, retaining measured middle-column gaps.
target=paths[:,mid]
# Enforce regular spacing from median, without supplying pitches/context.
for j in range(0,len(target),5):target[j:j+5]=target[j]+np.arange(5)*np.median(np.diff(target[j:j+5]))
mapx=np.tile(np.arange(x0,x1,dtype=np.float32),(y1-y0,1));mapy=np.zeros_like(mapx)
for i,x in enumerate(range(x0,x1)):
    anchors=np.array([np.interp(x,xs,line) for line in paths])
    mapy[:,i]=np.interp(np.arange(y0,y1),np.r_[y0,target,y1],np.r_[y0,anchors,y1])
rectified=cv2.remap(norm,mapx,mapy,cv2.INTER_CUBIC,borderMode=cv2.BORDER_CONSTANT,borderValue=255)
rectified=cv2.resize(rectified,None,fx=2,fy=2,interpolation=cv2.INTER_LANCZOS4)
rectified=cv2.copyMakeBorder(rectified,80,80,80,80,cv2.BORDER_CONSTANT,value=255)
cv2.imwrite(str(out/'prepared.png'),rectified)
meta={'source':str(Path(a.image).resolve()),'inputSha256':hashlib.sha256(Path(a.image).read_bytes()).hexdigest(),'cropBounds':a.bounds,'diagnosticManualSeeds':a.seeds,'targets':target.tolist(),'traces':paths.tolist(),'xs':xs.tolist(),'operations':['grayscale','local background division','staff-line dynamic-programming trace','piecewise-vertical staff flattening','2x Lanczos','white border80'],'outputSha256':hashlib.sha256((out/'prepared.png').read_bytes()).hexdigest()}
(out/'geometry.json').write_text(json.dumps(meta,indent=2))
