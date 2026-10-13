"""fingering_eval: datasets, validators and metrics for piano-fingering research (digitus2).

Import with ``research`` on ``sys.path``, e.g. from the project root::

    python -c "import sys; sys.path.insert(0, 'research'); import fingering_eval"

or run modules as ``python -m fingering_eval.evaluate`` with ``PYTHONPATH=research``
(or from inside ``research/``).

Modules
-------
pig_io     read/write PIG fingering files, Note dataclass, finger/pitch parsing
metrics    M_gen, M_high, M_soft, M_rec exactly as in Nakamura et al. (2020) + its C++ tool
validate   reusable data-quality validators (per file, per piece, per dataset)
datasets   loaders for PIG and the other collected corpora (incl. Mutopia-derived files)
evaluate   CLI: ``python -m fingering_eval.evaluate --pred <dir|file> --gold research/data/pig --split test``
"""
from .pig_io import Note, PigFile, read_pig, write_pig, parse_finger, spelled_to_midi  # noqa: F401

__all__ = ["Note", "PigFile", "read_pig", "write_pig", "parse_finger", "spelled_to_midi"]
__version__ = "0.1.0"
