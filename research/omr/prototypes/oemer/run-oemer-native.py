import os
os.environ['MPLBACKEND']='Agg'
os.environ['OMP_NUM_THREADS']='4'
import pathlib,sys,pickle,shutil,time,json,argparse
root=pathlib.Path(__file__).resolve().parent
sys.path.insert(0,str(root/'source'))
# Allow only the inspected sklearn SVC and NumPy value constructors.
class Restricted(pickle.Unpickler):
    def find_class(self,module,name):
        allowed={('sklearn.svm._classes','SVC'),('numpy.core.multiarray','_reconstruct'),('numpy._core.multiarray','_reconstruct'),('numpy','ndarray'),('numpy','dtype'),('numpy.core.multiarray','scalar'),('numpy._core.multiarray','scalar')}
        if (module,name) not in allowed:raise pickle.UnpicklingError(f'forbidden global {module}.{name}')
        return super().find_class(module,name)
pickle.load=lambda f,**kwargs:Restricted(f).load()
import onnxruntime as ort
original=ort.InferenceSession
def cpu_session(path,**kwargs):
    options=ort.SessionOptions(); options.intra_op_num_threads=4;options.inter_op_num_threads=1
    return original(path,sess_options=options,providers=['CPUExecutionProvider'])
ort.InferenceSession=cpu_session
import cv2
original_hough=cv2.HoughLinesP
def compatible_hough(*args,**kwargs):
    lines=original_hough(*args,**kwargs)
    return None if lines is None else lines.reshape(-1,1,4)
cv2.HoughLinesP=compatible_hough
from oemer.ete import extract
piece=sys.argv[1] if len(sys.argv)>1 else 'twinkle-twinkle-little-star'
work=root/'native'/piece
work.mkdir(parents=True,exist_ok=True)
fixture=root.parent/'fixtures-final'/piece/'page-001-clean.png'
image=work/(piece+'.png');shutil.copyfile(fixture,image)
start=time.perf_counter()
args=argparse.Namespace(img_path=str(image),output_path=str(work/(piece+'.musicxml')),use_tf=False,save_cache=True,without_deskew=True)
try:
    output=extract(args)
    result={'piece':piece,'elapsedSeconds':time.perf_counter()-start,'output':str(output),'status':'exported'}
except Exception as e:
    import traceback;traceback.print_exc()
    result={'piece':piece,'elapsedSeconds':time.perf_counter()-start,'error':str(e),'status':'failed'}
(root/('native-'+piece+'.json')).write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2),flush=True)
