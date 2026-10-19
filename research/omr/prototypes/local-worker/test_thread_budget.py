"""Thread budget detection and the ONNX Runtime and OpenCV patch, with fake libraries."""
import os
import sys
import types
import pytest
import thread_budget

def test_the_environment_variable_wins(tmp_path):
    (tmp_path/"cpu.max").write_text("400000 100000\n")
    assert thread_budget.detect({"DIGITUS2_OMR_THREADS":"2"},tmp_path,affinity={0}) == 2

def test_a_non_positive_variable_is_ignored(tmp_path,monkeypatch):
    monkeypatch.setattr(os,"cpu_count",lambda:4)
    assert thread_budget.detect({"DIGITUS2_OMR_THREADS":"0"},tmp_path,affinity={0,1,2,3}) is None

def test_cgroup_v2_quota(tmp_path):
    (tmp_path/"cpu.max").write_text("400000 100000\n")
    assert thread_budget.detect({},tmp_path,affinity={0}) == 4

def test_cgroup_v2_without_quota(tmp_path,monkeypatch):
    monkeypatch.setattr(os,"cpu_count",lambda:8)
    (tmp_path/"cpu.max").write_text("max 100000\n")
    assert thread_budget.detect({},tmp_path,affinity=set(range(8))) is None

def test_cgroup_v1_quota_rounds_up(tmp_path):
    (tmp_path/"cpu").mkdir()
    (tmp_path/"cpu/cpu.cfs_quota_us").write_text("350000\n")
    (tmp_path/"cpu/cpu.cfs_period_us").write_text("100000\n")
    assert thread_budget.detect({},tmp_path,affinity={0}) == 4

def test_cgroup_v1_without_quota(tmp_path,monkeypatch):
    monkeypatch.setattr(os,"cpu_count",lambda:8)
    (tmp_path/"cpu").mkdir()
    (tmp_path/"cpu/cpu.cfs_quota_us").write_text("-1\n")
    (tmp_path/"cpu/cpu.cfs_period_us").write_text("100000\n")
    assert thread_budget.detect({},tmp_path,affinity=set(range(8))) is None

def test_a_smaller_affinity_is_the_budget(tmp_path,monkeypatch):
    monkeypatch.setattr(os,"cpu_count",lambda:16)
    assert thread_budget.detect({},tmp_path,affinity={0,1,2,3}) == 4

def test_windows_like_input_has_no_budget(tmp_path,monkeypatch):
    monkeypatch.setattr(os,"cpu_count",lambda:16)
    assert thread_budget.detect({},tmp_path/"absent",affinity=set(range(16))) is None

@pytest.fixture
def fakes(monkeypatch):
    class SessionOptions:
        def __init__(self):
            self.intra_op_num_threads=0
            self.inter_op_num_threads=0
    class InferenceSession:
        def __init__(self,path,sess_options=None,providers=None,**kwargs):
            self.path,self.sess_options,self.providers=path,sess_options,providers
    ort=types.ModuleType("onnxruntime")
    ort.SessionOptions,ort.InferenceSession=SessionOptions,InferenceSession
    cv2=types.ModuleType("cv2")
    cv2.threads=[]
    cv2.setNumThreads=cv2.threads.append
    monkeypatch.setitem(sys.modules,"onnxruntime",ort)
    monkeypatch.setitem(sys.modules,"cv2",cv2)
    return ort,cv2

def test_apply_sizes_sessions_without_options(fakes):
    ort,cv2=fakes
    thread_budget.apply(4)
    session=ort.InferenceSession("model.onnx",providers=["CPUExecutionProvider"])
    assert session.sess_options.intra_op_num_threads == 4
    assert session.sess_options.inter_op_num_threads == 1
    assert session.providers == ["CPUExecutionProvider"]
    assert cv2.threads == [4]

def test_apply_leaves_a_callers_options_alone(fakes):
    ort,_=fakes
    thread_budget.apply(4)
    own=ort.SessionOptions()
    own.intra_op_num_threads=7
    assert ort.InferenceSession("model.onnx",own).sess_options is own
    assert own.intra_op_num_threads == 7 and own.inter_op_num_threads == 0

def test_apply_twice_does_not_double_wrap(fakes):
    ort,_=fakes
    thread_budget.apply(4)
    wrapped=ort.InferenceSession
    thread_budget.apply(4)
    assert ort.InferenceSession is wrapped
    assert ort.InferenceSession.__mro__[2] is object
