-- ---------------------------------------------------------------------------
-- Project 05: AI form ingestion + community form packs.
-- Run once against the MSSQL APIDB (dev first):
--     sqlcmd -S <server> -d <APIDB> -i fieldworker/db/mssql/002_form_packs.sql
-- Idempotent: every statement is guarded, so re-running is safe.
-- Copy into the DB Schema project (dbo/Tables) when merging.
-- ---------------------------------------------------------------------------

-- fw_forms: revision link (a published form's json_schema is immutable once it has submissions;
-- a revision is a NEW form_id that points at the one it replaces).
IF COL_LENGTH('fw_forms', 'replaces_form_id') IS NULL
  ALTER TABLE fw_forms ADD replaces_form_id INT NULL;

-- fw_forms.form_sponsor / form_state already exist (form_state currently unused). Guarded in case a
-- dev database is missing them.
IF COL_LENGTH('fw_forms', 'form_state') IS NULL
  ALTER TABLE fw_forms ADD form_state VARCHAR(2) NULL;
IF COL_LENGTH('fw_forms', 'form_sponsor') IS NULL
  ALTER TABLE fw_forms ADD form_sponsor VARCHAR(255) NULL;

-- subscribed_form: which pack (if any) put this row here. NULL = subscribed individually.
-- subscribed_form stays the single source of truth for "which forms does this company have".
IF COL_LENGTH('subscribed_form', 'pack_id') IS NULL
  ALTER TABLE subscribed_form ADD pack_id INT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'form_pack')
CREATE TABLE form_pack (
  pack_id          INT IDENTITY(1,1) PRIMARY KEY,
  pack_name        VARCHAR(255) NOT NULL,
  pack_description VARCHAR(1000) NULL,
  company_type     INT NULL,                 -- feature_id 101..106, NULL = any
  state_id         VARCHAR(2) NULL,          -- NULL = all states
  version          INT NOT NULL DEFAULT 1,
  status           VARCHAR(16) NOT NULL,     -- draft | published | retired
  created_by       INT NOT NULL,
  created_on       DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
  published_on     DATETIME2 NULL,
  CONSTRAINT CK_form_pack_status CHECK (status IN ('draft', 'published', 'retired'))
);

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'form_pack_item')
CREATE TABLE form_pack_item (
  pack_id    INT NOT NULL,
  form_id    INT NOT NULL,
  sort_order INT NOT NULL,
  PRIMARY KEY (pack_id, form_id)
);

-- One row per published version: what changed and the form list as published.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'form_pack_version')
CREATE TABLE form_pack_version (
  pack_id      INT NOT NULL,
  version      INT NOT NULL,
  notes        VARCHAR(1000) NULL,
  form_ids     VARCHAR(2000) NOT NULL,       -- comma-separated, in sort order
  published_by INT NOT NULL,
  published_on DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
  PRIMARY KEY (pack_id, version)
);

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'subscribed_pack')
CREATE TABLE subscribed_pack (
  pack_id            INT NOT NULL,
  company_id         INT NOT NULL,
  subscribed_version INT NOT NULL,
  created_on         DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
  created_by         INT NOT NULL,
  PRIMARY KEY (pack_id, company_id)
);

-- Provenance for AI-generated forms. company_types is the comma-separated feature_id list chosen at publish.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'form_source')
CREATE TABLE form_source (
  form_id         INT NOT NULL PRIMARY KEY,
  source_blob_url VARCHAR(1024) NULL,
  source_agency   VARCHAR(255) NULL,
  model           VARCHAR(64) NULL,
  prompt_version  VARCHAR(32) NULL,
  company_types   VARCHAR(50) NULL,
  generated_on    DATETIME2 NULL,
  reviewed_by     INT NULL
);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_subscribed_form_pack' AND object_id = OBJECT_ID('subscribed_form'))
  CREATE INDEX IX_subscribed_form_pack ON subscribed_form (pack_id, company_id);
