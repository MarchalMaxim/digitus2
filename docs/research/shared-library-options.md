# Shared library of readers' scores: options

**Decision: option (c).** The owner declined a shared library; the document stays as the record of the options weighed.

This study answers [#41](https://github.com/MarchalMaxim/digitus2/issues/41): "Make uploaded or recognised scores available to other people", with explicit publishing, provenance and redistribution permission per score, and removal and moderation. It also asks whether this is still wanted under the Pages-only, no-login decision. Section 4 states the decision the owner has to take.

## 1. Constraints

The site is GitHub Pages only: static files, public, no VPS and no login (CLAUDE.md, `docs/PROGRESS.md`); the one server process is the scan service on Cloud Run, which recognises a page and keeps nothing (`docs/scan-service.md`). The owner closed the login request with "I ONLY want it on github pages" and asked for no big-tech OAuth (T4 in `docs/TODO.md`). `docs/scanning.md` promises that a page goes only to the scan service, and only when the reader presses **Scan this score**; uploads stay in IndexedDB ("My scores"), and nothing is published automatically. Library pieces enter the repository only through `content/tools`: a catalog entry with a `source` block (`name`, `url`, `license`, `licenseUrl`, `retrievedAt`), `build.py`, which refuses every licence except public domain, CC0, CC BY and CC BY-SA, and the gates (XSD, two-staff rule, validator, spans, zero lint law errors, level, dedupe). The repository is public and MIT, the project is non-commercial, and the repository budget is 100 MB with 1.5 MB per score (`scripts/check-repo-size.mjs`). The UI rule allows a control only where a beginner needs it, and only one red element on screen. The fixed decisions therefore allow anything that runs in the browser, or on github.com through the reader's own action, plus an offline step by the owner. They forbid any other server of the project's own, a login in the app, and any automatic upload.

## 2. Options

Two facts apply to every option.

- **Who can publish.** My scores holds three kinds of entry (`apps/web/src/library/local/records.ts`): scans, plain MusicXML imports and MIDI imports. Publishing is offered only for entries whose MusicXML passes the strict import, the same condition that enables **Use for fingerings**. MIDI imports are left out, because they capture a performance, and imported MIDI cuts held notes short (#34).
- **Licence.** The redistribution licence is one of the four that `build.py` already accepts: public domain, CC0, CC BY and CC BY-SA. Widening the list to NC licences is a decision for #37. A recognised score also records its source edition (publisher and year), because a photo of a modern printed edition is not the photographer's to license. The admission rule follows the PDMX precedent the owner accepted: the uploader's declaration plus content exclusions.

### (a) Publish through GitHub: a prefilled issue form, reviewed by the owner, ingested through the gates

How a reader publishes:

1. In **My scores**, an eligible row shows one more text button, **Share**, next to **Remove**.
2. Pressing it saves one file, `score.digitus2.json`, and opens `github.com/MarchalMaxim/digitus2/issues/new?template=share-a-score.yml&title=...` in a new tab. The file holds the MusicXML as a string and the provenance the app knows: kind (scan or file), recogniser name and version, and the app version. It holds no file names, photos or IndexedDB ids, because a file name can be personal. The prefilled title comes only from the MusicXML `<work-title>` or `<movement-title>` and is left blank otherwise. It never comes from the My scores label, which is the file name.
3. On GitHub, signed in, the reader fills the form: title, composer, arranger, and source (own work, printed edition with publisher and year, or a website URL). They pick a licence from a dropdown of the four. For CC BY and CC BY-SA they also fill **Credit as**, the name the licence requires to be credited. Then they tick two required checkboxes ("the music is in the public domain or mine to license"; "I license this MusicXML under the chosen licence"), then drag the saved file into the form's `upload` field and submit.

Publishing takes two steps, not one click. An `upload` field cannot be filled from a URL [3], and the score cannot travel in the URL either: an over-long URL gets `414 URI Too Long` [2], and the measured median library score is 7,819 characters after deflate and base64 (table 2). The prefill carries only the title. A fork-and-PR route exists for experienced contributors; it needs the same account and is not linked from the app.

- **Data.** The issue and its attachment live on github.com. An admitted score lives in the repository like any other piece: `catalog.d/community.json`, `scores/<slug>.musicxml.gz` and a manifest entry with `source.name` "Shared by a reader" and `source.url` set to the issue.
- **Provenance and licence.** The declaration is the form: the dropdown licence, the source field, the credit and the required checkboxes. The declaration sits in the form rather than the package because the form is where the checkboxes are enforced: required checkboxes work only in public repositories [3], and this one is public. The issue ties the declaration to a GitHub account and a timestamp. A CC BY or CC BY-SA credit goes into the manifest entry and the score's `<rights>`, in the same place the Mutopia typesetter goes today (`build.rights_text`).
- **Moderation and removal.** The form applies a `submission` label. The owner reads the issue, checks the licence, the source and the content exclusions of the PDMX lanes, then runs the ingest. The ingest downloads the attachment into `content/_raw/submissions/<n>/`, treats it as untrusted, builds it with `build.py --source community` (fingerings stripped, `validate.check_file`, gzip) and runs `gates.py` and `dedupe.py`; a PR with "Closes #n" then lands it. A refused submission gets a comment and is closed. A **Remove a score** form is open to anyone, including rights holders; the owner moves the entry to the fragment's `rejected` list with the reason, and the next deploy drops it. That form needs an account too; a rights holder without one can use GitHub's DMCA process, which covers the repository [8]. Git history keeps old blobs.
- **App change.** One text button in a My scores row, never on library pieces and never in the score view. My scores is already folded away (`<details>`) and appears only when it has entries. No new red. Five locales (en, es, fr, nl, pt) get two strings. Admitted pieces appear under one collection, "Shared by readers", with the existing disclosure thresholds.
- **Cost.** No money. Maintenance: two issue forms, one ingest script, one build source. Owner time per submission: an estimate of about 10 minutes to read the issue, run the ingest and merge the PR (not measured).
- **Privacy.** The app sends nothing. It saves a file and opens a link whose only data is the score's title. The reader uploads on github.com by their own action. The submitter's GitHub username becomes public. **The attachment is public before review**: in public repositories uploaded files can be read without authentication [1], so review controls entry into the library, not exposure. Only the account owner can delete an issue [4]; the docs do not say whether an attachment URL stops resolving after deletion [1], so the study does not claim it.
- **Abuse surface.** Spam issues, which GitHub's own spam handling and interaction limits cover (24 hours to 6 months, for example "prior contributors only" [5]). Malicious files: the ingest parses with entity resolution off, refuses a DOCTYPE, and enforces the 1.5 MB budget before the XSD runs. A false licence declaration is the same risk the owner accepted for PDMX.
- **Fixed decisions.** Pages-only and no-login in the app hold. Every publisher needs a GitHub account ("To get started with GitHub.com, you need to have a personal account and a verified email address" [6]), which is a Microsoft-owned account. That is not OAuth in the app, but it is the closest this option comes to what T4 refused, and it is this option's main cost.

### (b) A third-party hosted store with anonymous writes, moderated by the owner

How a reader publishes: **Share** in a My scores row opens a small sheet in the app with title, composer, source, a licence choice, the attestation and a bot check (Cloudflare Turnstile). Submit sends the MusicXML and the declaration to a serverless function (a Cloudflare Worker) that writes it to object storage (R2) in a "pending" queue. The owner approves or rejects it on a moderator page, and approved scores are listed in a public index that the app fetches at start.

- **Data.** A Cloudflare account outside the repository. Approved scores are served from R2, or pulled into the repository by the owner. Pulling them in reproduces (a) with more infrastructure; serving them from R2 bypasses the Python gates, because the Worker can run only TypeScript checks.
- **Provenance and licence.** The same fields as (a), stored as JSON next to the score. With no account, an attestation is tied only to an IP address and a timestamp.
- **Moderation and removal.** The owner works through the queue. The moderator page needs a login (Cloudflare Access or a secret), which brings back a login, even if only the owner's. The owner is the host of anonymous uploads and needs a notice-and-action channel for illegal content (EU Digital Services Act, Article 16 [9]).
- **App change.** A new sheet with five fields and a submit button: the largest UI addition of the four options. Turnstile is a third-party widget whose colours the colour guard has to check. The app gains a network dependency at start for the shared index.
- **Cost.** Workers free plan: 100,000 requests a day, 10 ms of CPU per request; the paid plan has a $5 monthly minimum [10]. R2: 10 GB-month free, no egress fee [11]. Turnstile: free [12]. A form service is weaker: Formspree's free plan has no file uploads, and Personal costs $15 a month for 1 GB [13]. Maintenance: a deployed function, keys, quota alerts, dependency updates, and the queue. Owner time per submission: about the same review as (a), plus operations.
- **Privacy.** The score, the declaration and the reader's IP address go to Cloudflare on submit. The guarantee in `docs/scanning.md` that a page goes only to the scan service has to name a second destination.
- **Abuse surface.** The largest: anonymous writes to storage the owner pays for and answers for, quota exhaustion, illegal files stored before review, and a moderator endpoint on the internet.
- **Fixed decisions.** Reverses two: "no server" (a function and a store of the project's own) and Pages-only for the shipped app.

### (c) Pull-only: decline the shared store

How a reader shares: **Download** saves the score's MusicXML (scans already offer **Download raw MusicXML**). The reader sends it however they like. On phones, the Web Share API can hand the file straight to a chat app [14]. The recipient drops it on the app. A link to the app carries no data. The library stays curated by the owner through the existing lanes, and a reader who wants a piece in the library can open an ordinary issue.

- **Data.** Nowhere new. **Provenance.** None is captured, because nothing is published. **Moderation.** None needed.
- **App change.** None, or one **Download** text button in a My scores row for plain imports.
- **Cost.** None. **Privacy.** The guarantee holds unchanged. **Abuse surface.** None added.
- **Fixed decisions.** Holds all of them. It does not meet #41's need, because nothing becomes available to people the reader does not know.

### (d) A score link: the score travels in the URL fragment

How a reader shares: **Copy link** in a My scores row copies `https://marchalmaxim.github.io/digitus2/#/shared/<deflated base64url MusicXML>`. Whoever opens the link sees the score in the normal score view, put through the strict import, and can keep it in their own My scores. The fragment is never sent to the server [7], so GitHub Pages never sees the score.

- **Data.** Only inside the link. **Provenance.** None beyond what the MusicXML carries. **Moderation.** None is possible and none is needed, because nothing is stored or listed. A crafted link can show any title text under the project's domain, so the strict import, escaping and a plain "shared link" label matter.
- **App change.** One text button in a My scores row, plus a new `#/shared/` route in the hash router (`apps/web/src/app/routes.ts`).
- **Size.** Table 2 measures the 2,702 library scores. Half of them need more than about 8,000 characters, and chat and mail clients may truncate links that long, so links work best for short pieces.
- **Cost.** None. **Privacy.** The app sends nothing; the reader shares the link by hand. **Fixed decisions.** Holds all of them. Like (c), it is person-to-person sharing, not discovery.

## 3. Comparison

Table 1. The options against the needs and the fixed decisions

| | (a) GitHub issue | (b) Hosted store | (c) Pull-only | (d) Score link |
|---|---|---|---|---|
| Meets #41 (others can find it) | yes, in the library | yes | no | no, only who gets the link |
| Pages-only, no server | holds | reversed | holds | holds |
| Login in the app | none | none for readers; owner's moderator login | none | none |
| Publisher needs | GitHub account | nothing | nothing | nothing |
| Explicit publishing | yes, two steps | yes, one step | n/a | yes, by sharing the link |
| Provenance and licence | form fields, required checkboxes, tied to an account | form fields, tied to an IP address | none | none |
| Public before review | yes (the attachment) | no (pending queue) | n/a | n/a |
| Gates (XSD, spans, lint, dedupe) | all, through `content/tools` | only if pulled into the repository | n/a | strict import only |
| Moderation | owner, via issues and PRs | owner, via a queue | none | none possible |
| App change | 1 text button | 1 sheet, 5 fields, bot check | 0 or 1 text button | 1 text button, 1 route |
| Money | 0 | 0 on free tiers; $5 a month minimum when paid [10] | 0 | 0 |
| Owner time per submission (estimate) | about 10 min | about 10 min plus operations | 0 | 0 |
| Files go only to the scan service (`docs/scanning.md`) | holds (the reader uploads on github.com) | rewritten | holds | holds |

Table 2. Library scores as a link fragment (MusicXML, raw deflate level 9, base64; 2,702 scores in `content/scores/`)

| Measure | Characters |
|---|---:|
| 10th percentile | 3,892 |
| Median | 7,819 |
| 90th percentile | 19,983 |
| Largest | 60,286 |

| Fits within | Scores |
|---|---:|
| 2,000 characters | 29 |
| 8,000 characters | 1,407 |
| 32,000 characters | 2,638 |

## 4. Recommendation and the decision

**Recommendation: (a).** It is the only option that puts readers' scores in front of people they do not know and keeps every fixed decision: no server, Pages-only, no login in the app. Every shared score goes through the same gates and the same `source` provenance as the 2,702 library pieces, and the owner's review of an issue is the moderation. Its costs are a GitHub account for each publisher and an attachment that is public before review, and both are stated plainly in the form. Option (b) buys a one-step submission by reversing "no server", and makes the owner the host of anonymous uploads. If the owner does not want readers to need a GitHub account, the honest answer is (c): close #41. (d) can be added later as a separate request if friend-to-friend sharing is wanted.

The decision for the owner:

> Is a shared library still wanted, and if so, how?
> 1. **Yes, through GitHub issues (a).** Publishers need a GitHub account; the app stays Pages-only and login-free; the owner reviews each submission.
> 2. **Yes, through a hosted store (b).** One-step anonymous submissions; this reverses "no server" and Pages-only, and the owner runs a moderation queue.
> 3. **No: close #41 (c).** Readers share files themselves; the library stays curated. Optionally add score links (d) as a separate issue.

## 5. Implementation sketch for (a)

Files and tools:

| Path | Change |
|---|---|
| `.github/ISSUE_TEMPLATE/share-a-score.yml` | Issue form: title, composer, arranger, source, licence dropdown (4 values), credit (required for CC BY and CC BY-SA, checked by the ingest), 2 required checkboxes, `upload` with `accept: .json`, label `submission` |
| `.github/ISSUE_TEMPLATE/remove-a-score.yml` | Removal form: piece link, reason, contact on the issue |
| `apps/web/src/library/local/share.ts` (new) | Builds the `.digitus2.json` package (schema version, kind, recogniser, app version, MusicXML) and the issue URL with the title only |
| `apps/web/src/library/local/MyScores.tsx` | **Share** text button on eligible rows |
| `apps/web/src/i18n/{en,es,fr,nl,pt}/library.ts` | Button label and accessible label |
| `content/tools/submission.py` (new) | `gh issue view N --json body,labels`, parses the form, downloads the one attachment into `content/_raw/submissions/N/`, checks the schema, size and DOCTYPE, writes the catalog entry into `catalog.d/community.json` |
| `content/tools/build.py` | `--source community`, reusing the PDMX path (`strip_fingerings`, `validate.check_file`, gzip). It adds a small table that maps the 4 dropdown values to a licence id and URL, because the existing tables read Mutopia RDF text and PDMX CSV values. The credit goes into `<rights>` |
| `content/tools/README.md`, `docs/scanning.md` | The new lane; "My scores" and the guarantees explain sharing and that the attachment is public on submit |

Checklist for #41:

- [ ] The owner chooses an option (section 4).
- [ ] The issue forms for sharing and removal.
- [ ] The package builder and the **Share** control, eligible entries only, in all five locales.
- [ ] `submission.py` and `build.py --source community`, with untrusted-input handling.
- [ ] The "Shared by readers" collection in `catalog.json`.
- [ ] Docs: the lane in `content/tools/README.md` and the guarantees in `docs/scanning.md`.
- [ ] One test submission end to end, from the app to the library, on a test issue.

Verification:

- **vitest** (`share.test.ts`): the package's shape and schema version; no file names or ids in it; the issue URL holds only the template and the MusicXML title, never contains the record's file name, and stays short for a long title; MIDI imports and entries that fail the strict import are refused.
- **Playwright e2e**: **Share** appears only on eligible My scores rows, never on library pieces or in the score view. Pressing it starts a download and opens the github.com URL without any other network request from the app.
- **pytest** (`content/tools/tests/test_submission.py`, fixture issue bodies): a missing checkbox, an unknown licence, a CC BY or CC BY-SA submission without a credit, a second attachment, an oversized file, a DOCTYPE or entity and a malformed package are each refused; a good fixture produces a catalog entry whose `source` has the manifest's five fields. A CC BY fixture also carries its credit into the manifest entry and `<rights>`.
- **Gates and loop**: `gates.py --only <slug>` and `dedupe.py` on the test piece; the colour guard (no new red); the bundle budget (the package builder uses no zip library); `pnpm verify` as the definition of done.

## Sources

1. GitHub Docs, Attaching files: https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files
2. GitHub Docs, Creating an issue (URL query parameters, 414): https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-an-issue
3. GitHub Docs, Syntax for GitHub's form schema (`upload`, required checkboxes): https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-githubs-form-schema
4. GitHub Docs, Deleting an issue: https://docs.github.com/en/issues/tracking-your-work-with-issues/administering-issues/deleting-an-issue
5. GitHub Docs, Limiting interactions in your repository: https://docs.github.com/en/communities/moderating-comments-and-conversations/limiting-interactions-in-your-repository
6. GitHub Docs, Creating an account on GitHub: https://docs.github.com/en/get-started/start-your-journey/creating-an-account-on-github
7. MDN, URI fragment: https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Fragment
8. GitHub DMCA Takedown Policy: https://docs.github.com/en/site-policy/content-removal-policies/dmca-takedown-policy
9. Regulation (EU) 2022/2065 (Digital Services Act), Article 16: https://eur-lex.europa.eu/eli/reg/2022/2065/oj
10. Cloudflare Workers pricing: https://developers.cloudflare.com/workers/platform/pricing/
11. Cloudflare R2 pricing: https://developers.cloudflare.com/r2/pricing/
12. Cloudflare Turnstile plans: https://developers.cloudflare.com/turnstile/plans/
13. Formspree plans: https://formspree.io/plans
14. MDN, Navigator.share(): https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share
