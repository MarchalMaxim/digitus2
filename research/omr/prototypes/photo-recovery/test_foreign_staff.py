"""Independent geometric invariants for foreign-staff decoder masking."""
import cv2
import numpy as np
import pytest
from foreign_staff import mask_foreign_staves


def page(lines=5, full_width=False):
    im=np.full((260,800),255,np.uint8)
    # Main grand staff ends at180. A genuine ledger-note cluster is retained left.
    for y in range(60,101,10):cv2.line(im,(20,y),(780,y),0,2)
    for y in range(140,181,10):cv2.line(im,(20,y),(780,y),0,2)
    cv2.line(im,(100,202),(125,202),0,2);cv2.ellipse(im,(112,200),(6,4),0,0,360,0,-1)
    for i in range(lines):cv2.line(im,((20 if full_width else 480),210+8*i),(780,210+8*i),0,2)
    return im


def test_mask_is_only_detached_narrow_five_line_region():
    before=page();after,audit=mask_foreign_staves(before,180,10)
    assert len(audit['removed'])==1
    x0,y0,x1,y1=audit['removed'][0]['bounds']
    assert y0>180 and x0>400
    assert np.array_equal(after[:190],before[:190])
    assert np.array_equal(after[:,0:400],before[:,0:400])
    assert np.all(after[y0:y1,x0:x1]==255)
    assert np.any(before[y0:y1,x0:x1]<100)


def test_four_ledger_lines_are_not_a_foreign_staff():
    before=page(lines=4);after,audit=mask_foreign_staves(before,180,10)
    assert not audit['removed'];assert np.array_equal(before,after)


def test_full_width_next_system_is_not_silently_removed():
    before=page(full_width=True);after,audit=mask_foreign_staves(before,180,10)
    assert not audit['removed'];assert np.array_equal(before,after)


def test_arbitrary_margin_noise_is_not_a_staff():
    rng=np.random.default_rng(42);before=page(lines=0)
    before[195:]=rng.integers(150,256,before[195:].shape,dtype=np.uint8)
    after,audit=mask_foreign_staves(before,180,10)
    assert not audit['removed'];assert np.array_equal(before,after)


def test_resolution_scaling_preserves_five_line_decision():
    before=page();large=cv2.resize(before,None,fx=2,fy=2,interpolation=cv2.INTER_NEAREST)
    _,audit=mask_foreign_staves(large,360,20)
    assert len(audit['removed'])==1
    assert audit['removed'][0]['bounds'][1]>360


def test_no_lower_margin_is_unchanged():
    before=page();after,audit=mask_foreign_staves(before,255,10)
    assert not audit['removed'];assert np.array_equal(before,after)


@pytest.mark.parametrize('bottom,unit',[(float('nan'),10),(180,0),(180,-1)])
def test_invalid_geometry_is_rejected(bottom,unit):
    with pytest.raises(ValueError):mask_foreign_staves(page(),bottom,unit)


def test_five_long_ledger_lines_at_main_staff_spacing_are_preserved():
    before=page(lines=0)
    for y in range(200,241,10):
        cv2.line(before,(480,y),(780,y),0,2)
        cv2.ellipse(before,(600,y),(7,4),0,0,360,0,-1)
    after,audit=mask_foreign_staves(before,180,10)
    assert not audit['removed']
    assert np.array_equal(before,after)


def test_dense_margin_is_held_without_combinatorial_search():
    before=np.full((500,800),255,np.uint8)
    for y in range(210,400,9):cv2.line(before,(480,y),(780,y),0,2)
    after,audit=mask_foreign_staves(before,180,10)
    assert audit['heldReason']=='ambiguous-margin-lines'
    assert not audit['removed']
    assert np.array_equal(before,after)
