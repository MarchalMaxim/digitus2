# Independent optional PC-worker review — 2026-10-15

Reviewer: Sol 6.1 quality owner, independent of the connector implementation. Scope is research connector acceptance, not recognition-quality certification or a public/VPS deployment. Worker files remained read-only; only this report and ignored connector-review evidence were written. Review began after the owner's explicit frozen checkpoint.

## Evidence and independently repeated checks

The retained actual installed-Chrome 155 proof is connector-wave/browser-reviewed-eng/report.json. It visits the deployed HTTPS Pages origin, tests denied and granted loopback-network permission in disposable contexts, submits a real native scan, obtains raw MusicXML and imports it through the existing frontend. The result has 64 fingering groups, 64/64 strict notes, 12 bars and zero timing mismatches on one clean Twinkle fixture. Native cancellation exits nonzero in about 0.34 seconds and cancelled-result GET returns 409. This is completion/transport evidence, not corpus accuracy or a human permission-prompt test.

I independently verified all four executed operational source hashes and returned XML hash against that retained report. The returned XML is byte-identical to the single native MXL's embedded MusicXML. Exact evidence is connector-review/source-evidence-hashes.json and raw-export-handoff.json. No repeated full recognition or permission run was necessary because the retained proof directly covers those requirements and its source/output identities match.

| Independent check                                                                             | Result                                                            |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Real child/descendant cancellation and timeout, nonzero exit, archive path/size/unwrap checks | 6 passed, 1.03 seconds                                            |
| LocalWorker.close with a separately launched real child                                       | 0.078 seconds; native PID stopped and owned job directory removed |
| Duplicate Content-Length                                                                      | 411, no recognizer call                                           |
| Chunked upload                                                                                | 411, no recognizer call                                           |
| Compressed Content-Encoding upload                                                            | 415, no recognizer call                                           |
| Returned XML versus actual native archive                                                     | Byte-identical                                                    |

The first attempt used the isolated research inference venv, which lacks pytest; that setup failure is retained. The installed system Python ran the focused tests successfully. The independent raw HTTP/process experiment is retained as connector-review/check-edges.py with independent-edge-results.json; no arbitrary executable or external service was introduced.

## Source review

The HTTP listener is IPv4 loopback only. Exact Host/port and one allowlisted Origin are required; duplicated Host/Origin fail. POST/DELETE require the custom client header. Preflight methods/headers are allowlisted. Upload MIME/magic, a single bounded Content-Length and original PDF bytes are checked before submission. Four HTTP slots, one recognition, eight retained jobs, five-minute terminal retention, 10 MiB upload, 20 MiB result, 180-second native default timeout and sampled log/workspace guards bound the intended research lifecycle. These are not OS-enforced native memory/disk quotas.

Jobs use generated directories and IDs, never client filenames/commands. Native argv is direct, with bundled Java and app/* only, isolated settings/home/temp/native cache and cleared inherited JVM/OCR options. Output requires successful process completion, one whole MXL, bounded archive contents, parsed partwise XML and containment. Failures/cancellation hide partial results and internal paths. needsReview remains true in protocol metadata and result client handoff. Cancellation and timeout own the actual process tree; shutdown was independently challenged above.

The two short-staff constants and English model digest match the measured quality contract. Recognition-quality review must still account for unresolved metronome beat units, rhythm/voice/duration/extras and engraving. The model is Apache-2.0; native Audiveris remains AGPL-3.0-or-later, separately from project wrappers.

Known boundaries are documented accurately: GitHub Pages origin checks include all account project paths; local programs can forge headers. Force-killing Python is not graceful shutdown. Browser support and a real human permission prompt are not certified. Network loss after POST may leave a bounded unknown job running; automatic resubmission is unsafe. This is not an authenticated multiuser/public service.

## Review finding and re-review

The initial frozen implementation allowed absent English OCR with only a profile-string omission; its primary launch example omitted the model. I requested explicit structured missing-OCR capability/warning and exact model hash in invocation provenance. Baseline comparison without OCR may remain supported, provided incompleteness is visible. Owner accepted this finding; final re-review follows below.

The owner fixed the finding and explicitly re-froze the batch. Missing OCR now produces capabilities.textModelConfigured=false plus ocr-language-not-configured in health, submission and status; the result client preserves warnings/capabilities and needsReview. Configured English uses the exact measured digest, recorded as textModelSha256 in invocation.json; absent-model provenance records null. The primary README launch enables the pinned English model. Baseline no-OCR comparison remains explicitly available with its warning.

Independent re-review passed three targeted adapter/metadata checks (0.68 seconds) and all four client checks (74 ms). Final operational source hashes match connector-wave/final-reviewed-source-hashes.json. The owner's complete focused Python run records 35 passing tests; I did not duplicate that whole suite. Evidence is connector-review/metadata-rereview.log and client-rereview.log. No heavy recognition/browser work was run during the coordinator's standing timing gates.

Historical browser-reviewed-eng evidence intentionally retains the exact pre-metadata-fix source hashes. The new final source has focused-tested additive metadata/provenance changes; no new full browser/native recognition run is claimed for that revision. The exact native command/profile and raw-result path are unchanged. This distinction preserves evidence rather than rewriting old hashes.

**Verdict: accepted for experimental loopback integration, with no outstanding blocking finding in this reviewed scope.** Correct output handoff, explicit unreviewed provenance, original PDF pass-through, pinned OCR setup and bounded lifecycle are sufficiently supported. Standing repository verification and final actual scan UI acceptance remain coordinator gates. Recognition remains experimental: clear synthetic inputs are measured, real camera-photo robustness and arbitrary-score completeness are not established. No claim of perfect transcription, public-service readiness or universal browser compatibility is accepted.
