"""The confidence patch applies only to the expected upstream text and leaves decoding alone."""
from pathlib import Path
import tempfile
import unittest
import xml.etree.ElementTree as ET
try:
    import numpy as np
except ImportError:  # the helpers run under homr's own runtime
    np = None
from patch_confidence import EDITS, patched

class ConfidencePatchTests(unittest.TestCase):
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
            decoder = texts["homr/transformer/decoder_inference.py"]
            self.assertIn("symbol.confidence = {", decoder)
            self.assertIn("build_confidence(note, model_note)", texts["homr/music_xml_generator.py"])
            self.assertIn("+++ b/homr/music_xml_generator.py", diff)
            # The chosen tokens are still the argmax samples: the patch adds no line that sets one.
            self.assertNotIn("+            rhythm_sample", diff)
            self.assertNotIn("+            pitch_sample", diff)
            self.assertNotIn("+            lift_sample", diff)
            self.assertEqual(before, {name: (root / name).read_text(encoding="utf-8") for name in EDITS})

    def test_unexpected_source_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.source(root)
            (root / "homr/music_xml_generator.py").write_text("changed upstream\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "Unexpected upstream homr/music_xml_generator.py"):
                patched(root)

    @unittest.skipIf(np is None, "numpy is not installed")
    def test_most_probable_and_comment(self):
        """The helpers the patch adds, run on their own: top three tokens and the comment's text."""
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.source(root)
            texts, _ = patched(root)
        decoder = texts["homr/transformer/decoder_inference.py"]
        helper = decoder[decoder.index("def _most_probable"):decoder.index("def detokenize")]
        generator = texts["homr/music_xml_generator.py"]
        start = generator.index("def build_confidence")
        writer = generator[start:generator.index("    build_image_position(note, model_note)", start)]
        def softmax(z):
            e = np.exp(z - np.max(z))
            return e / e.sum()
        scope = {"np": np, "softmax": softmax, "NDArray": object, "ET": ET, "EncodedSymbol": object}
        exec(helper + "\n" + writer, scope)
        top = scope["_most_probable"](np.array([0.0, 3.0, 1.0, 2.0]), {0: "a", 1: "b", 2: "c", 3: "d"})
        self.assertEqual([t for t, _ in top], ["b", "d", "c"])
        self.assertAlmostEqual(sum(p for _, p in scope["_most_probable"](np.array([1.0, 1.0]), {0: "x", 1: "y"})), 1.0)
        class Symbol:
            confidence = {"rhythm": [("note_4", 0.98), ("note_8", 0.01)], "pitch": [("C5", 0.99999987), ("D5", 1.2345678e-07)]}
        note = ET.Element("note")
        scope["build_confidence"](note, Symbol())
        text = ET.tostring(note, encoding="unicode")
        self.assertEqual(text, "<note><!-- conf: rhythm note_4 0.98 note_8 0.01; pitch C5 1 D5 1.23457e-07 --></note>")
        bare = ET.Element("note")
        scope["build_confidence"](bare, object())
        self.assertEqual(ET.tostring(bare, encoding="unicode"), "<note />")

if __name__ == "__main__":
    unittest.main()
