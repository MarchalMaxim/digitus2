# Scan validation cases: tools

The tools that feed and read the scan validation gate ([issue 233](https://github.com/MarchalMaxim/digitus2/issues/233); `docs/scanning.md`, Validation cases). The cases live in the folder `DIGITUS2_SCAN_CASES` names, outside the repository; every tool here reads that variable (`recognize.mjs` as the default of `--cases`).

| Tool            | Does                                                                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ingest.mjs`    | turns a **Download everything** archive (or the folder of an unzipped one) into a case                                                                        |
| `pull.mjs`      | copies the scans the scan service kept for an opted-in device into cases                                                                                      |
| `recognize.mjs` | reads every case's photos again with the scanner as it is now (or with a change) into a parallel store                                                        |
| `report.mjs`    | prints the last run's `report.md`; `--diff` names the cases whose outcome changed between two `report.json` files; `--against` compares two runs case by case |

The gate itself is `apps/web/e2e/scan-cases.spec.ts`, which `pnpm verify scan:cases` runs.

## A case

A folder holding, for N = 1 to k, `page-N.jpg` (or `.png`), the photo as the scanner received it, and `page-N-recognized.musicxml`, the scanner's answer for it; optionally `scan.json` as **Download everything** writes it (`apps/web/src/scan/bundle.ts`), whose page names, types, recognizer and warnings the replay uses. A scan the service kept has no `scan.json`; the replay answers each page with its `page-N-recognition.json` instead, the recognizer's own record with its warnings. Other files are left alone; the gate adds `review.png` (and `score.png` for a usable case), and writes `report.json`, `report.md` and `report-previous.json` beside the cases.

## ingest.mjs

```bash
node research/omr/diagnostics/ingest.mjs "C:/Users/<you>/Downloads/photo 22.57.16-scan.zip"
node research/omr/diagnostics/ingest.mjs      # every *-scan.zip in Downloads
```

An archive is accepted when its `scan.json` lists its pages, each page is a photo the archive names `page-N.jpg` or `.png` in order, and each has its recognition. Only those entries and `scan.json` are written, under those names. The case is named from the archive and the local day of `recognizedAt` (the archive's date without one). A scan already in the store is recognised by a hash of its photos and recognitions, whatever its folder is called, and reported as present. A refusal says why and, for archives named on the command line, makes the exit code 1; the sweep of Downloads only reports them.

## pull.mjs

```bash
node research/omr/diagnostics/pull.mjs
```

It lists `gs://digitus2-scan-cases/cases/` of the project `digitus2-scan` with the owner's gcloud login (`gcloud storage ls --long --recursive`) and copies each kept scan it has not copied before into `kept-<date>-<first 8 characters of the scan id>`. It reads only: it creates no bucket and changes no setting; without gcloud, or while the bucket does not exist, it says so and exits 0.

The layout it reads is the one the scan service's `Keeper` writes (`research/omr/service/service.py`): `cases/<UTC date>/<scan id>/<visit>/` (older scans have no visit folder, or sit directly under `cases/`), one visit for each stretch in which the service remembered the scan, holding for each page in the order it arrived `page-N.jpg` (or `.png`), `page-N-recognized.musicxml`, `page-N-recognition.json` and `page-N-id.json` (the page's own id), and `review-K.json` for each review the device reported. The visits of one scan make one case. When the latest review lists the scan's pages (`pages`, their ids in the order on screen), each page is the last photo kept with its id, so a page photographed again, moved or removed in the review lands right; a listed page never kept skips the scan and names it. A scan whose review lists no pages (an older app) is put back in order by its photos: a photo of a size already seen is that page sent again (**Retry failed pages**, **Scan again**) and takes its place, and a new photo after the first review skips the scan, since which page it is cannot be told. A page whose last attempt has no recognition skips the scan too. The reviews are copied numbered again across the visits, the highest the latest. `.pulled.json` in the cases folder records what was copied, and a scan with new objects since is copied again.

## recognize.mjs

```bash
node research/omr/diagnostics/recognize.mjs --homr <toolchain> --out <store> [--cases <store>] [--photos <dir>] [--prepare <module.py>] [--timeout 180] [--threads N] [case names...]
```

| Option      | Means                                                                                                                                                                                                                       |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--homr`    | a prepared homr toolchain (the folder `DIGITUS2_OMR_HOMR` names for the acceptance gate)                                                                                                                                    |
| `--out`     | the new store; it holds one run, so a folder holding cases this run does not recognise is refused untouched, and may not be the `--cases` folder                                                                            |
| `--cases`   | the case store to read, read only; `DIGITUS2_SCAN_CASES` by default, unless `--photos` is given alone                                                                                                                       |
| `--photos`  | a committed photo set with its `manifest.json` (`research/omr/photos`): each photo becomes a one-page case `photo-<id>`                                                                                                     |
| `--prepare` | a Python module whose `clean_file(path)` rewrites a photo in place; it runs in the toolchain's interpreter (OpenCV, NumPy, Pillow) on a copy of each photo before recognition, and the case keeps the photo the app uploads |
| `--timeout` | homr's seconds per page, 180 as in the service                                                                                                                                                                              |
| `--threads` | homr's threads: by default `DIGITUS2_OMR_THREADS`, else 4, as the hosted service gets                                                                                                                                       |
| names       | only these cases, from the store or the photo set; a name that matches nothing is refused                                                                                                                                   |

Each page is read by its own `python -I recognize.py` (Python 3.11, `DIGITUS2_PYTHON` names another command), one page at a time, through the scan service's own code: `Service.recognize` (`research/omr/service/service.py`) with the recogniser the container builds (the photo route over the worker's homr adapter) and a `Keeper` that keeps in memory what the live one writes to the cases bucket. The upload checks are the handler's (PNG or JPEG by their bytes, 10 MB). So the status, the answer and the record are the live service's, not a copy of them.

Each case folder in `--out` gets:

| File                         | Holds                                                                                                                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `page-N.jpg` or `.png`       | the photo the app uploads, byte for byte; a photo the manifest marks `rotate` is turned as **Rotate** turns it and kept as PNG                                                                 |
| `page-N-recognized.musicxml` | the answer's MusicXML, as the app receives it                                                                                                                                                  |
| `page-N-recognition.json`    | the recogniser's record as the `Keeper` keeps it (recognizer, capabilities, warnings, audits), the file a case from `pull.mjs` carries; the answer's own fields when the recogniser wrote none |
| `recognition-failed.json`    | for refused pages only: `{"pages": [{"page", "status", "answer"}]}`, the service's 422 or 504 answer; such a page has no MusicXML or record, and the gate cannot replay it yet                 |
| `expect.json`                | for a photo case: `{photo, bars, staves, fifths, time, rotate?, cutOff?}` from the manifest                                                                                                    |

`scan.json` is not written, and one left in `--out` is removed with the page ids and reviews of a kept scan: the gate prefers `scan.json` to the records, and it carries the old answers. The gate's `report.json`, `report.md` and `report-previous.json` are removed from `--out` too, since they describe the recognitions replaced. Other files in a case folder stay.

`rerecognition.json` at the root of `--out` records the run: `ranAt`, `finishedAt`, `prepare`, `environment` (platform, both Pythons, the onnxruntime, OpenCV, NumPy and Pillow versions, threads, timeout) and per case and page the status, seconds, parts, bars of the longest part, sounding notes, warning codes, what `clean_file` returned, and for a refusal its failure code and `cause`, the exception behind it. The gate does not read it.

A refused page is a measurement and leaves the exit code alone. A fault of this computer or the toolchain (a library that does not load, a path too long, a service root that cannot be written) stops the run instead: the case it was in is cleared, and `rerecognition.json` says where in `aborted`. Scratch lives in one `d2rr-*` folder under the system's temporary folder, removed at the end; if a run stops on a long path, set `TMP` to a shorter folder. Exit 0 when the run completed, 2 for a wrong command line or nothing to recognise, 3 when the run stopped.

```bash
# the committed photos only, as the scanner reads them now
node research/omr/diagnostics/recognize.mjs --homr C:/omr/homr --photos research/omr/photos --out C:/omr/rr-base
# one case of the store and one photo, with a cleaning step
node research/omr/diagnostics/recognize.mjs --homr C:/omr/homr --cases "$DIGITUS2_SCAN_CASES" --photos research/omr/photos --prepare C:/omr/clean_photo.py --out C:/omr/rr-clean <case> photo-<id>
```

## report.mjs --against

```bash
node research/omr/diagnostics/report.mjs --against <before> [<after>]
```

Each side is a case store or its `report.json`; `<after>` defaults to `DIGITUS2_SCAN_CASES`. A store is read through its `report.json`, and a case folder holding `recognition-failed.json` counts as `unrecognized`. Outcomes rank usable, explained, failed, unrecognized. It prints one row per case with the outcome and fingerings on each side and the change (better, worse, same, or new for a case only the second run has; a case the second run lost is worse), then a count of each. Exit 1 when any case is worse, 2 for a wrong command line. It refuses a store whose re-recognition stopped (`aborted`), a store whose report is older than its recognitions (run the gate on it again), and a store against another report file such as `report-previous.json`; two such files compare as they are. A store `recognize.mjs` wrote with no report and no case the gate could replay reads every case as `unrecognized`.

The outcome alone does not see a case that stays usable with fewer bars or a retake verdict; the bars are in `rerecognition.json` beside `expect.json`, the verdicts in each store's `report.md`.

A scanner change, measured (`docs/scanning.md`, Validation cases):

```bash
node research/omr/diagnostics/recognize.mjs --homr <toolchain> --cases <cases> --photos research/omr/photos --out <before>
node research/omr/diagnostics/recognize.mjs --homr <toolchain> --cases <cases> --photos research/omr/photos --prepare <module.py> --out <after>
DIGITUS2_SCAN_CASES=<before> pnpm verify scan:cases
DIGITUS2_SCAN_CASES=<after> pnpm verify scan:cases
node research/omr/diagnostics/report.mjs --against <before> <after>
```

## Tests

`node --test research/omr/diagnostics/*.test.mjs`: the archive reading and its refusals, the case names and the fingerprint (`ingest.test.mjs`), the listing and the plan of a kept scan (`pull.test.mjs`), the report diff and `--against` (`report.test.mjs`), and the plan, the case files, the refusals and the faults of a re-recognition with a stand-in recogniser (`recognize.test.mjs`). Three of the last run `recognize.py` through the real `Service`; they need Python 3.10 or later (`DIGITUS2_PYTHON`, else `python`, else `python3`) and skip without it. None needs a build, a toolchain or a case.
