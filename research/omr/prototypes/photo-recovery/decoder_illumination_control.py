"""Matched decoder-only illumination control on retained real staff crops.

Does not alter notation, invoke segmentation, or manufacture MusicXML.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--clip-bottom', type=int)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    os.environ['OMP_NUM_THREADS'] = '4'
    sys.path.insert(0, str(args.source.resolve()))
    import cv2
    import numpy as np
    from homr.transformer.configs import Config
    from homr.transformer.staff2score import Staff2Score
    image = cv2.imread(str(args.input), cv2.IMREAD_GRAYSCALE)
    if image is None or image.shape != (256, 1280):
        raise ValueError('Expected retained 256x1280 real decoder input')
    background = cv2.GaussianBlur(cv2.dilate(image, cv2.getStructuringElement(cv2.MORPH_RECT, (31,31))), (0,0), 12)
    normalized = cv2.divide(image, background, scale=255)
    if args.clip_bottom is not None:
        normalized = image.copy()
        normalized[args.clip_bottom:, :] = 255
    cv2.imwrite(str(args.output/'normalized.png'), normalized)
    config = Config()
    config.use_gpu_inference = False
    config.use_coreml_encoder = False
    model = Staff2Score(config)
    results = {'sourceImage':str(args.input.resolve()), 'sha256':hashlib.sha256(args.input.read_bytes()).hexdigest(), 'operations':(['diagnostic decoder-canvas clip below row '+str(args.clip_bottom),'retains original canvas scale and all pixels above boundary'] if args.clip_bottom is not None else ['local paper-background estimate: dilation31px,Gaussian12px','divide illumination; no geometric/notation modification']), 'runs':[]}
    for name, pixels in [('retained-jpeg-control',image), ('normalized',normalized)]:
        start=time.monotonic()
        symbols=model.predict(pixels)
        tokens=[{key:getattr(s,key) for key in ['rhythm','pitch','lift','articulation','slur','position']} for s in symbols]
        import xml.etree.ElementTree as ET
        from homr.music_xml_generator import generate_xml, XmlGeneratorArguments
        xml=generate_xml(XmlGeneratorArguments(),[symbols],'')
        ET.ElementTree(xml).write(args.output/(name+'.musicxml'),encoding='unicode',xml_declaration=True)
        results['runs'].append({'name':name,'seconds':time.monotonic()-start,'tokens':tokens})
    (args.output/'result.json').write_text(json.dumps(results,indent=2))
    print(json.dumps({r['name']:{'seconds':r['seconds'],'tokens':len(r['tokens'])} for r in results['runs']},indent=2))

if __name__ == '__main__':
    main()
