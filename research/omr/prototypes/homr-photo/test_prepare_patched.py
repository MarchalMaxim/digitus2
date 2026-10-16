"""Fail-closed source verification boundaries, independent of downloaded code."""
from pathlib import Path
import tempfile
import unittest
from prepare_patched import source_snapshot, verify_source

class SourceVerificationTests(unittest.TestCase):
    def test_exact_source_accepted(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            (root/"homr").mkdir()
            (root/"homr/main.py").write_text("pass\n")
            verify_source(root,source_snapshot(root))

    def test_modified_source_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            (root/"homr").mkdir()
            path=root/"homr/main.py"
            path.write_text("pass\n")
            expected=source_snapshot(root)
            path.write_text("raise RuntimeError()\n")
            with self.assertRaisesRegex(ValueError,"Unknown source changes"):
                verify_source(root,expected)

    def test_additional_inference_file_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            (root/"homr").mkdir()
            (root/"homr/main.py").write_text("pass\n")
            expected=source_snapshot(root)
            (root/"homr/unexpected.py").write_text("pass\n")
            with self.assertRaisesRegex(ValueError,"unexpected.py"):
                verify_source(root,expected)

if __name__=="__main__":
    unittest.main()

