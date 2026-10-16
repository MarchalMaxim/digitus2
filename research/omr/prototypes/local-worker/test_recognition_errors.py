from recognition_errors import RecognitionError, native_failure, check_complete_export, multiple_scores_failure
import pytest


def test_actual_photo_scale_failure_is_actionable_and_has_no_private_log():
    failure = native_failure("private path C:/Users/name/input.jpg\n With a too low interline value of 6 pixels, this interline value is NOT RELIABLE!")
    assert failure.public["code"] == "staff-resolution-too-low"
    assert failure.public["details"] == {"interlinePixels": 6}
    assert "6 pixels" in failure.public["message"]
    assert "full-resolution" in failure.public["message"]
    assert "C:/" not in str(failure.public)
    assert "well-lit" not in str(failure.public)


def test_unknown_native_failure_does_not_echo_private_log():
    failure = native_failure("Secret path and Java stack trace")
    assert failure.public["code"] == "recognition-failed"
    assert "Secret" not in str(failure.public)


@pytest.mark.parametrize("marker", ["Error visiting Measure{#3}", "Error in loading sheet structure", "Exception occurred java.lang.NullPointerException"])
def test_known_partial_export_errors_fail_closed(marker):
    with pytest.raises(RecognitionError, match="incomplete"):
        check_complete_export(marker)


def test_cosmetic_warnings_do_not_reject_a_complete_export():
    check_complete_export("WARN Could not find OCR metronome text\nScore input exported")
    assert multiple_scores_failure().public["code"] == "multiple-scores-detected"
