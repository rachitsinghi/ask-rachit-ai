/** Lexical RAG retrieval over pre-built knowledge chunks. */

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "must",
  "shall",
  "can",
  "need",
  "about",
  "what",
  "which",
  "who",
  "whom",
  "whose",
  "when",
  "where",
  "why",
  "how",
  "this",
  "that",
  "these",
  "those",
  "i",
  "you",
  "he",
  "she",
  "it",
  "we",
  "they",
  "me",
  "him",
  "her",
  "us",
  "them",
  "my",
  "your",
  "his",
  "its",
  "our",
  "their",
  "with",
  "from",
  "by",
  "as",
  "if",
  "then",
  "than",
  "so",
  "just",
  "also",
  "very",
  "too",
  "not",
  "no",
  "yes",
  "all",
  "any",
  "some",
  "tell",
  "know",
  "did",
  "does",
  "rachit",
  "singhi",
]);

export function tokenize(text) {
  return (text.toLowerCase().match(/[a-z0-9]{2,}/g) || []).filter(
    (t) => !STOP_WORDS.has(t)
  );
}

function isLowQualityChunkTitle(title) {
  return (
    /^Source:/i.test(title) ||
    /^https?:\/\//i.test(title) ||
    /^Added June/i.test(title) ||
    /^Authoritative context for Rachit/i.test(title) ||
    /^COVERAGE STATUS/i.test(title)
  );
}

function sectionPenalty(chunk, queryTokens, queryLower) {
  let penalty = 0;

  if (/^FIGMA FILE:/i.test(chunk.title)) {
    const wantsFigma = /figma|ui3|ui2|portfolio file|layer|frame/.test(queryLower);
    penalty += wantsFigma ? 2 : 18;
  }

  if (/^CVs, TRANSCRIPTS/i.test(chunk.title)) {
    const wantsCv = /cv|resume|transcript|sop|pratt|ual|application|combined documents/.test(
      queryLower
    );
    penalty += wantsCv ? 0 : 14;
  }

  if (/^IMAGE-EXTRACTED CONTENT/i.test(chunk.title)) {
    const wantsImages = /dashboard|agra|mathematica|insync|teach for india|wix|image|slide/.test(
      queryLower
    );
    penalty += wantsImages ? 0 : 6;
  }

  return penalty;
}

function sectionBoost(chunk, queryLower) {
  let boost = 0;
  const hay = `${chunk.title}\n${chunk.text.slice(0, 400)}`.toLowerCase();

  if (/twinkle|constellation|star map/.test(queryLower) && /twinkle|mp2|star catalog/.test(hay)) {
    boost += 25;
  }
  if (/intrack|wearable|nutrient/.test(queryLower) && /intrack|nutrient|hackathon/.test(hay)) {
    boost += 25;
  }
  if (/behance|meat package|contagion|sketchbook/.test(queryLower) && /behance/.test(chunk.title)) {
    boost += 20;
  }
  if (/week 7|ui3|figma feedback/.test(queryLower) && /week 7|figma feedback|ui3/.test(hay)) {
    boost += 22;
  }
  if (/hcde|week [0-9]|pandas|mp1|assignment/.test(queryLower) && /hcde 530/.test(chunk.title)) {
    boost += 15;
  }
  if (/mathematica|agra|dashboard/.test(queryLower) && /mathematica|agra|agricultural/.test(hay)) {
    boost += 20;
  }
  if (/education|university|school|nid|uw|washington|pratt/.test(queryLower) && /education/.test(chunk.title)) {
    boost += 30;
  }

  return boost;
}

function scoreChunk(chunk, queryTokens, queryLower) {
  if (chunk.pinned) return Number.POSITIVE_INFINITY;

  const titleLower = chunk.title.toLowerCase();
  const textLower = chunk.text.toLowerCase();
  let score = sectionBoost(chunk, queryLower) - sectionPenalty(chunk, queryTokens, queryLower);

  if (isLowQualityChunkTitle(chunk.title)) score -= 50;

  for (const token of queryTokens) {
    if (titleLower.includes(token)) score += 6;
    const titleCount = chunk.titleTokens.filter((t) => t === token).length;
    score += titleCount * 4;

    const bodyCount = chunk.tokens.filter((t) => t === token).length;
    score += bodyCount * 2;

    if (textLower.includes(token)) score += 1;
  }

  // Phrase boost: consecutive query pairs appearing in text
  for (let i = 0; i < queryTokens.length - 1; i++) {
    const phrase = `${queryTokens[i]} ${queryTokens[i + 1]}`;
    if (textLower.includes(phrase) || titleLower.includes(phrase)) {
      score += 5;
    }
  }

  return score;
}

/**
 * @param {Array} chunks - from chunks.json
 * @param {string} query - latest user question
 * @param {{ topK?: number, maxChars?: number }} opts
 */
export function retrieveRelevantChunks(chunks, query, opts = {}) {
  const topK = opts.topK ?? 12;
  const maxChars = opts.maxChars ?? 55_000;

  const queryTokens = tokenize(query);
  const queryLower = query.toLowerCase();
  const scored = chunks
    .filter((chunk) => !isLowQualityChunkTitle(chunk.title))
    .map((chunk) => ({ chunk, score: scoreChunk(chunk, queryTokens, queryLower) }))
    .sort((a, b) => b.score - a.score);

  const selected = [];
  const seen = new Set();
  let usedChars = 0;

  function add(chunk) {
    if (seen.has(chunk.id)) return false;
    if (usedChars + chunk.text.length > maxChars && selected.length > 0) {
      return false;
    }
    seen.add(chunk.id);
    selected.push(chunk);
    usedChars += chunk.text.length;
    return true;
  }

  // Always include pinned core context (identity, education, etc.)
  for (const chunk of chunks) {
    if (chunk.pinned) add(chunk);
  }

  // Top scored chunks (cap noisy Figma shards)
  let figmaAdded = 0;
  const maxFigma = /figma/i.test(queryLower) ? 5 : 2;

  for (const { chunk, score } of scored) {
    if (selected.length >= topK + chunks.filter((c) => c.pinned).length) break;
    if (score <= 0) continue;
    if (/^FIGMA FILE:/i.test(chunk.title)) {
      if (figmaAdded >= maxFigma) continue;
      figmaAdded += 1;
    }
    add(chunk);
  }

  // Fallback if query matched nothing: include high-value project sections
  if (selected.filter((c) => !c.pinned).length === 0) {
    const fallbackTitles = [
      /^HCDE 530 —/i,
      /^INTRACK —/i,
      /^SELECTED PROJECTS/i,
      /^CV & APPLICATION/i,
      /^BEHANCE PROJECTS — DETAILED/i,
      /^ABOUT RACHIT/i,
    ];
    for (const chunk of chunks) {
      if (isLowQualityChunkTitle(chunk.title)) continue;
      if (fallbackTitles.some((re) => re.test(chunk.title))) {
        add(chunk);
        if (selected.length >= 8) break;
      }
    }
  }

  return {
    chunks: selected,
    queryTokens,
    usedChars,
  };
}

export function formatRetrievedContext(chunks) {
  return chunks
    .map(
      (c) =>
        `### ${c.title}\n${c.text.trim()}`
    )
    .join("\n\n---\n\n");
}
