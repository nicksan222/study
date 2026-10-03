-- Study's whole schema. Until the first release this file is edited in place: a database
-- created from another version of it is refused (see `migrations/mod.rs`), and
-- `just reset-data` starts over. After release, changes become new numbered files.
--
-- Every column holding a Rust `text_enum!` references its codes table; a test compares each
-- table with the enum.
--
-- Sections, in order: codes; preferences; projects and sources; sessions, messages and
-- recordings; documents; search; study material; practice; jobs. Each names the Rust
-- file that holds its SQL, under `crates/study-core`.

-- =========================================================================================
-- Codes
-- Rust: every `text_enum!` stored in a column, such as `SourceKind` in `src/source_kind.rs`
-- =========================================================================================

-- One table per stored enum, holding its codes. Columns reference it, so a code the enum does
-- not know is refused.

CREATE TABLE codes_source_origin (code TEXT PRIMARY KEY) WITHOUT ROWID;
INSERT INTO codes_source_origin (code) VALUES ('import'), ('attachment'), ('recording'),
    ('note'), ('web');

CREATE TABLE codes_source_kind (code TEXT PRIMARY KEY) WITHOUT ROWID;
INSERT INTO codes_source_kind (code) VALUES ('audio'), ('video'), ('image'), ('pdf'),
    ('text'), ('code'), ('document'), ('spreadsheet'), ('slides'), ('archive'), ('web'),
    ('note'), ('link'), ('other');

CREATE TABLE codes_title_source (code TEXT PRIMARY KEY) WITHOUT ROWID;
INSERT INTO codes_title_source (code) VALUES ('provisional'), ('generated'), ('user');

CREATE TABLE codes_message_role (code TEXT PRIMARY KEY) WITHOUT ROWID;
INSERT INTO codes_message_role (code) VALUES ('user'), ('assistant');

CREATE TABLE codes_message_status (code TEXT PRIMARY KEY) WITHOUT ROWID;
INSERT INTO codes_message_status (code) VALUES ('pending'), ('writing'), ('complete');

CREATE TABLE codes_part_kind (code TEXT PRIMARY KEY) WITHOUT ROWID;
INSERT INTO codes_part_kind (code) VALUES ('text'), ('source');

CREATE TABLE codes_artifact_kind (code TEXT PRIMARY KEY) WITHOUT ROWID;
INSERT INTO codes_artifact_kind (code) VALUES ('notes'), ('flashcards'), ('diagram');

CREATE TABLE codes_extractor_kind (code TEXT PRIMARY KEY) WITHOUT ROWID;
INSERT INTO codes_extractor_kind (code) VALUES ('transcription'), ('vision'), ('office'),
    ('web'), ('text');

CREATE TABLE codes_block_kind (code TEXT PRIMARY KEY) WITHOUT ROWID;
INSERT INTO codes_block_kind (code) VALUES ('paragraph'), ('heading'), ('list_item'),
    ('table'), ('code'), ('segment');

CREATE TABLE codes_artifact_status (code TEXT PRIMARY KEY) WITHOUT ROWID;
INSERT INTO codes_artifact_status (code) VALUES ('pending'), ('writing'), ('complete');

CREATE TABLE codes_rating (code TEXT PRIMARY KEY) WITHOUT ROWID;
INSERT INTO codes_rating (code) VALUES ('again'), ('hard'), ('good'), ('easy');

CREATE TABLE codes_question_kind (code TEXT PRIMARY KEY) WITHOUT ROWID;
INSERT INTO codes_question_kind (code) VALUES ('choice'), ('open');

CREATE TABLE codes_question_status (code TEXT PRIMARY KEY) WITHOUT ROWID;
INSERT INTO codes_question_status (code) VALUES ('pending'), ('writing'), ('ready'),
    ('answered'), ('graded');

CREATE TABLE codes_verdict (code TEXT PRIMARY KEY) WITHOUT ROWID;
INSERT INTO codes_verdict (code) VALUES ('correct'), ('partly'), ('incorrect');

CREATE TABLE codes_job_kind (code TEXT PRIMARY KEY) WITHOUT ROWID;
INSERT INTO codes_job_kind (code) VALUES ('extract'), ('index'), ('embed'), ('title'),
    ('reply'), ('artifact'), ('question'), ('grade'), ('fetch');

CREATE TABLE codes_job_status (code TEXT PRIMARY KEY) WITHOUT ROWID;
INSERT INTO codes_job_status (code) VALUES ('blocked'), ('queued'), ('waiting'), ('running'),
    ('succeeded'), ('failed'), ('cancelled');

