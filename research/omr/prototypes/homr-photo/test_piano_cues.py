"""Geometry boundary tests; no recognizer, private image or XML involved."""
import unittest
from dataclasses import dataclass, field
from piano_cues import select_piano_systems

@dataclass
class Symbol:
    center: tuple

@dataclass
class Staff:
    is_grandstaff: bool
    min_x: float
    max_x: float
    min_y: float
    max_y: float
    symbols: list = field(default_factory=list)

@dataclass
class Row:
    staffs: list
    connections: list = field(default_factory=list)

def grand(y):
    return Row([Staff(True,100,1100,y,y+200)])

def single(y=300,left=100,right=1100,support=(750,850,1000)):
    return Row([Staff(False,left,right,y,y+50,[Symbol((x,y)) for x in support])])

class GeometryTests(unittest.TestCase):
    def test_inset_example_removed_before_decoder(self):
        cue=single()
        rows=[grand(0),cue,grand(500),grand(1000)]
        selected,audit=select_piano_systems(rows)
        self.assertEqual(selected,[rows[0],rows[2],rows[3]])
        self.assertEqual(audit["removed"][0]["systemIndex"],1)
        self.assertEqual(audit["removed"][0]["certainty"],"possible-auxiliary-example-review-required")

    def test_single_staff_music_retained(self):
        rows=[single(y=200*i) for i in range(4)]
        self.assertIs(select_piano_systems(rows)[0],rows)

    def test_legitimate_full_width_solo_passage_retained(self):
        solo=single(support=(150,450,1000))
        rows=[grand(0),solo,grand(500),grand(1000)]
        self.assertEqual(select_piano_systems(rows)[0],rows)

    def test_short_left_aligned_coda_retained(self):
        coda=single(y=1300,left=100,right=500,support=(150,250,400))
        rows=[grand(0),grand(400),grand(800),coda]
        self.assertEqual(select_piano_systems(rows)[0],rows)

    def test_inset_coda_is_ambiguous_and_explicitly_audited(self):
        rows=[grand(0),grand(400),grand(800),single(y=1300,left=700,right=1100)]
        _,audit=select_piano_systems(rows)
        self.assertTrue(audit["experimental"])
        self.assertEqual(audit["removed"][0]["certainty"],"possible-auxiliary-example-review-required")

    def test_mixed_connected_ensemble_retained(self):
        ensemble=Row([Staff(False,100,1100,300,350),Staff(True,100,1100,400,600)])
        rows=[grand(0),ensemble,grand(800),grand(1200)]
        self.assertIs(select_piano_systems(rows)[0],rows)

    def test_weak_piano_evidence_retained(self):
        rows=[grand(0),single(300),grand(500)]
        self.assertIs(select_piano_systems(rows)[0],rows)

    def test_connected_or_overlapping_single_retained(self):
        connected=single();connected.connections=[object()]
        overlapping=single(y=30)
        rows=[grand(0),connected,grand(500),grand(1000)]
        self.assertEqual(select_piano_systems(rows)[0],rows)
        rows=[grand(0),overlapping,grand(500),grand(1000)]
        self.assertEqual(select_piano_systems(rows)[0],rows)

    def test_invalid_or_sparse_support_retained(self):
        sparse=single(support=(800,))
        rows=[grand(0),sparse,grand(500),grand(1000)]
        self.assertEqual(select_piano_systems(rows)[0],rows)

if __name__=="__main__":
    unittest.main()

