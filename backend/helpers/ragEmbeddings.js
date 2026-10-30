// ---------------------------------------------------------------------------
// Embedding client for the RAG store.
//
// Talks to the Azure AI Foundry OpenAI-compatible /embeddings endpoint. Model
// and dimensions come from config so the two callers that matter -- this
// nightly job and, later, the query side -- cannot drift apart. Document and
// query embeddings MUST use the same model and width or similarity search is
// meaningless.
// ---------------------------------------------------------------------------

const axios = require('axios');
const config = require('../config');
const { defaultLogger: logger } = require('../logger');

// --- Settings --------------------------------------------------------------
// text-embedding-3-small at its native width. RAG_EMBEDDING_DIMENSIONS must
// match VECTOR(1536) in db/pgvector/001_rag_schema.sql -- the column cannot be
// widened in place, so changing either means re-embedding everything into a
// new column. Keeping both as literals means that pairing is reviewable in the
// diff rather than depending on what happens to be in an environment.

const RAG_EMBEDDING_MODEL = 'text-embedding-3-small';
const RAG_EMBEDDING_DIMENSIONS = 1536;

// Texts per /embeddings request.
const RAG_EMBED_BATCH_SIZE = 32;

// FOUNDRY_URL / FOUNDRY_API_KEY stay in config.js -- they are shared with the
// chat completions and legacy case-summary paths, not specific to RAG.
const EMBEDDINGS_URL = `${config.FOUNDRY_URL}/embeddings`;

/**
 * Embeds a batch of strings.
 *
 * Results are re-sorted by the response's `index` field before being returned:
 * the API does not guarantee ordering, and a silent mis-pairing here would
 * attach every chunk to the wrong vector -- a corruption that produces no error
 * and only shows up as inexplicably bad retrieval.
 *
 * @param {string[]} texts
 * @returns {Promise<number[][]>} one vector per input, in input order.
 */
async function embedTexts(texts) {
  if (!texts || texts.length === 0) return [];

  const { data } = await axios.post(
    EMBEDDINGS_URL,
    {
      model: RAG_EMBEDDING_MODEL,
      input: texts,
      dimensions: RAG_EMBEDDING_DIMENSIONS,
    },
    { headers: { Authorization: `Bearer ${config.FOUNDRY_API_KEY}` } },
  );

  if (!data || !Array.isArray(data.data) || data.data.length !== texts.length) {
    logger.error({ received: data && data.data ? data.data.length : null, expected: texts.length }, 'ragEmbeddings: Unexpected response shape');
    throw new Error('Embeddings endpoint returned an unexpected response shape');
  }

  return [...data.data]
    .sort((a, b) => a.index - b.index)
    .map((result, i) => {
      const embedding = result.embedding;
      // Fail loudly rather than write a wrong-width vector: the rag_chunks
      // column is VECTOR(1536) and cannot be widened in place afterwards.
      if (!Array.isArray(embedding) || embedding.length !== RAG_EMBEDDING_DIMENSIONS) {
        throw new Error(
          `Embedding ${i} has ${embedding ? embedding.length : 'no'} dimensions, expected ${RAG_EMBEDDING_DIMENSIONS} `
          + `(check RAG_EMBEDDING_MODEL=${RAG_EMBEDDING_MODEL})`,
        );
      }
      return embedding;
    });
}

/**
 * Embeds an arbitrary number of texts, batched to keep request sizes sane.
 *
 * @param {string[]} texts
 * @returns {Promise<number[][]>}
 */
async function embedTextsBatched(texts) {
  const out = [];
  for (let i = 0; i < texts.length; i += RAG_EMBED_BATCH_SIZE) {
    const batch = await embedTexts(texts.slice(i, i + RAG_EMBED_BATCH_SIZE));
    out.push(...batch);
  }
  return out;
}

/**
 * Formats a vector as the literal pgvector expects, e.g. "[0.1,-0.2,...]".
 *
 * @param {number[]} embedding
 * @returns {string}
 */
function toVectorLiteral(embedding) {
  return `[${embedding.join(',')}]`;
}

module.exports = {
  embedTexts,
  embedTextsBatched,
  toVectorLiteral,
  RAG_EMBEDDING_MODEL,
  RAG_EMBEDDING_DIMENSIONS,
};
