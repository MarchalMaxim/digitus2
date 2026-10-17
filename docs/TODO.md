# TODO

Every request the owner makes lands here: the request in the owner's words, the agreed approach, and its status. Open items come first. Done and closed items stay at the end, one line each, so they are not requested or rebuilt twice.

Also open, tracked as GitHub issues: #5 smarter scrolling.

## Open

### T12 Held notes in imported MIDI (scheduled: M8)

> "Support the 'long' notes, i.e. the notes that are connected by a line to sound continuous. The MIDI player doesn't do that yet."

MusicXML ties already sound as one note: the parser merges a tie's segments and the player schedules the merged length. The cause is MIDI import. The importer writes one voice per hand (`packages/engine/src/io/midi/toScore.ts`), so notes of a hand that start together end together and are cut back to that hand's next onset; the app reports "N notes were shortened so each hand has one voice". In a nocturne those are exactly the held bass notes and the melody over inner voices.

Fix: engrave a held note as a note tied across the following onsets of its voice instead of cutting it (the engine already models a key held under later notes, `reach.ts`), schedule the original MIDI duration, and count in the warning only notes that could not be written. Test on Chopin Op. 48 No. 1: zero notes shortened, the bass sounds through the bar.

### T3 Phone version (scheduled: M8)

> "Does it make sense to have a mobile version for this? This one needs some refinement. I guess it could be useful for someone who wants to take a quick pic of some sheet music and get a fingering for it."

No native app: the web app already lays out from 360 px and runs everything in the browser, and native apps are a spec non-goal. Make it an installable PWA: manifest, service worker with an offline cache of the library, full screen, an install prompt only where the browser offers one, no new UI. Photo input uses the browser's camera capture through the file input and is designed phone-first.

### T5 More difficult pieces (partly done)

> "We want some more difficult songs as well." Later: substantial Chopin and Rachmaninoff, and at least 1,000 more pieces at the top level.

Done: grade 6 exists in the manifest, shown under Challenging (199 pieces; the library has 41 by Chopin and 2 by Rachmaninoff). Most come from the MuseScore archive; at the owner's choice the span and lint gates are relaxed for grade 6 only, under a ceiling of 40 law errors and 20 unplayable slices per 1,000 notes.

Open: 1,000 more at grade 6 is not reachable from the archive (about 235 candidates at most). The next lever is an advanced Mutopia lane with Chopin at its core (Op. 28, nocturnes, waltzes, mazurkas, études Op. 10 and 25, polonaises, ballades, scherzos), plus Liszt, Debussy, Scriabin, Albéniz, Granados, Brahms, Schubert, late Beethoven, the Goldberg Variations and the Well-Tempered Clavier. Rachmaninoff (d. 1943) is public domain in the EU and, in the US, for works published before 1929 (Preludes Op. 3, 23, 32; Études-Tableaux Op. 33, 39; Sonata No. 2); the Corelli Variations, the Paganini Rhapsody and the Symphonic Dances stay out until 2027, 2030 and 2036. Mutopia has few Rachmaninoff engravings, and the ten acquired Rachmaninoff editions are held by the quality gates.

### T2 Pieces that are not in the public domain (scheduled: L2)

> "Since this will be a private application, I would like to also add music pieces that are not in the public domain yet. Anything that you can find on the web will do."

Declined as literally asked: copying non-public-domain scores from the web is unauthorised, and the repository and the site are public. The MuseScore-archive lanes (T19, T20) already take modern scores on the uploader's declared licence, a broad reading the owner accepted. Two further routes remain:

