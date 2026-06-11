import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseKnowledge } from "../lib/chunk-knowledge.js";
import { tokenize, retrieveRelevantChunks, formatRetrievedContext } from "../lib/retrieve.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const CHUNKS_PATH = path.join(ROOT, "chunks.json");
const KNOWLEDGE_PATH = path.join(ROOT, "knowledge.txt");

let cachedIndex = null;
let cachedClient = null;

function getOpenAIClient() {
  if (!cachedClient) {
    cachedClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return cachedClient;
}

function buildIndexFromKnowledge() {
  const raw = fs.readFileSync(KNOWLEDGE_PATH, "utf8");
  const chunks = parseKnowledge(raw).map((chunk) => ({
    ...chunk,
    tokens: tokenize(`${chunk.title}\n${chunk.text}`),
    titleTokens: tokenize(chunk.title),
  }));
  return chunks;
}

function loadChunkIndex() {
  if (cachedIndex) return cachedIndex;

  if (fs.existsSync(CHUNKS_PATH)) {
    const data = JSON.parse(fs.readFileSync(CHUNKS_PATH, "utf8"));
    cachedIndex = data.chunks;
    return cachedIndex;
  }

  cachedIndex = buildIndexFromKnowledge();
  return cachedIndex;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "POST only",
    });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({
      error: "OPENAI_API_KEY is not configured.",
    });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { question } = body;

    if (!question || typeof question !== "string") {
      return res.status(400).json({
        error: 'Request body must include a "question" string.',
      });
    }

    const index = loadChunkIndex();
    const { chunks: retrieved, usedChars } = retrieveRelevantChunks(index, question.trim(), {
      topK: 12,
      maxChars: 55_000,
    });

    const knowledge = formatRetrievedContext(retrieved);

    const response = await getOpenAIClient().responses.create({
      model: "gpt-4.1-nano",
      input: `
You are Rachit's portfolio assistant.

Rules:
- Only answer using the retrieved knowledge sections below. Do not invent employers, schools, or projects.
- Education: Rachit attended ONLY National Institute of Design (NID) for undergrad and University of Washington for MS HCDE. Pratt, UAL, etc. in the knowledge base are application SOP drafts only — not schools he attended. NID = National Institute of Design.
- Keep answers under 150 words.
- Be friendly and professional.
- If information is missing from the retrieved sections, say:
"I don't have information about that yet."

Retrieved Knowledge (${retrieved.length} sections):
${knowledge}

Question:
${question.trim()}
      `,
      max_output_tokens: 250,
    });

    res.status(200).json({
      answer: response.output_text,
      rag: {
        sectionsUsed: retrieved.map((c) => c.title),
        sectionCount: retrieved.length,
        contextChars: usedChars,
      },
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Something went wrong",
    });
  }
}
