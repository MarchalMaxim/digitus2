import sys
from pathlib import Path

RESEARCH = Path(__file__).resolve().parents[2]
if str(RESEARCH) not in sys.path:
    sys.path.insert(0, str(RESEARCH))
