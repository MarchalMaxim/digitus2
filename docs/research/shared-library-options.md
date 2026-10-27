# Shared library of readers' scores: options

**Open decision: [#132](https://github.com/MarchalMaxim/digitus2/issues/132).** The owner asks to "allow the user to store their scores in a shared library", free, on Google Cloud, with a light copyright notice. Section 7 recommends a pre-moderated store on Firestore in a Google Cloud project without billing (option 3). Section 8 states the decision. Nothing is built until the owner picks.

The owner closed the first request for this, [#41](https://github.com/MarchalMaxim/digitus2/issues/41), with "no shared library" (option (c) of the first study, section 9). #132 reopens the question, so the study names the decisions it touches and what each option makes of them.

## 1. What #132 asks, and what it conflicts with

The owner's words:

> Allow the user to store their scores in a shared library.
> Think about shared library design: consult design agent
> Think about costs and cloud infrastructure: use something free, halt development if costs are going to play a role (use google cloud platform, the current choice for our cloud infra)
> Think about a copyright disclaimer yada yada (this is a private application, so don't worry about it too much)

Three recorded decisions stand against it:

| Decision | Where | What it says |
|---|---|---|
| No shared library | #41, closed by the owner | "Owner's decision: no shared library. … readers share files themselves, the library stays curated by the owner, and the app stays Pages-only with no login and no upload." |
| No shared library of uploads | `docs/PROGRESS.md`, Decisions | "readers share files themselves and the library stays curated" |
| GitHub Pages only, no login, one server | `CLAUDE.md`, Fixed decisions; `docs/PROGRESS.md` | The app is static on GitHub Pages, public, with no login; the scan service on Cloud Run is the one server |
| Files go only to the scan service | `docs/scanning.md` | A page goes to the scan service only when the reader presses **Scan this score**; nothing is published automatically |

One premise of #132 does not hold: the app is not private. It is public at https://marchalmaxim.github.io/digitus2/ with no login, so a shared library is readable and writable by anyone on the internet. Every judgement below follows from that.

## 2. Who shares, and what arrives

My scores holds three kinds of entry (`apps/web/src/library/local/records.ts`): scans, MusicXML imports and MIDI imports. Sharing is offered only for entries whose MusicXML passes the strict import, the same condition that enables **Use for fingerings**. MIDI imports are left out: they capture a performance, and imported MIDI cuts held notes short (#34).

What arrives is mostly someone else's music. A beginner scans the page in front of them: a method book, a teacher's handout, a pop arrangement. Those are modern printed editions under copyright. The public-domain classics a beginner plays are already in the library (3,245 pieces), so the uploads that add something are the ones most likely to be under copyright.

## 3. Anonymous uploads: the judgement

Cost is the smaller question (section 5). The larger one is that the project becomes the host of what strangers upload.

**Copyright.** The project's MIT licence covers its code, not the scores it hosts, and being non-commercial is no defence against a rights holder. Two EU rules decide the exposure:

- The upload-filter duty of the Copyright Directive (Article 17) binds "online content-sharing service providers", which Article 2(6) defines by organising and promoting content "for profit-making purposes" [9]. A non-commercial hobby site falls outside it.
- What remains is the hosting rule of the Digital Services Act (Article 6) [8]: a host is not liable for what a user stores as long as it has no actual knowledge of illegal content and, once it learns of it, acts expeditiously to remove or disable it. Article 16 asks hosts for a notice mechanism that anyone can use electronically. Article 19 exempts micro and small enterprises only from the online-platform section, not from Article 16. Whether a free, non-commercial site is an "information society service" at all (one "normally provided for remuneration" [10]) is not settled for hobby sites; the design follows Article 16 either way, because a working notice-and-removal path is what keeps the liability rule on the owner's side.

So a light copyright notice is enough only when two things stand behind it: nothing becomes public before someone looks, and anyone can report a score and see it removed. Without those, the notice protects nobody.

**The PDMX precedent does not carry over.** The owner accepted the archive lanes' broad reading: a score is admitted on its uploader's declaration to MuseScore (`docs/PROGRESS.md`). There a third party collected the declaration, tied to an account, and the owner chooses which pieces to copy. Here the declaration is an anonymous tick, and the project is the first host.

**Moderation and abuse.** An open write endpoint on a beginners' site attracts spam titles, slurs and junk files; a MusicXML file can carry any text in its title, lyrics and credits. An upload that is listed at once puts that in front of children before anyone sees it. An upload that waits for the owner reaches no one but the owner.

**Deletion and takedown.** Three kinds of removal are needed:

| Who | How | Option 3 |
|---|---|---|
| The uploader, while the score waits | **Withdraw** on their My scores row | The upload's id is a random 128-bit key kept only in their browser; the rules let whoever holds it delete a waiting upload |
| A rights holder or any reader, once it is shared | **Report** in the score view, no account | A report document in the store; the owner reads reports and deletes the score |
| The owner | One command, or the Firebase console | Deleting a document removes it for good; nothing stays in git history |

**Personal data.** An upload stores no name, file name, address or IP address. A copyright report asks for a way to reply (an e-mail address), because a rights holder's notice needs an answer; the owner deletes the report once it is handled.

**Judgement.** Anonymous uploads with a light notice are acceptable only pre-moderated, with a report path, and with removal that really deletes. Published-at-once uploads (option 4) are not: they make the owner the host of whatever arrives, in front of beginners, with the notice as the only filter. The price of pre-moderation is the owner's time on every upload and a high refusal rate for scans of modern editions.

## 4. Options

| | 1 Do not build | 2 GitHub issue submissions | 3 Pre-moderated store on Firestore | 4 Published at once on Firestore |
|---|---|---|---|---|
| How a reader shares | Saves the MusicXML and sends it themselves | **Share** saves a file and opens a GitHub issue form; the reader signs in on github.com and attaches it | **Share** opens a sheet: title, composer, one tick; the score waits for the owner | As 3, listed at once |
| Others can find it | no | yes, once ingested into the library | yes, on a "Shared by readers" shelf | yes, at once |
| Reader needs an account | no | GitHub | no | no |
| Public before review | n/a | yes (issue attachments are public) | no | yes |
| Moderation | none needed | the owner reviews issues and runs the library gates | the owner approves each upload | reports only, after the fact |
| Removal | n/a | git history keeps old blobs | real deletion | real deletion |
| Gates (XSD, spans, lint, dedupe) | n/a | all, through `content/tools` | strict import only | strict import only |
| Money | 0 | 0 | 0 (section 5) | 0 (section 5) |
| Owner time per upload (estimate) | 0 | about 10 min | 1 to 3 min | per report only |

Option 2 is option (a) of the first study (section 9), which remains valid: it is free and keeps every fixed decision, at the price of a GitHub account for every reader who shares.

### What each recorded decision becomes

| Decision | 1 Do not build | 2 GitHub issues | 3 Pre-moderated Firestore | 4 Published at once |
|---|---|---|---|---|
| #41 "no shared library" | stands; #132 is closed with the reason | reversed; #132 supersedes it | reversed; #132 supersedes it | reversed; #132 supersedes it |
| `docs/PROGRESS.md` "No shared library of uploads" | unchanged | "Readers share through a GitHub issue form; the owner admits scores into the library through the gates" | "Readers share anonymously into a pre-moderated store on Firestore; the owner approves each score; anyone can report one" | as 3, without approval |
| `CLAUDE.md` "GitHub Pages only" | unchanged | unchanged | holds for the app; the app also reads and writes Firestore through Google's REST API; no server code of the project's own | as 3 |
| `CLAUDE.md` "no login" | unchanged | unchanged in the app; publishers sign in on github.com | unchanged for readers; the owner moderates with their own Google credentials outside the app | as 3 |
| `CLAUDE.md` "one server, the scan service" | unchanged | unchanged | a second Google service: a Firestore database, with no code running on it | as 3 |
| `docs/scanning.md` "files go only to the scan service" | unchanged | unchanged; the reader uploads on github.com | the photo still goes only to the scan service; a score's MusicXML goes to Firestore when the reader presses **Share** | as 3 |

## 5. Cost on Google Cloud

The store is Firestore (Standard edition) in `europe-west4`, the scan service's region. Firestore keeps each score as one document; Cloud Storage is left out because its free tier exists only in three US regions [2]. The app talks to Firestore through its REST API, not the Firebase SDK, so the library page stays within its 150 KB budget; there is no Cloud Run endpoint and no function.

Table 1. Free tiers used (Firestore's are per project; one free database per project [3])

| Resource | Free | Library use |
|---|---:|---|
| Stored data | 1 GiB [2][3] | A score is stored deflated: the library's median is 7,819 characters, its largest 60,286 (table 3). 1 GiB holds over 100,000 median scores |
| Document writes | 20,000 a day [2][3] | One per upload, one per report, one per approval |
| Document reads | 50,000 a day [2][3] | One index document per library visit, one score per opening; a query costs at least one read even when empty [3] |
| Document deletes | 20,000 a day [2][3] | Withdrawals and removals |
| Outbound data | 10 GiB a month [2][3] | About a million openings of a 10 KB score |
| Document size | 1 MiB limit [4] | The rules cap a score at 100,000 characters, above the library's largest |

Table 2. Price beyond the free tier, Firestore Standard, Netherlands (europe-west4), US dollars [1]

| Item | Price |
|---|---:|
| Reads | $0.034 per 100,000 |
| Writes | $0.102 per 100,000 |
| Deletes | $0.011 per 100,000 |
| Stored data | $0.17 per GiB-month |

**Where the store lives decides the worst case.** The owner asked for Google Cloud, the current choice; there are two ways to use it.

| | 3a: a sibling project with no billing account (recommended) | 3b: the existing `digitus2-scan` project |
|---|---|---|
| Can it cost money | No. A project without a billing account runs on the no-cost quota only ("No payment method needed" [5]) | Yes, beyond the free tier, up to the 10-a-month budget and its kill switch (`docs/scan-service.md`) |
| Worst case: a script writes 100 junk documents a second at the 100,000-character cap | Writes stop at 20,000 for the day; the pricing-plans page says a product that exceeds its no-cost quota is shut off for the rest of the month [6], the quota page says quotas reset daily [4]. The library stops taking uploads; nothing is billed | 8.64 million writes a day ($8.81) and about 805 GiB stored ($4.50 for each day kept): over the budget within about a day. The kill switch then unlinks billing for the whole project [19], and **scanning stops too**, for the rest of the month |
| Scanning's free grant | Untouched: Firestore needs no Cloud Run | Untouched by Firestore itself; any Cloud Run endpoint would share the 180,000 free vCPU-seconds with scanning, because that grant is per billing account [2][7] |
| Reads exhausted by a script | The shelf is empty until the quota resets | Billed at $0.034 per 100,000 until the kill switch |

Option 3a stays free by construction, not by monitoring, which is the "halt if costs play a role" the owner asked for, enforced by Google. Its failure is a library that stops taking uploads until the quota resets; the owner then deletes the junk (deletes are free up to 20,000 a day). If abuse becomes a habit, App Check with reCAPTCHA is free on the no-cost plan [5] and blocks scripts; it costs a third-party widget and the colour guard's attention, so it is not in the first version.

Option 2 costs nothing on Google Cloud. Option 4 has option 3's costs.

## 6. Design

Mock-ups, interactive, in light and dark at 1280 and 360 px: https://claude.ai/artifact/MwN2J2jY2RDQGVUDk2jCyb (private to the owner). They use the app's own tokens; each screen has exactly one red, and each lists what it adds and what stays out.

| Screen | What appears | What stays out |
|---|---|---|
| My scores | One text button, **Share**, on eligible rows, beside **Remove**. My scores stays folded and appears only when it has entries | Nothing on the library page, the score view or the scan page. The red stays on Start |
| Share sheet | Title and composer, prefilled from the MusicXML (never from the file name); one sentence: "Share only music that is out of copyright or that you wrote. The owner reads each score before anyone else can find it."; one required tick, "This music is free to share"; **Share** is the red while the sheet is open. A bottom sheet on phones | No licence menu, no source field, no account, no bot check |
| Waiting | The row reads "Waiting for review"; **Share** becomes **Withdraw**. Later "Shared", or "Not shared" with **Share** again | No inbox, no notifications |
| Shared shelf | "Shared by readers", after the curated shelves of the chosen level, newest first, five rows like every shelf; it appears only once one score is approved. Search includes shared pieces when the list is long enough for search to appear | No uploader names, counts, likes or comments |
| Shared score | One gray line under the composer, "Shared by a reader", and a **Report** text button. The red stays on the note to play | No licence badge, no disclaimer banner |
| Report | Three reasons (under copyright; offensive or spam; does not play right) and an optional note; "How can the owner reply to you?" appears only for copyright. **Send report** is the red | No account; the score stays up until the owner acts |

The copyright notice is the one sentence on the share sheet and the report reason: light, as the owner wants, and placed where a reader decides something.

## 7. Recommendation

**Option 3a: a pre-moderated store on Firestore, in a sibling Google Cloud project with no billing account.**

- It does what #132 asks: anyone shares in two fields and a tick, with no account, and others find approved scores on a shelf.
- It is free by construction. The worst a script can do is stop uploads until the quota resets; it cannot spend money or take scanning down. In `digitus2-scan` (3b) the same script would trip the kill switch and stop scanning for the month.
- It keeps the owner's light notice honest: nothing is public before the owner has read it, anyone can report, and removal deletes. That is what the hosting rules ask of a host, whatever the notice says.
- It changes three recorded decisions (section 4): #41 and the PROGRESS line are reversed, and "one server" becomes "one server and one database". The app stays on GitHub Pages with no login for readers.

What it costs the owner is time: every upload waits for them, and most scans of modern editions will be refused. **If the owner does not want to read every upload, the recommendation is option 1: do not build it**, keep #41's decision and close #132 with that reason. Option 4 (published at once) is not recommended at any price, and option 2 remains the choice if readers needing a GitHub account is acceptable and Google Cloud is not wanted.

## 8. The decision for the owner

> Is a shared library wanted, and if so, how?
> 1. **Yes, pre-moderated, on Firestore in a project without billing (3a, recommended).** You approve every upload; it can never cost money; scanning is unaffected.
> 2. **Yes, pre-moderated, in the existing `digitus2-scan` project (3b).** As 3a, but abuse can reach the 10-a-month budget and stop scanning for the month.
> 3. **Yes, through GitHub issues (2).** Readers need a GitHub account; no Google Cloud.
> 4. **No (1).** Close #132; #41's decision stands.

### Implementation sketch for option 3

| Piece | What it is |
|---|---|
| Google Cloud project `digitus2-library` | Firestore Standard, `europe-west4`, no billing account; created by a script in `research/library/` like the scan service's `deploy.ps1` |
| Collection `shared/{id}` | `id`: 128 random bits from the browser. Fields: `title`, `composer`, `score` (deflated base64 MusicXML), `kind` (scan or file), `app` (version), `status` (`waiting`, `shared`), `created` (server time). No name, file name or address |
| Document `index/shared` | The approved list (id, title, composer, level, length), one read per visit; rewritten by the owner's command |
| Collection `reports/{id}` | `score`, `reason`, `note`, `reply` (only for copyright), `created` |
| Security rules | Anyone may create a `shared` document with exactly these fields, `status == 'waiting'`, `created == request.time` and `score` under 100,000 characters; anyone may get one by id (only its uploader knows a waiting id); listing is denied; delete only while `waiting`; no updates. Anyone may create a report with the same shape checks; nobody may read reports. Anyone may read `index/shared` |
| `apps/web/src/library/shared/` (new) | REST calls (create, get, delete, read the index, create a report), the share and report sheets, the shelf; strict import for every opened score, as for a reader's own file |
| `apps/web/src/library/local/MyScores.tsx` | **Share**, **Withdraw** and the row states |
| `content/tools/library.py` (new) | The owner's command: `waiting` lists uploads, `show ID` writes the MusicXML to open in the app, `approve ID` and `remove ID` set the status or delete and rewrite the index, `reports` lists and clears reports. Runs with the owner's Google credentials |
| Docs | `docs/scanning.md` (where a score goes on Share), `docs/app.md` (Library), `docs/PROGRESS.md` and `CLAUDE.md` (the decisions in section 4), a short page for the shared library's rules and the owner's commands |

Checklist for #132, once the owner picks option 3:

- [ ] The project, database and rules, with rule tests in the Firestore emulator (every refused shape, every allowed one).
- [ ] The share sheet, the row states and Withdraw, in all five locales.
- [ ] The shelf and the shared score's line and Report, in all five locales.
- [ ] The owner's command, with pytest on fixture documents.
- [ ] Docs and the decisions in section 4.
- [ ] One upload end to end: shared, approved, found on the shelf, reported, removed.

Verification: vitest for the REST client and the payload (no file name, the size cap, MIDI refused); Playwright against the Firestore emulator for share, withdraw, shelf, report, and that no request leaves the app before **Share** or **Send report**; the colour guard (one red per screen); the bundle budget (no Firebase SDK); `pnpm verify`.

## 9. The first study ([#41](https://github.com/MarchalMaxim/digitus2/issues/41))

The first study weighed four options under Pages-only and no login. The owner chose (c) and closed #41; #132 reopens the question. Its findings still hold and inform section 4.

**(a) Publish through GitHub.** A **Share** text button in a My scores row saves `score.digitus2.json` (the MusicXML, kind, recogniser and app version; no file names) and opens a prefilled issue form, `share-a-score.yml`, with the title only: an `upload` field cannot be filled from a URL [13], and the score cannot travel in the URL (an over-long URL gets `414 URI Too Long` [12]; table 3). The reader fills title, composer, arranger, source, a licence from the four `build.py` accepts (public domain, CC0, CC BY, CC BY-SA) and two required checkboxes, then attaches the file. The owner runs an ingest (`content/tools/submission.py`) that downloads the attachment as untrusted input, builds it with `build.py --source community` and runs `gates.py` and `dedupe.py`; a PR lands it under "Shared by readers". A **Remove a score** form and GitHub's DMCA process [18] handle removal, though git history keeps old blobs. Every publisher needs a GitHub account [16]; attachments in a public repository are readable before review [11]; only the account owner can delete an issue [14]; interaction limits curb spam [15]. Cost: none in money, about 10 minutes of owner time per submission (estimate).

**(b) A third-party store with anonymous writes.** Cloudflare Workers, R2 and Turnstile [20][21][22]; a form service is weaker (Formspree's free plan has no file uploads [23]). It reverses "no server" and needs a moderator login. #132's choice of Google Cloud replaces it with options 3 and 4.

**(c) Pull-only.** Readers download the MusicXML and send it themselves, by the Web Share API on phones [24]. Nothing new is stored. This is the decision #41 records and option 1 here.

**(d) A score link.** **Copy link** puts the deflated MusicXML in the URL fragment, which never reaches the server [17]. Nothing is stored; links work best for short pieces (table 3). It can be requested on its own, under any option.

Table 3. Library scores as deflated text (MusicXML, raw deflate level 9, base64; 2,702 scores in `content/scores/`)

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

## Sources

1. Firestore pricing (Standard edition, pricing by location): https://cloud.google.com/firestore/pricing
2. Google Cloud free tier (Cloud Run, Cloud Storage regions, Firestore; per billing account): https://docs.cloud.google.com/free/docs/free-cloud-features
3. Firestore billing and free quota (one free database per project; minimum one read per query): https://firebase.google.com/docs/firestore/pricing
4. Firestore usage and limits (1 MiB document; quotas reset around midnight Pacific time): https://firebase.google.com/docs/firestore/quotas
5. Firebase pricing (no-cost plan: Firestore quotas, "No payment method needed", App Check): https://firebase.google.com/pricing
6. Firebase pricing plans (a product over its no-cost quota is shut off for the rest of the month): https://firebase.google.com/docs/projects/billing/firebase-pricing-plans
7. Cloud Run pricing: https://cloud.google.com/run/pricing
8. Regulation (EU) 2022/2065 (Digital Services Act), Articles 6, 16 and 19: https://eur-lex.europa.eu/eli/reg/2022/2065/oj
9. Directive (EU) 2019/790 (Copyright in the Digital Single Market), Articles 2(6) and 17: https://eur-lex.europa.eu/eli/dir/2019/790/oj
10. Directive (EU) 2015/1535, Article 1(1)(b) (information society service): https://eur-lex.europa.eu/eli/dir/2015/1535/oj
11. GitHub Docs, Attaching files: https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files
12. GitHub Docs, Creating an issue (URL query parameters, 414): https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-an-issue
13. GitHub Docs, Syntax for GitHub's form schema (`upload`, required checkboxes): https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-githubs-form-schema
14. GitHub Docs, Deleting an issue: https://docs.github.com/en/issues/tracking-your-work-with-issues/administering-issues/deleting-an-issue
15. GitHub Docs, Limiting interactions in your repository: https://docs.github.com/en/communities/moderating-comments-and-conversations/limiting-interactions-in-your-repository
16. GitHub Docs, Creating an account on GitHub: https://docs.github.com/en/get-started/start-your-journey/creating-an-account-on-github
17. MDN, URI fragment: https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Fragment
18. GitHub DMCA Takedown Policy: https://docs.github.com/en/site-policy/content-removal-policies/dmca-takedown-policy
19. Google Cloud, Disable billing usage with notifications: https://docs.cloud.google.com/billing/docs/how-to/disable-billing-with-notifications
20. Cloudflare Workers pricing: https://developers.cloudflare.com/workers/platform/pricing/
21. Cloudflare R2 pricing: https://developers.cloudflare.com/r2/pricing/
22. Cloudflare Turnstile plans: https://developers.cloudflare.com/turnstile/plans/
23. Formspree plans: https://formspree.io/plans
24. MDN, Navigator.share(): https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share
