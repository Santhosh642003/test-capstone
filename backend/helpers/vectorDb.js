const { Pool } = require('pg');
const config = require('../config');
const { defaultLogger: logger } = require('../logger');

// Tables created by db/pgvector/001_rag_schema.sql, written by
// helpers/ragSync.js and read by helpers/caseSummaryTasks.js.
//
// The embedding width lives with the client that produces it -- see
// RAG_EMBEDDING_DIMENSIONS in helpers/ragEmbeddings.js.
const RAG_TABLES = ['rag_documents', 'rag_chunks', 'rag_sync_state', 'rag_sync_runs'];

const CHECK_VECTOR_EXTENSION_SQL = 'SELECT 1 FROM pg_extension WHERE extname = \'vector\';';
const CHECK_TABLES_SQL = 'SELECT table_name FROM information_schema.tables WHERE table_name = ANY($1);';

const pool = new Pool({ connectionString: config.PG_URL, ssl: true });

/**
 * Verifies that the local pgvector database schema and required extensions exist.
 *
 * Failures are logged, never fatal: the API serves plenty of traffic that has
 * nothing to do with retrieval, and a missing vector DB should not stop the
 * process from booting.
 *
 * @returns {Promise<void>}
 */
async function initVectorDB() {
  logger.info('initVectorDB: Verifying local pgvector database schema');
  try {
    const extResult = await pool.query(CHECK_VECTOR_EXTENSION_SQL);
    if (extResult.rowCount === 0) {
      throw new Error('vector extension not enabled on PG_URL');
    }
    logger.debug('initVectorDB: Verified pgvector extension exists');

    const { rows } = await pool.query(CHECK_TABLES_SQL, [RAG_TABLES]);
    const present = new Set(rows.map((row) => row.table_name));

    const missing = RAG_TABLES.filter((table) => !present.has(table));
    if (missing.length > 0) {
      throw new Error(`RAG tables missing: ${missing.join(', ')} -- run db/pgvector/001_rag_schema.sql`);
    }
    logger.debug({ tables: RAG_TABLES }, 'initVectorDB: Verified RAG tables exist');

    logger.info('initVectorDB: Successfully verified local vector DB schema');
  } catch (err) {
    logger.error(err, 'initVectorDB: Local vector DB schema verification failed');
    logger.error('initVectorDB: Vector database unavailable, continuing without exiting process');
  }
}

module.exports = {
  pool,
  initVectorDB,
  RAG_TABLES,
};
