"""Safe public recognition failures. Never expose native logs, local paths or stack traces."""
import re


class RecognitionError(RuntimeError):
    def __init__(self, code, message, details=None):
        super().__init__(message)
        self.public = {"code": code, "message": message}
        if details:
            self.public["details"] = details


def native_failure(log_text):
    scale = re.search(r"too low interline value of\s+(\d+)\s+pixels", log_text, re.I)
    if scale:
        pixels = int(scale[1])
        return RecognitionError(
            "staff-resolution-too-low",
            f"The staff lines are only {pixels} pixels apart. This recognizer cannot read this photo at that resolution. "
            "Use the full-resolution original photo, photograph a smaller music area, or use the original PDF. "
            "Enlarging a small image does not restore missing detail.",
            {"interlinePixels": pixels},
        )
    return RecognitionError(
        "recognition-failed",
        "The recognizer stopped before producing a complete score. Try the original PDF or a flatter, higher-resolution image.",
    )


def check_complete_export(log_text):
    if any(marker in log_text for marker in [
        "Error visiting Measure", "Error in loading sheet structure",
        "Exception occurred java.", "Exception on input,",
    ]):
        raise RecognitionError(
            "incomplete-recognition",
            "The recognizer encountered an internal error while exporting this page. No incomplete score was admitted. "
            "Try a simpler section or the original PDF.",
        )


def multiple_scores_failure():
    return RecognitionError(
        "multiple-scores-detected",
        "The recognizer split this page into separate scores or examples and could not produce one complete piano score. "
        "Try a single main music section without alternate examples or footnotes, or use the original PDF.",
    )
