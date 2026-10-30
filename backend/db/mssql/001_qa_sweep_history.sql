-- ---------------------------------------------------------------------------
-- qa_sweep_history (Scenario 3 -- compliance gap QA sweep)
--
-- Run once against the MSSQL APIDB:
--     sqlcmd -S <server> -d <APIDB> -i fieldworker/db/mssql/001_qa_sweep_history.sql
--
-- Written by helpers/qaSweepJob.js's nightly run: one row per deterministic
-- billing exception found by helpers/complianceGaps.js, merged with the LLM's
-- narrative verdict for that exception. Read by the Compliance dashboard
-- (FieldWrkrAnalytiQ/src/container/Compliance).
--
-- sql_facts / llm_verdict are stored as JSON text rather than normalized
-- columns: their shape mirrors the live complianceGaps.js response exactly
-- (claim vs. prior-auth rows differ), and duplicating that shape into columns
-- here would be a second place for it to drift out of sync with the API.
-- issue_codes is pulled out as its own indexed column because it is what the
-- dashboard filters and counts on -- exactly the reasoning helpers/
-- complianceGaps.js gives for using stable issue codes over prose.
-- ---------------------------------------------------------------------------

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'qa_sweep_history')
BEGIN
  CREATE TABLE qa_sweep_history (
    id              BIGINT IDENTITY(1,1) PRIMARY KEY,
    company_id      INT NOT NULL,
    cus_id          INT NOT NULL,
    gap_type        VARCHAR(20) NOT NULL,   -- 'claim' | 'prior_auth'
    claim_id        INT NULL,
    prior_auth_id   INT NULL,
    issue_codes     VARCHAR(500) NOT NULL,  -- comma-separated complianceGaps.js issue codes
    sql_facts       NVARCHAR(MAX) NOT NULL, -- JSON: the deterministic claim/auth object
    llm_verdict     NVARCHAR(MAX) NULL,     -- JSON: { justified, confidence, rationale, model }
    swept_at        DATETIME NOT NULL CONSTRAINT DF_qa_sweep_history_swept_at DEFAULT GETDATE()
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_qa_sweep_history_company_swept')
BEGIN
  CREATE INDEX IX_qa_sweep_history_company_swept ON qa_sweep_history (company_id, swept_at DESC);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_qa_sweep_history_customer_swept')
BEGIN
  CREATE INDEX IX_qa_sweep_history_customer_swept ON qa_sweep_history (cus_id, swept_at DESC);
END;
