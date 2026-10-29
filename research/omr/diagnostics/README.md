# Scan validation cases: tools

The tools that feed and read the scan validation gate ([issue 233](https://github.com/MarchalMaxim/digitus2/issues/233); `docs/scanning.md`, Validation cases). The cases live in the folder `DIGITUS2_SCAN_CASES` names, outside the repository; every tool here reads that variable (`recognize.mjs` as the default of `--cases`).

| Tool            | Does                                                                                                                                                                                      |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ingest.mjs`    | turns a **Download everything** archive (or the folder of an unzipped one) into a case                                                                                                    |
| `pull.mjs`      | copies the scans the scan service kept for an opted-in device into cases                                                                                                                  |
| `recognize.mjs` | reads every case's photos again with the scanner as it is now (or with a change) into a parallel store                                                                                    |
| `report.mjs`    | prints the last run's `report.md` as written; `--diff` names the cases whose outcome changed between two `report.json` files, with their bars; `--against` compares two runs case by case |

The gate itself is `apps/web/e2e/scan-cases.spec.ts`, which `pnpm verify scan:cases` runs.

## A case

A folder holding, for N = 1 to k, `page-N.jpg` (or `.png`), the photo as the scanner received it, and the scanner's answer for it: `page-N-recognized.musicxml`, or for a page it refused an entry in `recognition-failed.json` (`{"pages": [{"page", "status", "answer"}]}`, the service's 422 or 504 and the body it sent), which the replay answers with again. The pages run from 1 to the first one without a photo or an answer. Optionally:

| File          | Holds                                                                                                                                                                                                                                                                                     |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scan.json`   | as **Download everything** writes it (`apps/web/src/scan/bundle.ts`); the replay uses its page names, types, recognizer and warnings. A scan the service kept has none, and each page is answered with its `page-N-recognition.json`, the recognizer's own record with its warnings       |
| `expect.json` | what the pages show: `{photo, bars, staves, fifths, time, rotate?, cutOff?}` for a scan of one photo, or `{"pages": [{bars, staves, fifths, time, cutOff?}, ...]}`, one entry per page in order. A fact left out is not checked; `cutOff` marks a photo that does not show the whole page |

An `expect.json` that is not JSON or lists no page fails its case. Other files are left alone; the gate adds `review.png` (and `score.png` for a usable case), and writes `report.json`, `report.md` and `report-previous.json` beside the cases.

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
| `recognition-failed.json`    | for refused pages only: `{"pages": [{"page", "status", "answer"}]}`, the service's 422 or 504 answer; such a page has no MusicXML or record, and the gate answers it with this refusal again   |
| `expect.json`                | a store case's own, copied byte for byte (one left in `--out` for a case without one is removed); for a photo case, `{photo, bars, staves, fifths, time, rotate?, cutOff?}` from the manifest  |

`scan.json` is not written, and one left in `--out` is removed with the page ids and reviews of a kept scan: the gate prefers `scan.json` to the records, and it carries the old answers. The gate's `report.json`, `report.md` and `report-previous.json` are removed from `--out` too, since they describe the recognitions replaced. Other files in a case folder stay.

`rerecognition.json` at the root of `--out` records the run: `ranAt`, `finishedAt`, `prepare`, `environment` (platform, both Pythons, the onnxruntime, OpenCV, NumPy and Pillow versions, threads, timeout) and per case and page the status, seconds, parts, bars of the longest part, sounding notes, warning codes, what `clean_file` returned, and for a refusal its failure code and `cause`, the exception behind it. The gate does not read it.

A refused page is a measurement and leaves the exit code alone. A fault of this computer or the toolchain (a library that does not load, a path too long, a service root that cannot be written) stops the run instead: the case it was in is cleared, and `rerecognition.json` says where in `aborted`. Scratch lives in one `d2rr-*` folder under the system's temporary folder, removed at the end; if a run stops on a long path, set `TMP` to a shorter folder. Exit 0 when the run completed, 2 for a wrong command line, nothing to recognise or a chosen case whose `expect.json` is not JSON (before anything is written), 3 when the run stopped.

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

Each side is a case store or its `report.json`; `<after>` defaults to `DIGITUS2_SCAN_CASES`. It prints one row per case with the outcome and fingerings on each side, the change and what moved, then a count of each change. Both runs are read against one truth, the second run's `expect.json`, else the first's (the photos are the same). Outcomes rank usable, explained, failed, unrecognized.

| Change | When                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| worse  | the outcome drops; a page's bars move away from what the page shows; fewer pages agree on staves, key or time; a retake is asked of a case usable on both sides, or, when the truth marks every page of the case cut off, no longer asked; a case refused before (explained, failed or unrecognized) is usable with a page under its bars ("accepted short") or over them ("accepted with extra bars"); or the second run lost the case |
| better | nothing is worse, and the outcome rises, a page's bars come closer to what it shows, more pages agree on staves, key or time, or a case usable on both sides no longer asks for a retake (when the truth marks every page of the case cut off: a case now asks for one)                                                                                                                                                                 |
| same   | anything else; a case refused before that is usable now with a page no truth checks ("usable unchecked") is at most the same                                                                                                                                                                                                                                                                                                            |
| new    | only the second run has the case                                                                                                                                                                                                                                                                                                                                                                                                        |

The bars are judged page by page. A refused or missing page reads 0. A page with a truth is judged by its distance from it; a cut-off page (`cutOff`) shows fewer bars than the page holds, so it moves away when it reads more bars over the page's, or fewer under them than it read right before, less those it read over (28/24 -> 20/24 stays the same; 28/24 -> 3/24 is bars lost), and is short only when it reads none. Its bars can only make a case worse: fewer bars on it may be what the photo shows, so they never make a case better. The right answer to a cut-off photo is to photograph it again: on a case whose truth marks every page cut off, a retake dropped is worse and a retake asked is better, whatever the outcome. A row does not say which page its retake names, so a case with a page that is not cut off keeps the rule of the other cases. On a page without a truth, a case usable on both sides that reads fewer bars is worse. Staves, key and time are judged only when both rows carry the same truth; staves agree for one part with the page's staves, or, for two staves, the pair of one-staff parts the app joins into a grand staff. A fact the truth leaves out agrees on every page.

The Moved column says, in this order:

| Moved                                                            | Means                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `explained -> usable`                                            | the outcome                                                                                                                                                                                                                                    |
| `bars 24/24 -> 9/24`                                             | bars read over bars shown, summed over the pages with a truth; `(2/2 -> 1/2)` adds the pages that agree on a case of several pages; `bars 30 -> 12` without a truth; page by page (`19/19, 20/24 -> 20/19, 19/24`) when the totals hide a move |
| `staves lost`, `key found`, `time lost`                          | the pages that agree on it, with their counts on a case of several pages                                                                                                                                                                       |
| `page 2 refused`, `page 2 read`                                  | the scanner refused a page it read before, or reads one it refused; shown, not judged                                                                                                                                                          |
| `truth after only`, `truth before only`, `truth changed`         | the two runs carry different `expect.json`                                                                                                                                                                                                     |
| `retake asked`, `retake dropped`                                 | the review asks for a page to be photographed again, or no longer does; `on a cut-off page` when the truth marks every page of the case cut off                                                                                                |
| `accepted short`, `accepted with extra bars`, `usable unchecked` | a case refused before is usable now (above)                                                                                                                                                                                                    |
| `absent`                                                         | the second run lost the case                                                                                                                                                                                                                   |

Each rule judges only rows that carry its fields (`pages` per page, `agree`, `retake`, `refusedPages`), so two runs of an older gate, whose rows have none, compare on the outcome alone. A case folder holding `recognition-failed.json` whose row does not list its refused pages (an older gate's row, or none) counts as `unrecognized`; a store `recognize.mjs` wrote with no report and no case the gate could replay reads every case so. Exit 1 when any case is worse, 2 for a wrong command line or a run it refuses:

| Refused                                                                     | Then                                  |
| --------------------------------------------------------------------------- | ------------------------------------- |
| a store whose re-recognition stopped (`aborted`)                            | run `recognize.mjs` again             |
| a store whose report is missing or older than its recognitions              | run the gate on it again              |
| a store against another report file such as `report-previous.json`          | compare two stores, or two such files |
| one run written by an older gate, whose rows do not say what each page read | run the gate on that one again        |

A scanner change, measured (`docs/scanning.md`, Validation cases):

```bash
node research/omr/diagnostics/recognize.mjs --homr <toolchain> --cases <cases> --photos research/omr/photos --out <before>
node research/omr/diagnostics/recognize.mjs --homr <toolchain> --cases <cases> --photos research/omr/photos --prepare <module.py> --out <after>
DIGITUS2_SCAN_CASES=<before> pnpm verify scan:cases
DIGITUS2_SCAN_CASES=<after> pnpm verify scan:cases
node research/omr/diagnostics/report.mjs --against <before> <after>
```

## Tests

`node --test research/omr/diagnostics/*.test.mjs`: the archive reading and its refusals, the case names and the fingerprint (`ingest.test.mjs`), the listing and the plan of a kept scan (`pull.test.mjs`), the report diff and `--against` (`report.test.mjs`), and the plan, the case files, the refusals and the faults of a re-recognition with a stand-in recogniser (`recognize.test.mjs`). Three of the last run `recognize.py` through the real `Service`; they need Python 3.10 or later (`DIGITUS2_PYTHON`, else `python`, else `python3`) and skip without it. None needs a build, a toolchain or a case. The gate's own helpers (reading a case and its `expect.json`, what a page reads, the agreement, the retake sentences, the bars of `report.md`) are tested without a browser in `apps/web/e2e/helpers/cases.test.ts`, which the `e2e` step runs.
