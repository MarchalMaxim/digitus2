"""Two speed-ups with identical output in an explicitly prepared HOMR source copy.

Title OCR (rapidocr, about 0.35 s of imports) loads only when title detection is on; the adapter
passes --no-title. The bounding-box touch pre-check, called about a million times per page, reads
each box's centre and major axis computed once instead of unpacking and type-testing both boxes
on every call; the arithmetic is the upstream one.
"""
from pathlib import Path
import argparse
import difflib
import hashlib

EDITS = {
    "homr/main.py": [
        ("from homr.title_detection import detect_title, download_ocr_weights\n", ""),
        ("""    if config.title_detection:
        title_future = detect_title(debug, staffs[0])
""", """    if config.title_detection:
        from homr.title_detection import detect_title

        title_future = detect_title(debug, staffs[0])
"""),
        ("""    if not args.no_title:
        download_ocr_weights()
""", """    if not args.no_title:
        from homr.title_detection import download_ocr_weights

        download_ocr_weights()
"""),
    ],
    "homr/bounding_boxes.py": [
        ("""        self.rotated_box = (self.center, self.size, 0)
        self.size = (box[2] - box[0], box[3] - box[1])
""", """        self.rotated_box = (self.center, self.size, 0)
        self.size = (box[2] - box[0], box[3] - box[1])
        self.touch_extent = (self.center[0], self.center[1], max(self.size))
"""),
        ("""        self.angle = self.box[2]
""", """        self.angle = self.box[2]
        self.touch_extent = (self.box[0][0], self.box[0][1], max(self.box[1]))
"""),
        ("""        # Get the centers and major axes of the rectangles
        center1, axes1, _ = self.box
        center2: Sequence[float]
        axes2: Sequence[float]
        if isinstance(other, BoundingBox):
            center2, axes2, _ = (
                other.rotated_box
            )  # (variable) rotated_box: tuple[tuple[float, float], tuple[int, int], Literal[0]]
        elif isinstance(other, AngledBoundingBox):
            center2, axes2, _ = (
                other.box
            )  # (variable) box: tuple[tuple[float, float], tuple[int, int], float]
        else:
            raise ValueError(f"Unknown type {type(other)}")
        major_axis1 = max(axes1)
        major_axis2 = max(axes2)

        # Calculate the distance between the centers
        distance = ((center1[0] - center2[0]) ** 2 + (center1[1] - center2[1]) ** 2) ** 0.5
""", """        # The centers and major axes of the rectangles, computed once per box
        x1, y1, major_axis1 = self.touch_extent
        try:
            x2, y2, major_axis2 = other.touch_extent  # type: ignore[attr-defined]
        except AttributeError:
            raise ValueError(f"Unknown type {type(other)}") from None

        # Calculate the distance between the centers
        distance = ((x1 - x2) ** 2 + (y1 - y2) ** 2) ** 0.5
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
    args = parser.parse_args()
    texts, diff = patched(args.source)
    retained = Path(__file__).with_name("upstream-speed.patch").read_text(encoding="utf-8")
    if retained != diff:
        raise ValueError("Generated speed patch differs from the retained upstream diff")
    for name, text in texts.items():
        (args.source / name).write_text(text, encoding="utf-8", newline="\r\n")
    print(hashlib.sha256(diff.encode()).hexdigest())


if __name__ == "__main__":
    main()
