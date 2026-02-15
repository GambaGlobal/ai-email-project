import { createHash } from "node:crypto";

const APPROX_CHARS_PER_TOKEN = 4;
const DEFAULT_TARGET_TOKENS = 800;
const DEFAULT_OVERLAP_TOKENS = 100;

const TARGET_CHARS = DEFAULT_TARGET_TOKENS * APPROX_CHARS_PER_TOKEN;
const OVERLAP_CHARS = DEFAULT_OVERLAP_TOKENS * APPROX_CHARS_PER_TOKEN;

export type ChunkRow = {
  chunkIndex: number;
  startChar: number;
  endChar: number;
  content: string;
  contentSha256: string;
};

function hashContent(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function collectParagraphStarts(text: string): number[] {
  const starts = [0];
  let cursor = 0;
  while (cursor < text.length) {
    const split = text.indexOf("\n\n", cursor);
    if (split < 0) {
      break;
    }
    const nextStart = split + 2;
    if (nextStart < text.length) {
      starts.push(nextStart);
    }
    cursor = nextStart;
  }
  starts.push(text.length);
  return Array.from(new Set(starts)).sort((a, b) => a - b);
}

function pickChunkEnd(start: number, paragraphStarts: number[], textLength: number): number {
  const preferredEnd = Math.min(textLength, start + TARGET_CHARS);
  let end = preferredEnd;

  for (const paragraphStart of paragraphStarts) {
    if (paragraphStart <= start) {
      continue;
    }
    if (paragraphStart > preferredEnd) {
      break;
    }
    end = paragraphStart;
  }

  if (end <= start) {
    end = Math.min(textLength, start + TARGET_CHARS);
  }
  return Math.max(end, Math.min(textLength, start + 1));
}

function nextChunkStart(end: number): number {
  return Math.max(0, end - OVERLAP_CHARS);
}

export function buildDeterministicChunks(text: string): ChunkRow[] {
  const normalized = text;
  if (normalized.length === 0) {
    return [];
  }

  const paragraphStarts = collectParagraphStarts(normalized);
  const chunks: ChunkRow[] = [];
  let start = 0;
  let chunkIndex = 0;

  while (start < normalized.length) {
    const end = pickChunkEnd(start, paragraphStarts, normalized.length);
    const content = normalized.slice(start, end);
    const visibleContent = content.trim();

    if (visibleContent.length > 0) {
      chunks.push({
        chunkIndex,
        startChar: start,
        endChar: end,
        content,
        contentSha256: hashContent(content)
      });
      chunkIndex += 1;
    }

    if (end >= normalized.length) {
      break;
    }

    const candidateStart = nextChunkStart(end);
    start = candidateStart <= start ? end : candidateStart;
  }

  return chunks;
}
