"""The speed patch applies only to the expected upstream text, independent of downloaded code."""
from pathlib import Path
import tempfile
import unittest
from patch_speed import EDITS, patched

class SpeedPatchTests(unittest.TestCase):
    def source(self, root: Path) -> None:
        for name, edits in EDITS.items():
            (root / name).parent.mkdir(parents=True, exist_ok=True)
            (root / name).write_text("".join(old for old, _ in edits), encoding="utf-8")

    def test_expected_source_patched_in_memory_only(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.source(root)
            before = {name: (root / name).read_text(encoding="utf-8") for name in EDITS}
            texts, diff = patched(root)
            self.assertNotIn("from homr.title_detection import detect_title, download_ocr_weights", texts["homr/main.py"])
            self.assertIn("self.touch_extent", texts["homr/bounding_boxes.py"])
            self.assertIn("+++ b/homr/bounding_boxes.py", diff)
            self.assertEqual(before, {name: (root / name).read_text(encoding="utf-8") for name in EDITS})

    def test_unexpected_source_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.source(root)
            (root / "homr/bounding_boxes.py").write_text("changed upstream\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "Unexpected upstream homr/bounding_boxes.py"):
                patched(root)

if __name__ == "__main__":
    unittest.main()
