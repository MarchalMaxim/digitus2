# Scan validation cases: tools

The tools that feed and read the scan validation gate ([issue 233](https://github.com/MarchalMaxim/digitus2/issues/233); `docs/scanning.md`, Validation cases). The cases live in the folder `DIGITUS2_SCAN_CASES` names, outside the repository; every tool here reads that variable.

| Tool         | Does                                                                                                              |
| ------------ | ----------------------------------------------------------------------------------------------------------------- |
| `ingest.mjs` | turns a **Download everything** archive (or the folder of an unzipped one) into a case                            |
| `pull.mjs`   | copies the scans the scan service kept for an opted-in device into cases                                          |
| `report.mjs` | prints the last run's `report.md`; `--diff` names the cases whose outcome changed between two `report.json` files |

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

## Tests

`node --test research/omr/diagnostics/*.test.mjs`: the archive reading and its refusals, the case names and the fingerprint (`ingest.test.mjs`), the listing and the plan of a kept scan (`pull.test.mjs`) and the report diff (`report.test.mjs`). They need no build and no case.
