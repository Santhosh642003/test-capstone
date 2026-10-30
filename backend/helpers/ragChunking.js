// ---------------------------------------------------------------------------
// Markdown chunking for the RAG store.
//
// Pure functions, no I/O -- splits one markdown document (as produced by the
// build*Markdown functions in helpers/elliq.js) into the rows that become
// rag_chunks.
// ---------------------------------------------------------------------------

const MAX_CHUNK_CHARS = 2000;
const CHUNK_OVERLAP_CHARS = 200;

const MARKDOWN_HEADER_SPLIT_REGEX = /(?=^#{1,6}\s+.*$)/m;
const MARKDOWN_HEADER_TITLE_REGEX = /^#{1,6}\s+(.*)$/m;
const MARKDOWN_H1_REGEX = /^#\s+(.*)$/m;
const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---/;

/**
 * Reads the YAML frontmatter the build*Markdown functions emit into a flat
 * object of `key: value` strings.
 *
 * Every document already states its own identifying facts up there -- customer
 * id, claim id, claim status, whether the task is justified -- so lifting them
 * into chunk metadata is what makes a hybrid query possible without the
 * builders having to declare their filter keys twice. Empty values ("claim_id:"
 * with nothing after it) become null rather than "", so a filter for "has no
 * claim" is expressible.
 *
 * Deliberately not a YAML parser: the frontmatter these builders emit is one
 * flat level of scalars, and pulling in a dependency to parse a format we also
 * generate would be trading a known shape for a general one.
 *
 * @param {string} markdown
 * @returns {Object} empty when there is no frontmatter block.
 */
function parseFrontmatter(markdown) {
  const match = String(markdown || '').match(FRONTMATTER_REGEX);
  if (!match) return {};

  const fields = {};
  for (const line of match[1].split('\n')) {
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    if (!key) continue;
    const value = line.slice(separator + 1).trim();
    fields[key] = value === '' ? null : value;
  }
  return fields;
}

/**
 * Pulls the document's `# Heading` out of built markdown, used to label chunks.
 *
 * @param {string} markdown
 * @returns {string|null}
 */
function extractDocumentTitle(markdown) {
  const match = markdown.match(MARKDOWN_H1_REGEX);
  return match ? match[1].trim() : null;
}

/**
 * Splits on markdown headers, keeping each header with the body beneath it.
 *
 * @param {string} text
 * @returns {{title: string|null, content: string}[]}
 */
function splitByMarkdownHeaders(text) {
  return text
    .split(MARKDOWN_HEADER_SPLIT_REGEX)
    .map((section) => section.trim())
    .filter((section) => section.length > 0)
    .map((section) => {
      const titleMatch = section.match(MARKDOWN_HEADER_TITLE_REGEX);
      return { title: titleMatch ? titleMatch[1].trim() : null, content: section };
    });
}

/**
 * Fallback for sections larger than maxChars: fixed windows with overlap so a
 * fact spanning a boundary still appears whole in one of them.
 *
 * @param {string} text
 * @param {number} maxChars
 * @param {number} overlapChars
 * @returns {string[]}
 */
function splitByCharWindow(text, maxChars, overlapChars) {
  const windows = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + maxChars, text.length);
    windows.push(text.slice(start, end));
    if (end === text.length) break;
    start = end - overlapChars;
  }
  return windows;
}

/**
 * Chunks one built markdown document.
 *
 * Each chunk carries two texts:
 *   content   -- the raw slice, stored and handed back to the LLM verbatim.
 *   embedText -- the same slice prefixed with the document's identity.
 *
 * The prefix matters because these documents are mostly label/value bullets
 * rather than prose. A bare chunk reading "* **Goal Status:** In Progress"
 * embeds almost no retrievable signal and is meaningless out of context;
 * prefixing "Customer 600123 - Jane Doe | Goals/Outcomes" gives the embedding
 * something to anchor on without polluting what the model finally reads.
 *
 * @param {Object} params
 * @param {string} params.markdown
 * @param {string} params.objectType
 * @param {number|string} params.objectId
 * @param {number|string} [params.customerId]
 * @param {Object} [params.extraMetadata] merged into every chunk's metadata.
 *   This is what a hybrid query pre-filters on -- "claim lines still awaiting
 *   submission" is a metadata predicate, not something a vector search can
 *   express. Kept out of the embedded text: it is for filtering, and putting
 *   ids into the embedding only adds noise.
 * @returns {{chunkIndex: number, sectionTitle: string|null, content: string, embedText: string, metadata: Object}[]}
 */
function chunkDocument({ markdown, objectType, objectId, customerId, extraMetadata }) {
  if (!markdown || !markdown.trim()) return [];

  const documentTitle = extractDocumentTitle(markdown);
  const frontmatter = parseFrontmatter(markdown);
  const identityParts = [`${objectType} ${objectId}`];
  if (documentTitle) identityParts.push(documentTitle);
  // Non-customer documents get the owning customer stamped on too, so a task or
  // case-note chunk still embeds who it belongs to.
  if (customerId !== undefined && customerId !== null && String(customerId) !== String(objectId)) {
    identityParts.push(`customer ${customerId}`);
  }
  const identity = identityParts.join(' - ');

  const chunks = [];

  for (const section of splitByMarkdownHeaders(markdown)) {
    const slices = section.content.length <= MAX_CHUNK_CHARS
      ? [section.content]
      : splitByCharWindow(section.content, MAX_CHUNK_CHARS, CHUNK_OVERLAP_CHARS);

    for (const slice of slices) {
      if (!slice.trim()) continue;
      // The H1 section's title is the document title, already in `identity`.
      const contextHeader = section.title && section.title !== documentTitle
        ? `${identity} | ${section.title}`
        : identity;
      chunks.push({
        chunkIndex: chunks.length,
        sectionTitle: section.title,
        content: slice,
        embedText: `${contextHeader}\n\n${slice}`,
        metadata: {
          // Frontmatter first: the explicit fields below and any caller
          // override win on a key collision.
          ...frontmatter,
          objectType,
          objectId: Number(objectId),
          customerId: customerId === undefined || customerId === null ? null : Number(customerId),
          sectionTitle: section.title,
          documentTitle,
          ...(extraMetadata || {}),
        },
      });
    }
  }

  return chunks;
}

module.exports = {
  chunkDocument,
  parseFrontmatter,
  extractDocumentTitle,
  splitByMarkdownHeaders,
  splitByCharWindow,
  MAX_CHUNK_CHARS,
  CHUNK_OVERLAP_CHARS,
};
