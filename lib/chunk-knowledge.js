/** Split knowledge.txt into titled chunks for RAG retrieval. */

const MAX_CHUNK_CHARS = 3_500;
const PINNED_TITLE_PATTERNS = [
  /^IDENTITY & CONTACT$/i,
  /^EDUCATION — AUTHORITATIVE/i,
  /^ELEVATOR PITCH & CURRENT STATUS$/i,
];

export function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

export function isPinnedTitle(title) {
  return PINNED_TITLE_PATTERNS.some((re) => re.test(title.trim()));
}

function splitOversized(text, title) {
  if (/FIGMA SECTION:/.test(text)) {
    const parts = text
      .split(/(?=^FIGMA SECTION:)/m)
      .map((p) => p.trim())
      .filter(Boolean);
    const out = [];
    for (const part of parts) {
      out.push(...(part.length <= MAX_CHUNK_CHARS ? [part] : splitBySize(part)));
    }
    return out.length ? out : splitBySize(text);
  }

  const subParts = text.split(/(?=^--- .+ ---\s*$)/m);
  const parts = [];
  let buffer = "";

  for (const part of subParts) {
    const candidate = buffer ? `${buffer}\n${part}` : part;
    if (candidate.length <= MAX_CHUNK_CHARS) {
      buffer = candidate;
    } else {
      if (buffer.trim()) parts.push(buffer.trim());
      if (part.length <= MAX_CHUNK_CHARS) {
        buffer = part;
      } else {
        parts.push(...splitBySize(part));
        buffer = "";
      }
    }
  }
  if (buffer.trim()) parts.push(buffer.trim());

  return parts.length ? parts : splitBySize(text);
}

function splitBySize(text) {
  const paragraphs = text.split(/\n{2,}/);
  const out = [];
  let buf = "";

  for (const para of paragraphs) {
    const next = buf ? `${buf}\n\n${para}` : para;
    if (next.length <= MAX_CHUNK_CHARS) {
      buf = next;
    } else {
      if (buf) out.push(buf);
      if (para.length <= MAX_CHUNK_CHARS) {
        buf = para;
      } else {
        for (let i = 0; i < para.length; i += MAX_CHUNK_CHARS) {
          out.push(para.slice(i, i + MAX_CHUNK_CHARS));
        }
        buf = "";
      }
    }
  }
  if (buf) out.push(buf);
  return out;
}

/**
 * Major sections use:
 *   ================
 *   SECTION TITLE
 *   ================
 *   body...
 */
export function parseMajorSections(raw) {
  const delim = /^={20,}\n([^\n]+)\n^={20,}\n/gm;
  const hits = [];
  let match;

  while ((match = delim.exec(raw)) !== null) {
    hits.push({
      title: match[1].trim(),
      bodyStart: match.index + match[0].length,
      sectionStart: match.index,
    });
  }

  const sections = [];
  for (let i = 0; i < hits.length; i++) {
    const end = i + 1 < hits.length ? hits[i + 1].sectionStart : raw.length;
    const text = raw.slice(hits[i].bodyStart, end).trim();
    if (text) {
      sections.push({ title: hits[i].title, text });
    }
  }

  return sections;
}

export function parseKnowledge(raw) {
  const sections = parseMajorSections(raw);
  const chunks = [];
  let index = 0;

  for (const section of sections) {
    const bodies =
      section.text.length <= MAX_CHUNK_CHARS
        ? [section.text]
        : splitOversized(section.text, section.title);

    for (let i = 0; i < bodies.length; i++) {
      const title =
        bodies.length > 1
          ? `${section.title} (${i + 1}/${bodies.length})`
          : section.title;

      chunks.push({
        id: `${slugify(section.title)}-${index}`,
        title,
        text: bodies[i],
        pinned: isPinnedTitle(section.title),
      });
      index += 1;
    }
  }

  return chunks;
}
