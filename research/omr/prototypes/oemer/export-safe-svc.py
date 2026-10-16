import pathlib,pickle,json,numpy as np
root=pathlib.Path(__file__).resolve().parent
class Restricted(pickle.Unpickler):
    def find_class(self,module,name):
        allowed={('sklearn.svm._classes','SVC'),('numpy.core.multiarray','_reconstruct'),('numpy._core.multiarray','_reconstruct'),('numpy','ndarray'),('numpy','dtype'),('numpy.core.multiarray','scalar'),('numpy._core.multiarray','scalar')}
        if (module,name) not in allowed:raise pickle.UnpicklingError((module,name))
        return super().find_class(module,name)
out=root/'safe-svc';out.mkdir(exist_ok=True)
for file in (root/'source/oemer/sklearn_models').glob('*.model'):
    with file.open('rb') as stream:info=Restricted(stream).load()
    model=info.pop('model');arrays={};scalars={}
    for key,value in model.__dict__.items():
        if isinstance(value,np.ndarray):arrays[key]=value
        elif isinstance(value,np.generic):scalars[key]=value.item()
        elif isinstance(value,(str,int,float,bool,type(None),dict,tuple,list)):scalars[key]=value
        else:raise TypeError((key,type(value)))
    np.savez_compressed(out/(file.stem+'.npz'),**arrays)
    (out/(file.stem+'.json')).write_text(json.dumps({'metadata':info,'svc':scalars},indent=2))
    # Data-only roundtrip proof with same class implementation.
    from sklearn.svm import SVC
    copied=SVC();copied.__dict__.update(json.loads((out/(file.stem+'.json')).read_text())['svc'])
    with np.load(out/(file.stem+'.npz'),allow_pickle=False) as data:copied.__dict__.update({k:data[k] for k in data.files})
    probes=np.stack([np.zeros(model.n_features_in_),np.full(model.n_features_in_,255)])
    assert np.array_equal(model.predict(probes),copied.predict(probes))
    print(file.name,'safe-data export and roundtrip passed')
