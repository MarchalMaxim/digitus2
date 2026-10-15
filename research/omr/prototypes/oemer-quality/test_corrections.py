import unittest
import cv2
import numpy as np
from corrections import hollow_evidence, metronome_evidence

class Topology(unittest.TestCase):
    def glyph(self,hollow=True,line=False):
        image=np.full((60,80,3),255,np.uint8)
        cv2.ellipse(image,(30,30),(11,7),-20,0,360,(0,0,0),2 if hollow else -1)
        if line:cv2.line(image,(10,30),(50,30),(0,0,0),1)
        return image
    def test_hollow_and_staff_crossing_remain_hollow(self):
        for crossing in (False,True):
            self.assertTrue(hollow_evidence(self.glyph(line=crossing),(16,19,45,42))["accepted"])
    def test_solid_not_promoted(self):
        self.assertFalse(hollow_evidence(self.glyph(False),(16,19,45,42))["accepted"])
    def test_open_white_background_not_hole(self):
        image=self.glyph()
        image[19:42,29:33]=255
        self.assertFalse(hollow_evidence(image,(16,19,45,42))["accepted"])
    def test_tiny_pinhole_not_half_note(self):
        image=self.glyph(False)
        image[29,30]=255
        self.assertFalse(hollow_evidence(image,(16,19,45,42))["accepted"])
    def equation(self,equals=True,digits=True):
        image=np.full((150,220,3),255,np.uint8)
        cv2.ellipse(image,(30,30),(9,6),0,0,360,(0,0,0),-1)
        if equals:
            cv2.line(image,(55,24),(68,24),(0,0,0),2)
            cv2.line(image,(55,31),(68,31),(0,0,0),2)
        if digits:cv2.putText(image,"80",(75,35),cv2.FONT_HERSHEY_SIMPLEX,.55,(0,0,0),1)
        return image
    def test_header_equation_is_metronome(self):
        self.assertTrue(metronome_evidence(self.equation(),(20,23,41,38),90,16)["accepted"])
    def test_high_ledger_note_without_equation_is_preserved(self):
        self.assertFalse(metronome_evidence(self.equation(False),(20,23,41,38),90,16)["accepted"])
    def test_equals_without_number_is_unresolved(self):
        self.assertFalse(metronome_evidence(self.equation(digits=False),(20,23,41,38),90,16)["accepted"])
    def test_note_in_staff_not_removed(self):
        self.assertFalse(metronome_evidence(self.equation(),(20,23,41,38),40,16)["accepted"])
if __name__=="__main__":unittest.main()
