#!/usr/bin/env node
/** Build chunks.json from knowledge.txt for RAG retrieval. */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseKnowledge } from "../lib/chunk-knowledge.js";
import { tokenize } from "../lib/retrieve.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const KNOWLEDGE_PATH = path.join(ROOT, "knowledge.txt");
const OUT_PATH = path.join(ROOT, "chunks.json");

const raw = fs.readFileSync(KNOWLEDGE_PATH, "utf8");
const chunks = parseKnowledge(raw).map((chunk) => ({
  ...chunk,
  tokens: tokenize(`${chunk.title}\n${chunk.text}`),
  titleTokens: tokenize(chunk.title),
}));

const payload = {
  version: 1,
  generatedAt: new Date().toISOString(),
  source: "knowledge.txt",
  sourceChars: raw.length,
  chunkCount: chunks.length,
  pinnedCount: chunks.filter((c) => c.pinned).length,
  chunks,
};

fs.writeFileSync(OUT_PATH, JSON.stringify(payload));

const sizes = chunks.map((c) => c.text.length);
console.log(`Wrote ${OUT_PATH}`);
console.log(`  chunks: ${chunks.length} (pinned: ${payload.pinnedCount})`);
console.log(
  `  size chars: min=${Math.min(...sizes)} max=${Math.max(...sizes)} avg=${Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length)}`
);
