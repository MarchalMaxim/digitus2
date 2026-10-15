"""Assemble real browser-generated segmentation labels into raw MusicXML.

Executed only inside research Pyodide. No pickle or native inference cache.
"""
import argparse
import json
import os
import pickle
import sys
import time

os.environ['MPLBACKEND'] = 'Agg'
sys.path.insert(0, '/home/pyodide')

import cv2
import numpy as np
from PIL import Image
from sklearn.svm import SVC
import oemer.inference as inference

models = {}
for name in ['clef', 'rests', 'rests_above8', 'sfn']:
    with open('/safe/' + name + '.json') as stream:
        info = json.load(stream)
    model = SVC()
    model.__dict__.update(info['svc'])
    with np.load('/safe/' + name + '.npz', allow_pickle=False) as arrays:
        model.__dict__.update({key: arrays[key] for key in arrays.files})
    models[name] = (model, info['metadata'])


def predict(region, model_name):
    if np.max(region) == 1:
        region *= 255
    model, metadata = models[model_name]
    region = np.array(Image.fromarray(region.astype(np.uint8)).resize(
        (metadata['w'], metadata['h'])))
    predicted = model.predict(region.reshape(1, -1))
    return metadata['class_map'][str(predicted[0])]


inference.predict = predict
original_hough = cv2.HoughLinesP


def compatible_hough(*args, **kwargs):
    lines = original_hough(*args, **kwargs)
    return None if lines is None else lines.reshape(-1, 1, 4)


cv2.HoughLinesP = compatible_hough
from oemer import ete

# image_height/image_width come from the actual input's browser preprocessing.
with open('/work/staff-labels.bin', 'rb') as stream:
    labels = np.frombuffer(stream.read(), dtype=np.uint8).reshape(
        (image_height, image_width))
with open('/work/symbol-labels.bin', 'rb') as stream:
    labels2 = np.frombuffer(stream.read(), dtype=np.uint8).reshape(
        (image_height, image_width))
masks = {
    'staff': np.where(labels == 1, 1, 0),
    'symbols': np.where(labels == 2, 1, 0),
    'stems_rests': np.where(labels2 == 1, 1, 0),
    'note': np.where(labels2 == 2, 1, 0),
    'clefs_keys': np.where(labels2 == 3, 1, 0),
}
ete.generate_pred = lambda *args, **kwargs: (
    masks['staff'], masks['symbols'], masks['stems_rests'], masks['note'],
    masks['clefs_keys'])


def no_pickle(*args, **kwargs):
    raise RuntimeError('Pickle is disabled in the browser prototype')


pickle.load = no_pickle
start = time.perf_counter()
arguments = argparse.Namespace(
    img_path='/work/input.png', output_path='/work/result.musicxml',
    use_tf=False, save_cache=False, without_deskew=True)
ete.extract(arguments)
browser_reconstruction_seconds = time.perf_counter() - start