CREATE TABLE codes_error_kind (code TEXT PRIMARY KEY) WITHOUT ROWID;
INSERT INTO codes_error_kind (code) VALUES ('transient'), ('rate_limited'), ('auth'),
    ('config'), ('model_unavailable'), ('unsupported'), ('invalid_input'), ('not_enough'),
    ('not_found'), ('cancelled'), ('internal');

CREATE TABLE codes_requirement (code TEXT PRIMARY KEY) WITHOUT ROWID;
INSERT INTO codes_requirement (code) VALUES ('transcription'), ('search_model'),
    ('language_models');
-- =========================================================================================
-- Preferences
-- Rust: `src/preferences/store.rs`
-- =========================================================================================

-- Every feature's preferences: one JSON value per (scope, key). Each crate declares its
-- fields with `study_core::preferences!`, so a new setting needs no schema change; a missing
-- key means "use the declared default".
CREATE TABLE preferences (
    scope TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL CHECK (json_valid(value)),
    PRIMARY KEY (scope, key)
) WITHOUT ROWID;

-- =========================================================================================
-- Projects and sources
-- Rust: `src/db/projects.rs`, `src/db/sources/`
-- =========================================================================================

CREATE TABLE projects (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0 AND length(name) <= 100),
    -- The day of the course's exam, as YYYY-MM-DD, when the student set one.
    exam_on TEXT CHECK (exam_on IS NULL OR date(exam_on) IS exam_on),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- Everything the user brought in. `kind` and `mime` are set when the source arrives, from
-- `study_core::sniff`, or once by the Fetch job of a link; nothing guesses them again later.
CREATE TABLE sources (
    id INTEGER PRIMARY KEY,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    origin TEXT NOT NULL REFERENCES codes_source_origin(code),
    kind TEXT NOT NULL REFERENCES codes_source_kind(code),
    mime TEXT NOT NULL CHECK (length(mime) > 0),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    -- At most `MAX_SOURCE_BYTES` (512 MiB).
    size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 536870912),
    sha256 BLOB NOT NULL CHECK (length(sha256) = 32),
    -- Where a web page or video came from.
    uri TEXT CHECK (uri IS NULL OR length(uri) > 0),
    created_at INTEGER NOT NULL
);

CREATE INDEX sources_project_idx ON sources (project_id);
CREATE INDEX sources_sha256_idx ON sources (sha256);

-- A source's bytes, apart from the row that lists it. `source_id` is the rowid, so the
-- blob is opened by the source's id.
CREATE TABLE source_blobs (
    source_id INTEGER PRIMARY KEY REFERENCES sources(id) ON DELETE CASCADE,
    bytes BLOB NOT NULL
);

-- =========================================================================================
-- Sessions, messages and recordings
-- Rust: `src/db/sessions.rs`, `src/db/messages/`, `src/db/citations.rs`,
--       `src/db/recordings.rs`
-- =========================================================================================