1. A gitignored private folder, `content/private/`, scanned by the build. It can only appear in a local build (`pnpm dev` or a local preview), never on GitHub Pages. Dropping an owned file on the app already works.
2. Modern music its composers publish under Creative Commons (IMSLP CC works, composers' own sites). CC BY, BY-SA, BY-NC and BY-NC-SA are fine for this non-commercial project; ND is out because fingerings are a derivative.

### T14 Embellish simple songs (experimental; after M8)

> "(Experimental) I would like to improve songs that are simple. Sometimes when I whistle a simple song, I interpose notes in between and it sounds good. I would like to formalize that idea and offer the option at some point. Add it as a cool, experimental feature."

This is diminution: filling a melody's larger intervals with passing and neighbour notes. Rules a beginner can hear: a passing note between two melody notes a third apart (on the weak half of the first), a neighbour note on a repeated or long note, an anticipation before a strong beat, all inside the key and never displacing a chord tone on a strong beat, with a density setting (none, light, playful). The embellished line goes through the same fingering solve and lint laws, and the level estimator says how much harder it got.

It is opt-in, appears only in the Practice panel on pieces it can embellish, is never on by default, and the plain version stays the piece; export keeps the plain score unless asked. Research first: a spike under `research/` embellishes the level 1 and 2 songs, scores them (zero lint law errors, level at most one up, chord tones kept) and sends ten through the teacher review as a listening test. The app side (one "Add notes between" choice, re-solved fingering, the red following the new notes) only if the owner likes how the spike sounds.

### T9 Scanning follow-ups (experimental feature shipped)

> "Did we note the requirement that we want to be able to scan a PDF or an image at some point and convert it to the correct notes? Example: IMSLP18520, Boellmann, Variations symphoniques (piano score PDF)."

The owner accepts an experimental release for clear photos of printed music. Rules that stay: original PDF and image bytes are kept unchanged; the source is shown beside the recognised score; the optional PC connection appears only in the import context; Python is allowed for the local worker and GitHub Pages stays the frontend; no external recognition service and no score upload; recognition errors stay visible and are never silently corrected or called perfect. Better engraving does not establish recognition accuracy, so source-versus-recognition checks stay. Details: `docs/scanning.md`.

- [ ] Recognition: missed chord ties, duplicate notes and wrong hand assignment, fixed without guessing corrections.
- [ ] Beams: recover the source's beam membership instead of inferring it from the meter (a run of six eighths currently comes back as three pairs).
- [ ] An acceptance corpus beyond the one test page and the public regression controls.
- [ ] Correct a recognised score in the browser instead of rescanning or exporting to another editor. Start with selecting a note and editing pitch, duration and ties, with immediate preview and revalidation, Undo and reset. Keep the raw recognition separate from the corrected copy in My scores, and export both. Give source notes stable ids independent of strict import, so invalid recognition can still be edited. Corrections are explicit and reviewable, never silent rewrites. Keep graphical slurs distinct from sounding ties, and check both hands' timing before changing durations or onsets. Regression case: a genuine A4 tie in bar 11 of the test page whose continuation appears late in the export.
- [ ] Shared library: make uploaded or recognised scores available to other people. Needs shared storage, explicit publishing and visibility, provenance and redistribution permission, and removal and moderation. Never auto-publish local uploads. Today scores live only in the browser (IndexedDB).

## Done or closed

- **#6** "support NL/FR/ES/PT": done. The page speaks the browser's language and falls back to English, with one language line at the foot of the library, typed dictionaries per view, no i18n library, and lazy-loaded languages (`docs/app.md`, Languages). Open: a native-speaker review of each language.
- **T1** Sticky transport ("should be sticky"): Play, Pause, Rewind and the keyboard form a sticky bottom dock; tempo, hands, metronome, count-in and loop fold into one Practice toggle at every width. Pinning both rows at the top was rejected: about 130 px of score lost on a laptop.
- **T4** Login, resistant to brute force, without big-tech OAuth: closed. The owner chose GitHub Pages only ("I ONLY want it on github pages"), and a static public site cannot sit behind a login. If a self-hosted deployment returns, see `docs/research/auth-options.md`.
- **T6** Landing page "a bit cluttered", "like Apple design, where some UI elements only appear when they are needed": done. Clear units, levels with style shelves, search for long lists, a window-wide drop with a red frame; progressive disclosure became an app-wide rule (CLAUDE.md).
- **T7** "Dark mode, plus a fancy light/dark mode switch": done with a sun-to-crescent switch and a ripple from the switch. Piano-themed switches were rejected by the owner: a theme switch has to read as light or dark at a glance.
- **T8** Make clear which hand the keyboard numbers belong to: replaced by T11.
- **T10** Pausing should show where you left off: done. The last group heard keeps the red and its keys stay pressed; Play is red only at the start.
- **T11** L and R letters only when the hands are close: done. Letters appear in bars where the hands come within a fifth or interleave, decided per bar, on both hands or neither.
- **T15, T16** Library expansions from Mutopia and published MIDI: done.
- **T17** "Whimsical, classy, SUBTLE" animations, and notes emanating from clicks on non-interactive space: done (key travel, one-hand sweep, the red travelling between Play and the cursor, the note burst; `docs/app.md`, Motion). Rejected by the owner: level-pill thumb, list stagger, gliding row highlight, swinging crotchet ("it should feel like a snappy application"). Parked: the re-solve digit roll.
- **T18** Bigger burst notes, and none while selecting text: done.
- **T19, T20** At least 1,000 more scores, then songs "not necessarily classical or folk": done. 2,702 pieces, the additions from the MuseScore archive (PDMX) on the uploader's declared licence (the owner's broad copyright reading). Only content exclusions apply (junk, Nazi-era and propaganda pieces), and a piece the build refuses is dropped ("if the refusals do not work, drop them"). Pipeline: `content/tools/README.md`.
- **Ornaments** "Add support for trills and the Bach zigzag ornament": done. Signs and principal fingerings are kept; auxiliary notes sound and show on the keyboard without invented fingering. A practice default, with no claim about historical performance.
- **Scanning basics**: multi-image batches, page rotation, browser-local My scores, and source comparison without a mandatory acknowledgment checkbox are done.
- **T13, #23** "The ability to wind back in a track", then "allow seeking through a piece … effortlessly and intuitively, both on mobile and desktop", with whimsical accents: done. The score is the timeline, with no new control: a click or tap anywhere in a bar goes to its start; Left and Right step a bar, Shift four, Home rewinds; seeks stay inside a loop. Stopped, the bar's first note is cued red and Play starts there; playing, the music goes on from there. The red hops to the bar in an arc and, playing, the music comes in as it lands; the bar under the pointer is tinted and the bar sought leaves a fading footprint. One gray line in the Practice panel says how (`docs/app.md`, Moving through the piece). Clicks on notes now seek too; note editing (M5) will have to take notes over.
- **#13, #17** Dynamics (p, f) ignored by playback: done. The marks ppp to fff become velocities and the piano loads the velocity layers the piece uses; a mark between the staves is for both hands (`docs/app.md`, Audio).
- **#22** "Take into account increasing and decreasing intensity marks" (hairpins and cresc.), and p and f sounding "a bit abrupt sometimes: like a switch being turned. Can we dampen this slightly?": done. Hairpins and cresc., dim. and their kin ramp the velocity note by note to the mark at their end, or one mark's step when none ends them; the marks moved closer together (steps of 12 around mf instead of MIDI's 16), so p to f is 7.4 dB instead of 11.7 dB (`docs/app.md`, Audio).
- **#26** "Ever since pull 24 was merged, the sound seems off. Like it's played back through a towel or something.": done. The marks played one of smplr's sample layers too low (mf at 80 on the mp layer, p on the pp layer, pp and ppp on the low-passed ppp layer), so a marked piece sounded softer and duller than an unmarked one; the scale moved up one step (mf 92, between the unmarked hands' 96 and 88), `<sound dynamics>` follows it, and the piano plays nothing below velocity 41, the low-passed layer (`docs/app.md`, Audio).
- **#28** "Some form of loader/skeleton … for when the layout or fingering or the scanning is busy … subtle, black-white-red, piano themed": done. Five interactive designs were made; the owner chose A, one octave where a key at a time goes down in red: the scale while a score loads, the fingering written on the keys while the engine fingers, chords while it is laid out, the scale while a scan recognises a page. While it shows it carries the screen's one red and Play (or `Cancel scan`) is plain (`docs/app.md`, Motion).
