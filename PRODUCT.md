# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Study is a native desktop app built with GPUI (GPUI Kit), released for Linux. `web` stands
for impeccable's general design language only: there is no browser, HTML or CSS, so the
browser-only tools (`live`, `generate`, the HTML detector) don't apply. The design system is
Rust code in `crates/study-ui`.

## Users

Serious learners of any kind: university students taking several courses first, and also
self-learners and people studying for a certification. A "course" is one kind of project,
not the only one. They reach for Study while they learn (in and after a lecture, while
reading) and again while they revise and practise toward an exam.

## Product Purpose

Study is one calm place for everything someone learns. They bring what they study from
(recordings, slides, PDFs, pictures, documents, web pages and videos); Study reads it, answers
questions about it with citations to the exact page or moment, and turns it into study
material, flashcards and practice. Success is a learner who walks into the exam having
reviewed and practised their own material, without managing a pile of separate tools.

## Positioning

- **Everything in one place.** Every source of a course or topic lives together in its
  project, and every answer cites the page or the moment in the recording it came from.
- **Local-first and private.** One database on the learner's own computer. Listening to
  recordings and searching run on the machine; nothing leaves it except work sent to the
  learner's own ChatGPT plan.
- **No extra subscription.** The language models run on the ChatGPT plan the learner already
  has (Plus or Pro), so Study adds no AI bill.
- **From notes to exam.** The learner's own material becomes diagrams, flashcards
  on a spaced-repetition schedule, and endless graded practice, counting down to each exam.

## Operating Context

- **Projects:** one per course or subject, holding its sources, sessions and material, with
  optional exam dates that Home and the flashcard reviews count down to. A project is a
  group of sessions: its flashcards, diagram and quiz always cover the
  whole project. Each is up to date, out of date (saying what changed since) or not made
  yet; Update rewrites it from the project as it is now, revising what it says.
- **Sessions are the notebook:** the learner writes, records and attaches as they study.
  Typing `@study` asks a question; only a note that mentions `@study` gets an answer. Study transcribes recordings, reads files and names sessions in the background.
- **Reviewing:** flashcards come back when due; practice is an endless quiz over the
  project, one per project, graded by the model.
- **Background work is visible:** imports, transcription, reading and material run as jobs
  the learner can see, stop and retry.
- **First run:** a guided welcome tour (language and look, how sessions work, where AI runs,
  signing in to ChatGPT, downloading the local models).

## Capabilities and Constraints

- Pages today: Home, Projects, Sessions, Study (flashcards, diagrams), Practice, media lists, Pipelines
  (processing), Settings, Help, and the onboarding tour.
- Model work (reading pages and PDFs, answers, titles, material, quiz questions and grades)
  runs only on the learner's ChatGPT plan. Speech-to-text and embeddings run locally, and
  their models download only on an explicit install.
- When ChatGPT isn't signed in, or a model isn't installed, work waits or fails honestly and
  says so; it never fakes results.
- The interface takes zoom, a light and a dark theme, and runs on screens from small laptops
  to 27-inch monitors.
- All visible text is localized; nothing in the UI is hard-coded copy.

## Brand Commitments

- **Name:** Study.
- **Calm is the voice and the promise:** "A calm place for everything you learn." Copy is
  plain, short and second-person; the interface never shouts.
- **Bilingual, English and Italian:** every surface works equally well in both. Italian runs
  longer, so layouts must take the longer text.
- **Keyboard-first:** everything is reachable from the keyboard, with `@study` in the
  notebook for fast, flowing study.
- Diagrams are drawn hand-drawn style, in Excalifont.

## Evidence on Hand

- Seeded sample projects for demos and screenshots (`crates/study-core/src/db/seed*.rs`):
  cell division (BIO 120), membrane transport, the fall of the Roman Republic, eigenvalues,
  exam revision and a study plan, with real sources from Wikipedia and open textbooks.
- No customers, testimonials, usage numbers, pricing or press exist. Never invent them.

## Product Principles

1. **The learner's own material is the source of truth.** Everything Study makes traces back
   to what they brought, with a citation.
2. **Calm over clever.** Background work stays in the background; the interface asks for
   attention only when the learner must act.
3. **Private by default.** Local first; the network only for the learner's own plan, and
   only for what needs it.
4. **Honest about the machine.** Say what is waiting, failing or downloading, and why;
   never pretend.
5. **Toward the exam.** Every surface serves remembering and practising, not just storing.
