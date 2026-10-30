-- ---------------------------------------------------------------------------
-- ElliQ RAG store: revenue-cycle document types (Scenario 3 -- compliance gaps)
--
-- Run once against PG_URL, after 001_rag_schema.sql:
--     psql "$PG_URL" -f fieldworker/db/pgvector/002_compliance_documents.sql
--
-- Adds 'claim_line' and 'prior_auth' to the ingested object types so a QA
-- sweep can cross-reference a billing line against the tasks that justify it.
-- Both are built by helpers/elliq.js and written by helpers/ragSync.js exactly
-- like the four original types -- nothing else about the pipeline changes.
-- ---------------------------------------------------------------------------

-- The original CHECK was declared inline, so its name is whatever Postgres
-- generated (conventionally rag_documents_object_type_check). Dropping it by
-- lookup rather than by assumed name keeps this runnable against a store
-- created by an older copy of 001, and makes the whole migration idempotent.
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT con.conname INTO constraint_name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
   WHERE rel.relname = 'rag_documents'
     AND con.contype = 'c'
     AND pg_get_constraintdef(con.oid) ILIKE '%object_type%'
   LIMIT 1;

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE rag_documents DROP CONSTRAINT %I', constraint_name);
  END IF;

  ALTER TABLE rag_documents
    ADD CONSTRAINT rag_documents_object_type_check
    CHECK (object_type IN ('customer', 'project', 'task', 'casenote', 'claim_line', 'prior_auth'));
END $$;

-- rag_chunks.object_type is deliberately left unconstrained, as it was: it is
-- denormalized from rag_documents, which is now the only place the vocabulary
-- is enforced.

-- Retrieval for this scenario filters by customer and then narrows to one
-- document type ("this customer's pending claim lines"), which the existing
-- single-column indexes cannot serve together.
CREATE INDEX IF NOT EXISTS rag_chunks_customer_object_type_idx
  ON rag_chunks (customer_id, object_type);

-- The company-wide QA queue is deferred (per-customer only for now), but this
-- index is what it will need and it costs nothing to create alongside.
CREATE INDEX IF NOT EXISTS rag_chunks_company_object_type_idx
  ON rag_chunks (company_id, object_type);

-- Claim status / claim id / prior auth id ride in rag_chunks.metadata so the
-- hybrid query can pre-filter ("status = Ready to Bill") before ranking.
-- A JSONB path index rather than a b-tree, because the keys present depend on
-- the document type.
CREATE INDEX IF NOT EXISTS rag_chunks_metadata_idx
  ON rag_chunks USING gin (metadata jsonb_path_ops);
