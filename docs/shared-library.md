# Shared library

Readers can share a score from **My scores** with everyone. Nothing they share is public until the owner has read it, anyone can report a shared score, and removal deletes it. The decision and the options weighed are in `docs/research/shared-library-options.md` ([#132](https://github.com/MarchalMaxim/digitus2/issues/132)); the app's screens are in `docs/app.md` (Library, Score view).

## What runs where

| Part                          | Where                                                                                                                                               | Code                            |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Sharing, the shelf, reporting | The reader's browser, served by GitHub Pages                                                                                                        | `apps/web/src/library/shared/`  |
| The store                     | Firestore (Standard edition, database `(default)`, `europe-west4`) in the Google Cloud project `digitus2-library`, which has **no billing account** | `library-store/`                |
| The store's checks            | Firestore security rules; there is no server code                                                                                                   | `library-store/firestore.rules` |
| Moderation                    | The Firebase console, by the owner                                                                                                                  | none                            |

The app speaks Firestore's REST API with `fetch` (no Firebase SDK, no API key, no sign-in). `VITE_LIBRARY_STORE` names another store address for development; the e2e specs fake the store in the browser.

## What is stored

Collection `shared`, one document per upload. The document's id is 128 random bits chosen by the reader's browser and kept in their My scores entry; nobody else learns it until the owner shares the score.

| Field               | Content                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| `title`, `composer` | What the reader typed on the share sheet (prefilled from the MusicXML, never from the file name)   |
| `score`             | The MusicXML, deflated and base64-encoded, at most 100,000 characters                              |
| `kind`              | `scan` or `file`                                                                                   |
| `app`               | The app version                                                                                    |
| `status`            | `waiting`, or `shared` once the owner approves it                                                  |
| `created`           | The time Firestore received it                                                                     |
| `link`              | `https://marchalmaxim.github.io/digitus2/#/shared/<id>`, so the owner can open it from the console |

Collection `reports`: `score` (the shared id), `reason` (`copyright`, `abuse` or `broken`), `note`, `reply` (a way to answer, required for copyright) and `created`.

No name, file name, photo, address or IP address is stored. The photo of a scan never leaves the scan service (`docs/scanning.md`).

## The rules

| Who                                 | May                                                                                                                                                                                |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anyone                              | Create a `shared` document of exactly the shape above, with `status` `waiting`, `created` set by Firestore, an id of 32 lowercase hex digits and the matching `link`; nothing else |
| Anyone with an id                   | Read that one document, waiting or shared                                                                                                                                          |
| Anyone                              | List shared documents only (`status == "shared"`), at most 50 at a time                                                                                                            |
| The uploader (whoever holds the id) | Delete it while it waits                                                                                                                                                           |
| Anyone                              | Create a report of exactly its shape; nobody reads, changes or deletes reports                                                                                                     |
| Nobody                              | Change a document                                                                                                                                                                  |
| The owner, in the console           | Everything; the console is not bound by the rules                                                                                                                                  |

`library-store/rules.test.mjs` checks each line of this table through the same REST calls the app makes, against the Firestore emulator (`pnpm verify`, step `library:rules`).

## Moderating

In the Firebase console, open **Firestore Database → Data** for the project `digitus2-library` (https://console.firebase.google.com/project/digitus2-library/firestore/data).

| To                    | Do                                                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| See what waits        | Collection `shared`; each document shows its title, composer, status and link                                     |
| Read and hear a score | Copy its `link` into the browser: it opens in digitus like any score                                              |
| Approve               | Click `status`, change `waiting` to `shared`, save. It appears on the "Shared by readers" shelf on the next visit |
| Refuse                | Delete the document. The uploader's row then reads "Not shared"                                                   |
| Remove a shared score | Delete the document                                                                                               |
| Handle reports        | Collection `reports`: each names the score's id; delete the score if the report holds, then delete the report     |

Removal requests from outside the app arrive as GitHub issues from the **Remove a shared score** form (`.github/ISSUE_TEMPLATE/remove-a-score.yml`); the report sheet links to it when the store does not answer.

There is no notification of new uploads or reports: the owner looks in the console.

## Quotas and cost

The project has no billing account, so it runs on Firestore's no-cost quota and cannot be charged.

| Quota            |        Per day | What uses it                                                                                                                       |
| ---------------- | -------------: | ---------------------------------------------------------------------------------------------------------------------------------- |
| Document reads   |         50,000 | The shelf (5 a library visit, 20 more for "More shared scores"), one per opened shared score, one per shared My scores row a visit |
| Document writes  |         20,000 | One per upload and per report                                                                                                      |
| Document deletes |         20,000 | Withdrawals                                                                                                                        |
| Stored data      |   1 GiB in all | Over 100,000 typical scores                                                                                                        |
| Outbound data    | 10 GiB a month | About a million openings of a 10 KB score                                                                                          |

When a quota is spent, Firestore refuses requests until it resets; the Firebase plan page says a product over its no-cost quota is switched off for the rest of the month. The app then shows no shelf, says sharing is not available, and the report sheet points to the GitHub form. Scanning is a separate project and is not affected. If scripted abuse becomes a habit, App Check with reCAPTCHA (free on this plan) is the next step.

## Setting it up

From the owner's machine, in PowerShell 7 with gcloud signed in as the owner:

```powershell
pwsh -File library-store/setup.ps1
```

It creates the project if it is missing, refuses to continue if billing is linked, enables the Firebase, Firestore and Rules APIs, adds Firebase, creates the database in `europe-west4` and the shelf's index (`status`, then `created` descending; also in `firestore.indexes.json` for the emulator), and deploys `firestore.rules` through the Firebase Rules API. It needs no Firebase CLI. Run it again after changing the rules. The emulator for the rules tests runs in Docker (`library-store/emulator.Dockerfile`).

## Sources

- Firestore pricing and free quota: https://firebase.google.com/docs/firestore/pricing
- Firestore usage and limits: https://firebase.google.com/docs/firestore/quotas
- Firebase pricing plans: https://firebase.google.com/docs/projects/billing/firebase-pricing-plans
- Firestore REST API: https://firebase.google.com/docs/firestore/use-rest-api
- Firestore security rules: https://firebase.google.com/docs/firestore/security/get-started
