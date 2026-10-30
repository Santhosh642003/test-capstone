-- ---------------------------------------------------------------------------
-- ElliQ RAG store (pgvector)
--
-- Run once against PG_URL:
--     psql "$PG_URL" -f fieldworker/db/pgvector/001_rag_schema.sql
--
-- Populated by fieldworker/helpers/ragSync.js (nightly node-schedule job).
--
-- The vector width (1536) must match RAG_EMBEDDING_DIMENSIONS in config.js.
-- It is fixed at DDL time and cannot be widened in place -- changing the
-- embedding model means creating a new column and re-embedding everything.
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS vector;

-- One row per source object (customer, project, task, casenote).
--
-- content_hash is the change-detection mechanism: the nightly job rebuilds an
-- object's markdown, hashes it, and skips the object entirely when the hash is
-- unchanged. That is what makes a full sweep affordable, and it is the only
-- way to detect edits to customer_goal / customer_health_need / customer_adl /
-- customer_extension, which carry no timestamp columns in SQL Server.
CREATE TABLE IF NOT EXISTS rag_documents (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  object_type  TEXT    NOT NULL CHECK (object_type IN ('customer', 'project', 'task', 'casenote')),
  object_id    BIGINT  NOT NULL,
  company_id   INTEGER NOT NULL,
  customer_id  BIGINT,            -- equals object_id for customer documents
  content_hash TEXT    NOT NULL,  -- sha256 of markdown
  markdown     TEXT    NOT NULL,  -- kept so changes can be diffed without hitting SQL Server
  chunk_count  INTEGER NOT NULL DEFAULT 0,
  embedded_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT rag_documents_object_key UNIQUE (object_type, object_id)
);

-- The nightly job loads every existing hash for one customer in a single query.
CREATE INDEX IF NOT EXISTS rag_documents_customer_idx ON rag_documents (customer_id);
CREATE INDEX IF NOT EXISTS rag_documents_company_idx  ON rag_documents (company_id);

-- One row per embedded chunk. This is the only table retrieval touches.
--
-- object_type / object_id / company_id / customer_id are deliberately
-- denormalized from rag_documents: retrieval filters by customer and then does
-- a vector scan, and keeping the filter column on the same table as the
-- embedding is what lets Postgres use the HNSW index effectively.
CREATE TABLE IF NOT EXISTS rag_chunks (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_id   BIGINT  NOT NULL REFERENCES rag_documents (id) ON DELETE CASCADE,
  chunk_index   INTEGER NOT NULL,
  object_type   TEXT    NOT NULL,
  object_id     BIGINT  NOT NULL,
  company_id    INTEGER NOT NULL,
  customer_id   BIGINT,
  section_title TEXT,
  content       TEXT    NOT NULL,          -- raw chunk, returned to the LLM
  metadata      JSONB   NOT NULL DEFAULT '{}'::jsonb,
  embedding     VECTOR(1536) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT rag_chunks_document_chunk_key UNIQUE (document_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS rag_chunks_customer_idx    ON rag_chunks (customer_id);
CREATE INDEX IF NOT EXISTS rag_chunks_company_idx     ON rag_chunks (company_id);
CREATE INDEX IF NOT EXISTS rag_chunks_object_type_idx ON rag_chunks (object_type);

-- HNSW rather than IVFFlat: no training step, and it degrades far better under
-- the continuous incremental writes this job produces (IVFFlat's lists go stale
-- as the data shifts and need periodic rebuilds).
--
-- vector_cosine_ops must match the <=> operator used at query time, or the
-- index is silently ignored.
CREATE INDEX IF NOT EXISTS rag_chunks_embedding_idx
  ON rag_chunks USING hnsw (embedding vector_cosine_ops);

-- Incremental watermark, one row per company.
--
-- watermark  = start time of the last successful run; the next run asks SQL
--              Server only for rows touched since then (minus a safety overlap).
-- last_full_sweep_at = drives the periodic full rebuild that catches the
--              child tables with no timestamps. NULL means "never swept", which
--              is why the very first run is automatically a full backfill.
CREATE TABLE IF NOT EXISTS rag_sync_state (
  company_id         INTEGER PRIMARY KEY,
  watermark          TIMESTAMPTZ NOT NULL DEFAULT '1900-01-01T00:00:00Z',
  last_full_sweep_at TIMESTAMPTZ,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-run log. The job runs in-process on Azure Web Apps where container logs
-- roll, so this is the durable answer to "did last night work?".
--
-- documents_changed vs documents_unchanged is the health signal: a nightly
-- incremental reporting mostly-changed means something is making documents
-- churn (e.g. unstable formatting) and burning embedding spend for nothing.
CREATE TABLE IF NOT EXISTS rag_sync_runs (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id          INTEGER NOT NULL,
  mode                TEXT    NOT NULL,                    -- incremental | full
  status              TEXT    NOT NULL DEFAULT 'running',  -- running | success | partial | failed | timed_out
  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at         TIMESTAMPTZ,
  candidates          INTEGER NOT NULL DEFAULT 0,
  customers_processed INTEGER NOT NULL DEFAULT 0,
  customers_failed    INTEGER NOT NULL DEFAULT 0,
  documents_changed   INTEGER NOT NULL DEFAULT 0,
  documents_unchanged INTEGER NOT NULL DEFAULT 0,
  documents_deleted   INTEGER NOT NULL DEFAULT 0,
  chunks_written      INTEGER NOT NULL DEFAULT 0,
  error               TEXT
);

CREATE INDEX IF NOT EXISTS rag_sync_runs_company_started_idx
  ON rag_sync_runs (company_id, started_at DESC);
