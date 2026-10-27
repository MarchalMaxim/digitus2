"""homr writes how sure it was of each note, in an explicitly prepared HOMR source copy (issue 130).

The decoder already computes a score for every token of the rhythm, pitch and accidental heads and
keeps only the highest (greedy decoding). The patch keeps the three most probable tokens of each
head with their softmax probabilities and writes them as a comment in the note, beside imgpos:

    <!-- conf: rhythm note_4 0.981 note_8 0.012 note_2 0.004; pitch C5 0.410 D5 0.380 B4 0.120; lift _ 0.990 # 0.007 N 0.002 -->

Decoding is untouched: the chosen tokens are the same argmax as before, so the score with the
comment removed is byte-identical to the unpatched output.
"""
from pathlib import Path
import argparse
import difflib
import hashlib

EDITS = {
    "homr/transformer/decoder_inference.py": [
        ("""from homr.transformer.configs import Config
""", """from homr.transformer.configs import Config
from homr.transformer.utils import softmax
"""),
        ("""            symbols.append(symbol)
""", """            symbol.confidence = {  # type: ignore[attr-defined]
                "rhythm": _most_probable(rhythmsp[0, -1, :], self.inv_rhythm_vocab),
                "pitch": _most_probable(pitchsp[0, -1, :], self.inv_pitch_vocab),
                "lift": _most_probable(liftsp[0, -1, :], self.inv_lift_vocab),
            }
            symbols.append(symbol)
"""),
        ("""def detokenize(tokens: NDArray, vocab: dict[int, str]) -> list[str]:
""", """def _most_probable(logits: NDArray, vocab: dict[int, str], count: int = 3) -> list[tuple[str, float]]:
    \"\"\"The most probable tokens of one head, most probable first, with their probabilities.\"\"\"
    probabilities = softmax(logits.astype(np.float64))
    order = np.argsort(-probabilities, kind="stable")[:count]
    return [(vocab[int(i)], float(probabilities[i])) for i in order]


def detokenize(tokens: NDArray, vocab: dict[int, str]) -> list[str]:
"""),
    ],
    "homr/music_xml_generator.py": [
        ("""    x, y = symbol.image_coordinates
    xml.append(ET.Comment(f" imgpos: {round(x)}, {round(y)} "))
""", """    x, y = symbol.image_coordinates
    xml.append(ET.Comment(f" imgpos: {round(x)}, {round(y)} "))


def build_confidence(xml: ET.Element, symbol: EncodedSymbol) -> None:
    \"\"\"
    Adds the decoder's most probable tokens per head, with their probabilities, as a comment.
    \"\"\"
    confidence = getattr(symbol, "confidence", None)
    if not confidence:
        return
    heads = "; ".join(
        head + "".join(f" {token} {probability:.3f}" for token, probability in tokens)
        for head, tokens in confidence.items()
    )
    xml.append(ET.Comment(f" conf: {heads} "))
"""),
        ("""    build_image_position(note, model_note)

    return note
""", """    build_image_position(note, model_note)
    build_confidence(note, model_note)

    return note
"""),
    ],
}


def patched(source: Path) -> tuple[dict[str, str], str]:
    """The patched text of each file and the unified diff, LF-normalised; nothing is written."""
    texts, diff = {}, ""
    for name, edits in EDITS.items():
        before = (source / name).read_text(encoding="utf-8")
        after = before
        for old, new in edits:
            if after.count(old) != 1:
                raise ValueError(f"Unexpected upstream {name}; no patch applied")
            after = after.replace(old, new, 1)
        texts[name] = after
        diff += "".join(difflib.unified_diff(before.splitlines(keepends=True), after.splitlines(keepends=True),
                                             fromfile=f"a/{name}", tofile=f"b/{name}"))
    return texts, diff


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--write-patch", action="store_true", help="write the retained diff instead of checking it")
    args = parser.parse_args()
    texts, diff = patched(args.source)
    retained_path = Path(__file__).with_name("upstream-confidence.patch")
    if args.write_patch:
        retained_path.write_text(diff, encoding="utf-8", newline="\n")
    if retained_path.read_text(encoding="utf-8") != diff:
        raise ValueError("Generated confidence patch differs from the retained upstream diff")
    for name, text in texts.items():
        (args.source / name).write_text(text, encoding="utf-8", newline="\r\n")
    print(hashlib.sha256(diff.encode()).hexdigest())


if __name__ == "__main__":
    main()
