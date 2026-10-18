"""The checker's sustain rule, the scoring run's handling of a failed check, the report's signs and the
listening files' titles."""
from __future__ import annotations

from fractions import Fraction as F

from embellish import listening, report, run
from embellish.check import Report, verify
from embellish.tests.fixtures import score


def test_checker_rejects_a_new_note_that_sounds_through_a_strong_position():
    plain = score([[("G4", F(1, 2)), ("C4", 2), ("E4", 1), ("D4", F(1, 2))], [("C4", 4)]])
    # a hand-made "embellishment" whose passing D4 starts on beat 2.5 and holds across beat 3
    bad = score([[("G4", F(1, 2)), ("C4", 1), ("D4", 1), ("E4", 1), ("D4", F(1, 2))], [("C4", 4)]])
    rep = verify(plain, bad, [{"onset": "3/2", "midi": 62, "length": "1"}])
    assert not rep.ok
    assert any("sounds through a strong position" in p for p in rep.problems)


def test_a_failed_check_refuses_that_density():
    assert run.check_refusal(Report(True, [], 4, 4)) is None
    reason = run.check_refusal(Report(False, ["the notes struck on a strong position differ"], 4, 3))
    assert reason.startswith("own check failed") and "strong position" in reason


def test_report_signs_a_negative_change():
    assert report.signed(0.024) == "+0.02"
    assert report.signed(-0.012) == "-0.01"
    assert report.signed(0.0) == "+0.00"


def test_retitle_suffixes_the_title_and_the_visible_credit():
    xml = ('<score-partwise version="4.0"><work><work-title>Allegro</work-title></work>'
           '<credit page="1"><credit-words font-size="24">Allegro</credit-words></credit>'
           '<credit page="1"><credit-words font-size="12">A. Reinagle</credit-words></credit><part-list/></score-partwise>')
    out = listening.retitle(xml, "embellished, light", "Allegro")
    assert "<work-title>Allegro (embellished, light)</work-title>" in out
    assert '<credit-words font-size="24">Allegro (embellished, light)</credit-words>' in out
    assert '<credit-words font-size="12">A. Reinagle</credit-words>' in out


def test_retitle_adds_a_movement_title_when_the_file_has_none():
    xml = '<score-partwise version="4.0"><identification/><part-list/></score-partwise>'
    out = listening.retitle(xml, "plain", "Come Let Us All with Fervour")
    assert out.startswith('<score-partwise version="4.0"><movement-title>Come Let Us All with Fervour (plain)'
                          '</movement-title><identification/>')
    after_work = listening.retitle('<score-partwise><work><work-number>3</work-number></work><part-list/></score-partwise>',
                                   "plain", "X")
    assert "</work><movement-title>X (plain)</movement-title><part-list/>" in after_work