CREATE TABLE sessions (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL CHECK (length(trim(title)) > 0 AND length(title) <= 200),
    -- 'provisional' titles stand in until a model names the session ('generated');
    -- a title the user typed ('user') is never replaced.
    title_source TEXT NOT NULL REFERENCES codes_title_source(code),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX sessions_project_idx ON sessions (project_id, updated_at DESC);

-- A session is a log of the student's notes. Only a note that mentions the assistant gets an
-- answer: an assistant message that answers the user message in `reply_to`. It is 'pending'
-- until its reply job starts, 'writing' while it runs, and 'complete' once the answer is
-- stored; how the job ended is on the job.
CREATE TABLE messages (
    id INTEGER PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL REFERENCES codes_message_role(code),
    status TEXT NOT NULL REFERENCES codes_message_status(code),
    reply_to INTEGER REFERENCES messages(id) ON DELETE CASCADE,
    -- The attachment whose thread holds this message, or NULL for the session's timeline.
    -- Only an attachment of a timeline message starts a thread, so threads never nest.
    thread_root INTEGER REFERENCES message_parts(id) ON DELETE CASCADE,
    -- For a note written while the session was being recorded: how far into that recording,
    -- in milliseconds, so the note can be found in its audio.
    recording_ms INTEGER CHECK (recording_ms IS NULL OR recording_ms >= 0),
    -- That recording while it is not yet posted, so posting it finds the notes taken in it
    -- and not those of another recording of the session.
    recording_id INTEGER REFERENCES recordings(id) ON DELETE SET NULL,
    -- The recording's file, once that recording is posted.
    recorded_in INTEGER REFERENCES sources(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    CHECK ((reply_to IS NULL) OR (role = 'assistant')),
    CHECK (recording_id IS NULL OR recording_ms IS NOT NULL)
);

CREATE INDEX messages_session_idx ON messages (session_id, id);
CREATE INDEX messages_recording_idx ON messages (recording_id) WHERE recording_id IS NOT NULL;
CREATE INDEX messages_thread_idx ON messages (thread_root, id) WHERE thread_root IS NOT NULL;

-- A message is an ordered list of text and source parts. Source parts keep the source's
-- name and kind so the message still reads sensibly after the source is deleted.
CREATE TABLE message_parts (
    id INTEGER PRIMARY KEY,
    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    kind TEXT NOT NULL REFERENCES codes_part_kind(code),
    text TEXT,
    source_id INTEGER REFERENCES sources(id) ON DELETE SET NULL,
    source_name TEXT,
    source_kind TEXT REFERENCES codes_source_kind(code),
    UNIQUE (message_id, ordinal),
    CHECK (
        (kind = 'text' AND text IS NOT NULL
            AND source_id IS NULL AND source_name IS NULL AND source_kind IS NULL)
        OR (kind = 'source' AND text IS NULL
            AND source_name IS NOT NULL AND source_kind IS NOT NULL)
    )
);

CREATE INDEX message_parts_source_idx ON message_parts (source_id);

-- The passages an assistant message cites as [marker]. Each snapshots its source's name,
-- the place and the quote, so it still reads correctly after the source is gone.
CREATE TABLE citations (
    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    marker INTEGER NOT NULL CHECK (marker > 0),
    source_id INTEGER REFERENCES sources(id) ON DELETE SET NULL,
    source_name TEXT NOT NULL,
    anchor TEXT NOT NULL CHECK (json_valid(anchor)),
    quote TEXT NOT NULL,
    PRIMARY KEY (message_id, marker)
) WITHOUT ROWID;

CREATE INDEX citations_source_idx ON citations (source_id);

-- A microphone recording that has not been posted yet. Audio is saved as it is captured,
-- one chunk about every second, so a crash loses at most the last second. Posting the
-- recording turns its chunks into one WAV source and deletes these rows.
CREATE TABLE recordings (
    id INTEGER PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    started_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX recordings_session_idx ON recordings (session_id);

-- 16 kHz mono 16-bit little-endian PCM, played back in `ordinal` order.
CREATE TABLE recording_chunks (
    id INTEGER PRIMARY KEY,
    recording_id INTEGER NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    pcm BLOB NOT NULL CHECK (length(pcm) > 0 AND length(pcm) % 2 = 0),
    UNIQUE (recording_id, ordinal)
);

-- =========================================================================================
-- Documents: what was read from each source
-- Rust: `src/db/documents.rs`
-- =========================================================================================

-- The canonical text of a source: one document per source, replaced whole when the source is
-- read again. `meta` is `study_core::DocumentMeta` as JSON.
CREATE TABLE documents (
    -- AUTOINCREMENT: an id is never reused, so a stale one never names new data.
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER NOT NULL UNIQUE REFERENCES sources(id) ON DELETE CASCADE,
    extractor TEXT REFERENCES codes_extractor_kind(code),
    extractor_version INTEGER NOT NULL CHECK (extractor_version >= 0),
    meta TEXT NOT NULL CHECK (json_valid(meta)),
    created_at INTEGER NOT NULL
);

-- A document's text in order. `anchor` is `study_core::Anchor` as JSON: where in the
-- source the block comes from.
CREATE TABLE blocks (
    id INTEGER PRIMARY KEY,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    kind TEXT NOT NULL REFERENCES codes_block_kind(code),
    text TEXT NOT NULL,
    anchor TEXT NOT NULL CHECK (json_valid(anchor)),
    UNIQUE (document_id, ordinal)
);

-- =========================================================================================
-- Search
-- Rust: `src/db/search/`
-- =========================================================================================

-- Search passages: consecutive blocks of one document, never across a page or slide. Their
-- `anchor` spans the blocks. `content_hash` is the SHA-256 of `text`, so identical passages
-- share one embedding.
CREATE TABLE chunks (
    -- AUTOINCREMENT: an id is never reused, so a stale one never names new data.
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    -- The `ordinal`s of the first and last block it covers.
    first_block INTEGER NOT NULL,
    last_block INTEGER NOT NULL CHECK (last_block >= first_block),
    anchor TEXT NOT NULL CHECK (json_valid(anchor)),
    text TEXT NOT NULL,
    content_hash BLOB NOT NULL CHECK (length(content_hash) = 32),
    UNIQUE (document_id, ordinal)
);

CREATE INDEX chunks_content_hash_idx ON chunks (content_hash);

-- An external-content index over `chunks`, kept in step by the triggers below.
-- `remove_diacritics 2` folds accents on every Latin letter (1 misses some), so "citta"
-- finds "città".
CREATE VIRTUAL TABLE chunks_fts USING fts5 (
    text,
    content = 'chunks',
    content_rowid = 'id',
    tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER chunks_fts_ai AFTER INSERT ON chunks BEGIN
    INSERT INTO chunks_fts (rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER chunks_fts_ad AFTER DELETE ON chunks BEGIN
    INSERT INTO chunks_fts (chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;
CREATE TRIGGER chunks_fts_au AFTER UPDATE OF text ON chunks BEGIN
    INSERT INTO chunks_fts (chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
    INSERT INTO chunks_fts (rowid, text) VALUES (new.id, new.text);
END;

-- Little-endian f32 vectors from `model`, one per distinct passage text.
CREATE TABLE embeddings (
    content_hash BLOB NOT NULL CHECK (length(content_hash) = 32),
    model TEXT NOT NULL,
    vector BLOB NOT NULL,
    PRIMARY KEY (content_hash, model)
) WITHOUT ROWID;

-- Keyword search over what people wrote in chats: only `text` parts, as the triggers'
-- WHEN clauses keep the others out.
CREATE VIRTUAL TABLE message_fts USING fts5 (
    text,
    content = 'message_parts',
    content_rowid = 'id',
    tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER message_fts_ai AFTER INSERT ON message_parts WHEN new.kind = 'text' BEGIN
    INSERT INTO message_fts (rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER message_fts_ad AFTER DELETE ON message_parts WHEN old.kind = 'text' BEGIN
    INSERT INTO message_fts (message_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;
CREATE TRIGGER message_fts_au AFTER UPDATE OF text ON message_parts WHEN new.kind = 'text' BEGIN
    INSERT INTO message_fts (message_fts, rowid, text) VALUES ('delete', old.id, old.text);
    INSERT INTO message_fts (rowid, text) VALUES (new.id, new.text);
END;

-- =========================================================================================
-- Study material and flashcards
-- Rust: `src/db/artifacts.rs`, `src/db/citations.rs`, `src/db/cards.rs`,
--       `src/db/practice/mistakes.rs`
-- =========================================================================================

-- Study material of a project. A piece of material is one project's one kind of it: at most
-- one 'complete' row, the piece the student sees, and at most one unfinished row, the update
-- being written or that failed. An update is written from all the project's sources and
-- sessions' notes (`notes`, as they were when it was asked for) and revises the complete
-- row; finishing it replaces that row. A row is 'pending' until its job starts, 'writing'
-- while it runs, and 'complete' once `body` (an `ArtifactBody` as JSON) is stored; how the
-- job ended is on the job. A practice's flashcard set of mistakes is not a piece of
-- material: `mistakes` marks it.
CREATE TABLE artifacts (
    -- AUTOINCREMENT: an id is never reused, so a stale one never names new data.
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    -- The practice whose mistakes this set collects, one per practice; the set stays, without
    -- its practice, when the practice goes.
    practice_id INTEGER UNIQUE REFERENCES practices(id) ON DELETE SET NULL,
    kind TEXT NOT NULL REFERENCES codes_artifact_kind(code),
    mistakes INTEGER NOT NULL DEFAULT 0 CHECK (mistakes IN (0, 1)),
    title TEXT NOT NULL CHECK (length(trim(title)) > 0 AND length(title) <= 200),
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL REFERENCES codes_artifact_status(code),
    body TEXT CHECK (body IS NULL OR json_valid(body)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    CHECK ((status = 'complete') = (body IS NOT NULL)),
    CHECK (practice_id IS NULL OR mistakes = 1)
);

CREATE INDEX artifacts_project_idx ON artifacts (project_id, id DESC);
CREATE UNIQUE INDEX artifacts_piece_idx ON artifacts (project_id, kind)
    WHERE mistakes = 0 AND status = 'complete';
CREATE UNIQUE INDEX artifacts_update_idx ON artifacts (project_id, kind)
    WHERE mistakes = 0 AND status != 'complete';

-- The sources an artifact is made from. A deleted source leaves its row with no source, so
-- the artifact still knows a file it was made from is gone.
CREATE TABLE artifact_sources (
    artifact_id INTEGER NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
    source_id INTEGER REFERENCES sources(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX artifact_sources_unique_idx ON artifact_sources (artifact_id, source_id)
    WHERE source_id IS NOT NULL;
CREATE INDEX artifact_sources_source_idx ON artifact_sources (source_id);

-- The passages an artifact cites as [marker], snapshotted like a message's citations.
CREATE TABLE artifact_citations (
    artifact_id INTEGER NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
    marker INTEGER NOT NULL CHECK (marker > 0),
    source_id INTEGER REFERENCES sources(id) ON DELETE SET NULL,
    source_name TEXT NOT NULL,
    anchor TEXT NOT NULL CHECK (json_valid(anchor)),
    quote TEXT NOT NULL,
    PRIMARY KEY (artifact_id, marker)
) WITHOUT ROWID;

CREATE INDEX artifact_citations_source_idx ON artifact_citations (source_id);

-- The flashcards of finished flashcard artifacts, each with its FSRS memory: stability and
-- difficulty are 0 until the first review.
CREATE TABLE cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    artifact_id INTEGER NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    front TEXT NOT NULL CHECK (length(trim(front)) > 0),
    back TEXT NOT NULL CHECK (length(trim(back)) > 0),
    stability REAL NOT NULL DEFAULT 0 CHECK (stability >= 0),
    difficulty REAL NOT NULL DEFAULT 0 CHECK (difficulty >= 0 AND difficulty <= 10),
    reps INTEGER NOT NULL DEFAULT 0 CHECK (reps >= 0),
    lapses INTEGER NOT NULL DEFAULT 0 CHECK (lapses >= 0),
    last_review INTEGER,
    due INTEGER NOT NULL,
    UNIQUE (artifact_id, ordinal)
);

CREATE INDEX cards_due_idx ON cards (due);

-- Every review, with the memory before it, so the scheduler can be fitted to one student.
CREATE TABLE reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    rating TEXT NOT NULL REFERENCES codes_rating(code),
    reviewed_at INTEGER NOT NULL,
    stability REAL NOT NULL,
    difficulty REAL NOT NULL,
    elapsed_days REAL NOT NULL CHECK (elapsed_days >= 0)
);

CREATE INDEX reviews_card_idx ON reviews (card_id, reviewed_at);

-- =========================================================================================
-- Practice
-- Rust: `src/db/practice/`, `src/db/citations.rs`
-- =========================================================================================

-- A project's endless quiz over everything in it: every file attached in its sessions and
-- their notes. `updated_at` moves with the student's answers.
CREATE TABLE practices (
    -- AUTOINCREMENT: an id is never reused, so a stale one never names new data.
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX practices_updated_idx ON practices (updated_at DESC, id DESC);

-- A practice's questions, asked in `ordinal` order. A question is 'pending' until its job
-- starts, 'writing' while it runs, and 'ready' once it is written: `body` (a `PracticeBody`
-- as JSON) is what the student sees, and `gist` a line saying what it tests, which later
-- writers are shown so they do not ask it again. The student's answer is `choice` (the
-- picked choice's index) or `answer` (their own words), by `kind`. A choice is 'graded' at
-- once; an open answer is 'answered' until a model grades it with a `verdict` and
-- `feedback`. How the latest job ended is on the job.
CREATE TABLE practice_questions (
    -- AUTOINCREMENT: an id is never reused, so a stale one never names new data.
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    practice_id INTEGER NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    kind TEXT NOT NULL REFERENCES codes_question_kind(code),
    status TEXT NOT NULL REFERENCES codes_question_status(code),
    body TEXT CHECK (body IS NULL OR json_valid(body)),
    gist TEXT CHECK (length(trim(gist)) > 0 AND length(gist) <= 200),
    choice INTEGER CHECK (choice >= 0),
    answer TEXT CHECK (length(trim(answer)) > 0),
    verdict TEXT REFERENCES codes_verdict(code),
    feedback TEXT CHECK (length(trim(feedback)) > 0),
    created_at INTEGER NOT NULL,
    answered_at INTEGER,
    graded_at INTEGER,
    UNIQUE (practice_id, ordinal),
    -- Between two truth values, `a <= b` reads "a implies b".
    CHECK ((body IS NULL) = (status = 'pending' OR status = 'writing')),
    CHECK ((gist IS NULL) = (body IS NULL)),
    CHECK ((answered_at IS NOT NULL) = (status = 'answered' OR status = 'graded')),
    CHECK ((choice IS NOT NULL) = (answered_at IS NOT NULL AND kind = 'choice')),
    CHECK ((answer IS NOT NULL) = (answered_at IS NOT NULL AND kind = 'open')),
    CHECK ((status = 'answered') <= (kind = 'open')),
    CHECK ((graded_at IS NOT NULL) = (status = 'graded')),
    CHECK ((verdict IS NOT NULL) = (status = 'graded')),
    CHECK ((verdict = 'partly') <= (kind = 'open')),
    CHECK ((feedback IS NOT NULL) = (status = 'graded' AND kind = 'open'))
);

-- The passages a question cites as [marker], snapshotted like a message's citations.
CREATE TABLE question_citations (
    question_id INTEGER NOT NULL REFERENCES practice_questions(id) ON DELETE CASCADE,
    marker INTEGER NOT NULL CHECK (marker > 0),
    source_id INTEGER REFERENCES sources(id) ON DELETE SET NULL,
    source_name TEXT NOT NULL,
    anchor TEXT NOT NULL CHECK (json_valid(anchor)),
    quote TEXT NOT NULL,
    PRIMARY KEY (question_id, marker)
) WITHOUT ROWID;

CREATE INDEX question_citations_source_idx ON question_citations (source_id);

-- =========================================================================================
-- Jobs
-- Rust: `src/db/jobs/`
-- =========================================================================================

-- Every piece of background work, durable so nothing is lost when the app quits. A job
-- targets exactly one subject; deleting the subject deletes its jobs. `dedupe_key` collapses
-- the same work queued twice while it is still waiting. A failure keeps its `error_kind` (a
-- `study_core::ErrorKind`) and full `error` message. A job `waiting` for the user to set
-- something up names it in `waiting_for` (a `study_core::Requirement`).
CREATE TABLE jobs (
    -- AUTOINCREMENT: an id is never reused, so a stale one never names new data.
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL REFERENCES codes_job_kind(code),
    source_id INTEGER REFERENCES sources(id) ON DELETE CASCADE,
    document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
    session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
    message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
    artifact_id INTEGER REFERENCES artifacts(id) ON DELETE CASCADE,
    question_id INTEGER REFERENCES practice_questions(id) ON DELETE CASCADE,
    args TEXT CHECK (args IS NULL OR json_valid(args)),
    dedupe_key TEXT NOT NULL,
    status TEXT NOT NULL REFERENCES codes_job_status(code),
    waiting_for TEXT REFERENCES codes_requirement(code),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    run_after INTEGER NOT NULL DEFAULT 0,
    error_kind TEXT REFERENCES codes_error_kind(code),
    error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    started_at INTEGER,
    finished_at INTEGER,
    CHECK ((source_id IS NOT NULL) + (document_id IS NOT NULL) + (session_id IS NOT NULL)
        + (message_id IS NOT NULL) + (artifact_id IS NOT NULL) + (question_id IS NOT NULL) = 1),
    CHECK ((error IS NULL) = (error_kind IS NULL)),
    CHECK ((status = 'waiting') = (waiting_for IS NOT NULL))
);

-- Unique only until started: the same work may be queued again once a copy has started.
CREATE UNIQUE INDEX jobs_pending_dedupe_idx ON jobs (dedupe_key)
    WHERE status IN ('blocked', 'queued', 'waiting');
CREATE INDEX jobs_claim_idx ON jobs (status, kind, run_after, id);
CREATE INDEX jobs_source_idx ON jobs (source_id);
CREATE INDEX jobs_document_idx ON jobs (document_id);
CREATE INDEX jobs_session_idx ON jobs (session_id);
CREATE INDEX jobs_message_idx ON jobs (message_id);
CREATE INDEX jobs_artifact_idx ON jobs (artifact_id);
CREATE INDEX jobs_question_idx ON jobs (question_id);

-- `job_id` waits until `depends_on` has ended, however it ended.
CREATE TABLE job_deps (
    job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    depends_on INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    PRIMARY KEY (job_id, depends_on)
) WITHOUT ROWID;

CREATE INDEX job_deps_depends_on_idx ON job_deps (depends_on);
