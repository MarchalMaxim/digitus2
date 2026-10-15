# SUPERSEDED — no external service approved

User correction: OCR must execute within the application. Downloading open-source code is allowed; external recognition services/uploads are not the intended design. The candidates below are historical research only and are not approved integration directions. No score was uploaded and no conversion service was run.

# Optional online OMR candidates — 2026-10-15

## Decision and actual access result

**Flat/Tutteo is the most concrete integration candidate; recognition quality is unverified.** Its live API was reached successfully. No fixture has been uploaded, no conversion run, no account created, no payment made, and no terms accepted. A quality recommendation awaits actual exported MusicXML scored against the fixtures.

| Candidate | Usable input/output and access | Price/access requirement | Status |
| --- | --- | --- | --- |
| Flat/Tutteo OMR (same engine as Opuscan) | Documented PDF/image -> MusicXML Jobs API; `omr` OAuth scope or PAT; direct output without Flat library | Account with OMR credit allowance; credit packs below | Best concrete API candidate; live capabilities verified, job creation rejected without auth |
| Klangio Scan2Notes | Browser image/PDF scanner; free first-12-measure preview/PDF; Pro MusicXML export | Pro: 50 scans/month; current exact subscription price needs app checkout view | Useful competing quality trial; public developer API docs describe audio, not a verified OMR endpoint |
| Newzik OMR | Advertises integrated scanned/PDF -> MusicXML API | Contact-sales credentials, API docs and quote needed | Credible alternative, no public callable trial/API specification established |

Sources: [Flat overview](https://flat.io/developers/docs/api/omr/), [Scan2Notes plan details](https://klang.io/help/compare-apps-and-subscriptions/), [Klangio API](https://api-docs.klang.io/), [Newzik API offering](https://newzik.com/notre-api-omr). Vendor superlatives are marketing claims and were not treated as comparative accuracy evidence.

## Flat: exact next experiment

Actual `GET https://api.flat.io/v2/omr/capabilities` returned HTTP 200: MusicXML/MXL exports, PNG/PDF accepted, maximum 50 pages/job, 100 MiB/file, costPerPage=1, retentionDays=30. Saved response: ignored `research/omr/results/online-spike/flat-capabilities.json`.

Actual unauthenticated `POST https://api.flat.io/v2/omr/jobs`, with only `{ "output": "musicxml" }`, returned HTTP 401 / `AUTH_ERROR`, “Invalid or missing session”. No file was included. Saved error: `flat-noauth-error.json`.

**Exact unblock:** a Flat account with at least one available OMR credit and a PAT authorized for OMR, or a user-authorized OAuth connection. The account owner should create/store the token securely; do not paste secrets into docs or commit them. The [developer playground](https://flat.io/developers/omr/playground) is an alternative user-driven test, also authenticated and credit-billed. No existing credential was searched for or assumed.

[Jobs API](https://flat.io/developers/docs/api/omr/jobs) provides the test sequence: create draft with `output:musicxml`; attach Base64 PNG; start; long-poll status; download `exports/musicxml`. The one-page fixture is `research/omr/results/fixtures-final/twinkle-twinkle-little-star/page-001-clean.png`. Preserve raw XML, job metadata/model version when returned, input/output hashes and elapsed time. Score pitches, durations, onset order and staff assignment against fixture truth before recommending any adapter. Then repeat Bach/Chopin and degraded captures; one clean success cannot establish photographic reliability.

| Flat credit pack (USD, excluding tax) | Per page |
| --- | ---: |
| 30 pages: $9.99 | $0.333 |
| 70 pages: $18.99 | $0.271 |
| 300 pages: $49.99 | $0.167 |
| 1000 pages: $149 | $0.149 |
| 3000 pages: $300 | $0.10 |

Credits are charged at start and reverted for failed/cancelled jobs; purchases are one-off. Actual account eligibility/balance must be checked before upload/start. [Official billing FAQ](https://flat.io/developers/docs/api/omr/faq/credits).

## Terms and privacy boundaries

Flat explicitly permits supplying customer-generated MusicXML outside Flat, caching/reuse, and no attribution obligation, subject to rights in the uploaded score. It states inputs/outputs are not used for training. MusicXML jobs retain content 30 days by default; finished-job deletion erases content while keeping stripped accounting records. Flat terms/privacy and published DPA govern use. [Official OMR legal/privacy FAQ](https://flat.io/developers/docs/api/omr/faq/legal).

Klangio's free tier is restricted to non-commercial testing; API service needs separate registration/terms and is not bundled with consumer subscriptions. Its website privacy policy does not establish an OMR-specific no-training/retention promise sufficient for integration; clarify that before uploading private music. [Terms](https://klang.io/terms/), [privacy](https://klang.io/privacy/). Newzik's API price, retention, training policy and integration rights need the API agreement; the marketing page alone is insufficient.

Browser trial blocker: the available computer-use provider returned “Browser is not available: iab”; inventory then returned `apps:[]`, `browsers:[]`. Therefore Scan2Notes' anonymous preview could not be operated here. Opuscan is an installed consumer app/store route, not an established anonymous web-upload endpoint. [Opuscan](https://www.opuscan.com/omr/).

## Product implication

Keep fingering local. Any future Online Scan must be explicit, identify the receiving provider and upload before transfer, and return editable/importable MusicXML for local parsing/fingering. A shared provider token must never ship in the static browser bundle; use user-owned authentication or a separately authorized optional service. Open-source service adapters remain a parallel option (Audiveris evaluation is owned by another agent); this research did not duplicate that setup. No product edits are justified until an actual recognizer output passes verification. Never promise perfect OMR.
