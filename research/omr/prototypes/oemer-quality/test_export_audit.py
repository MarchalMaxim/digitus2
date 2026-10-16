import unittest
from audit_export import audit_musicxml

class ExportAudit(unittest.TestCase):
    def score(self, direction):
        return '<score-partwise><part><measure number="1"><attributes><time><beats>4</beats><beat-type>4</beat-type></time></attributes>'+direction+'</measure></part></score-partwise>'
    def test_missing_beat_unit_is_unresolved_not_guessed(self):
        result=audit_musicxml(self.score('<direction><direction-type><words>= 100</words></direction-type></direction>'))
        self.assertEqual(result['unresolved'][0]['code'],'metronome-beat-unit-unresolved')
        self.assertEqual(result['playbackTempos'],[])
    def test_known_metronome_and_playback_remain_valid(self):
        result=audit_musicxml(self.score('<direction><direction-type><metronome><beat-unit>half</beat-unit><per-minute>60</per-minute></metronome></direction-type><sound tempo="120"/></direction>'))
        self.assertEqual(result['unresolved'],[])
        self.assertEqual(result['playbackTempos'],['120'])
    def test_number_without_equation_not_assumed_tempo(self):
        result=audit_musicxml(self.score('<direction><direction-type><words>100 years</words></direction-type></direction>'))
        self.assertEqual(result['unresolved'],[])
    def test_missing_meter_is_explicit(self):
        result=audit_musicxml('<score-partwise><part><measure/></part></score-partwise>')
        self.assertEqual(result['unresolved'],[{'code':'meter-unresolved'}])
if __name__=='__main__':unittest.main()
