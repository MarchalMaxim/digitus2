import unittest
from check_score import events, check

class Timing(unittest.TestCase):
    def test_chord_and_backup_preserve_simultaneous_hands(self):
        xml=b'<score-partwise><part><measure><attributes><divisions>2</divisions></attributes><note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><staff>1</staff></note><note><chord/><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration><staff>1</staff></note><backup><duration>4</duration></backup><note><rest/><duration>1</duration><staff>2</staff></note><note><pitch><step>C</step><octave>3</octave></pitch><duration>1</duration><staff>2</staff></note></measure></part></score-partwise>'
        score=events(xml)
        self.assertEqual([r['onset'] for r in score['events']], ['0','0','0','1/2'])
        truth={'anchors':[{'name':'tiny','measure':0,'staff':1,'onset':'0','duration':'2','pitches':['C5','E5']}]}
        self.assertTrue(check(score,truth)['allChecksPass'])
        truth['anchors'][0]['pitches']=['C5','F5']
        self.assertFalse(check(score,truth)['allChecksPass'])
    def test_duplicate_tie_markup_counts_once(self):
        xml=b'<score-partwise><part><measure><note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><tie type="start"/><notations><tied type="start"/></notations></note></measure></part></score-partwise>'
        score=events(xml)
        self.assertEqual(score['events'][0]['ties'], ['start'])
        truth={'regions':[{'name':'chord','measure':0,'staff':1,'tiesAt':{'onset':0,'start':['C5','E5']}}]}
        self.assertFalse(check(score,truth)['allChecksPass'])

    def test_extra_voice_chord_tone_is_not_hidden(self):
        score={'measureCounts':[1],'events':[{'part':0,'measure':0,'staff':'1','onset':'0','duration':'2','pitch':p} for p in ['C5','E5','F5']]}
        truth={'anchors':[{'name':'extra','measure':0,'staff':1,'onset':'0','duration':2,'pitches':['C5','E5']}]}
        self.assertFalse(check(score,truth)['allChecksPass'])

    def test_spare_voice_rest_is_not_an_extra_sounding_chord_tone(self):
        score={'measureCounts':[1],'events':[{'part':0,'measure':0,'staff':'1','onset':'0','duration':'2','pitch':'C5'}, {'part':0,'measure':0,'staff':'1','onset':'0','duration':'1','pitch':None}]}
        truth={'anchors':[{'name':'pitched','measure':0,'staff':1,'onset':'0','duration':2,'pitches':['C5']}]}
        self.assertTrue(check(score,truth)['allChecksPass'])

if __name__=='__main__':unittest.main()
