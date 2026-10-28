"""Record the JDK ahead-of-time class cache for Audiveris from one recognition, as the service runs it.

The image build runs this once on a CC0 corpus page (aot-training.pdf, the library's Amazing Grace).
The training run goes through the adapter with -XX:AOTCacheOutput, so the cache matches the
adapter's own JVM options and class path. A second run must then map the cache in strict mode
(-XX:AOTMode=on, which exits when the cache is unusable) and give the same MusicXML; otherwise the
build fails. In the service the adapter uses the cache in the JVM's default auto mode.
"""
from __future__ import annotations
import argparse
from pathlib import Path
import sys
import tempfile
import threading

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "prototypes/local-worker"))
import audiveris  # noqa: E402


def strict(run_process, cache: Path):
    """run_process with -XX:AOTMode=on before the adapter's -XX:AOTCache option, which must be there."""
    def run(command, *rest):
        position = command.index("-XX:AOTCache=" + str(cache))
        return run_process(command[:position] + ["-XX:AOTMode=on"] + command[position:], *rest)
    return run


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", type=Path, required=True)
    parser.add_argument("--text-models", type=Path, required=True)
    parser.add_argument("--pdf", type=Path, required=True)
    args = parser.parse_args()
    cache = args.bundle.resolve() / audiveris.AOT_CACHE
    if cache.exists():
        raise FileExistsError(cache)
    with tempfile.TemporaryDirectory() as temporary:
        train, check = Path(temporary) / "train", Path(temporary) / "check"
        train.mkdir()
        check.mkdir()
        trained = audiveris.Audiveris(args.bundle, short_staves=True, text_models=args.text_models,
                                      aot_output=cache)(args.pdf, train, threading.Event()).read_bytes()
        if not cache.is_file() or cache.stat().st_size < 1024 * 1024:
            raise RuntimeError("Audiveris wrote no AOT cache")
        audiveris.run_process = strict(audiveris.run_process, cache)
        checked = audiveris.Audiveris(args.bundle, short_staves=True, text_models=args.text_models)(
            args.pdf, check, threading.Event()).read_bytes()
        if checked != trained:
            raise RuntimeError("The MusicXML with the AOT cache differs from the training run's")
    print(f"AOT cache {cache}: {cache.stat().st_size} bytes, mapped in strict mode, same MusicXML", flush=True)


if __name__ == "__main__":
    main()
