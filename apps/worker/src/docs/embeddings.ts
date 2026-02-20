const OPENAI_API_BASE = process.env.OPENAI_API_BASE_URL?.trim() || "https://api.openai.com/v1";
const DEFAULT_EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL?.trim() || "text-embedding-3-small";
const DEFAULT_BATCH_SIZE = Number.parseInt(process.env.OPENAI_EMBEDDING_BATCH_SIZE ?? "32", 10);

export const DOC_CHUNK_EMBEDDING_DIMENSIONS = 1536;

function assertApiKey(): string {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new Error("OPENAI_API_KEY is required for doc indexing embeddings");
  }
  return key;
}

function resolveBatchSize(): number {
  if (!Number.isFinite(DEFAULT_BATCH_SIZE) || DEFAULT_BATCH_SIZE <= 0) {
    return 32;
  }
  return Math.min(64, Math.max(1, DEFAULT_BATCH_SIZE));
}

function toSafeEmbedding(value: unknown): number[] {
  if (!Array.isArray(value)) {
    throw new Error("Invalid embedding vector payload");
  }
  const vector = value.map((entry) => {
    if (typeof entry !== "number" || !Number.isFinite(entry)) {
      throw new Error("Invalid embedding vector value");
    }
    return entry;
  });
  if (vector.length !== DOC_CHUNK_EMBEDDING_DIMENSIONS) {
    throw new Error(`Embedding vector dimensions mismatch: expected ${DOC_CHUNK_EMBEDDING_DIMENSIONS}, got ${vector.length}`);
  }
  return vector;
}

type EmbeddingsResponse = {
  data?: Array<{
    embedding?: unknown;
    index?: number;
  }>;
};

export async function embedTexts(input: { texts: string[] }): Promise<{ model: string; vectors: number[][] }> {
  if (input.texts.length === 0) {
    return { model: DEFAULT_EMBEDDING_MODEL, vectors: [] };
  }

  const vectors: number[][] = [];
  const batchSize = resolveBatchSize();
  const key = assertApiKey();

  for (let start = 0; start < input.texts.length; start += batchSize) {
    const batch = input.texts.slice(start, start + batchSize);
    const response = await fetch(`${OPENAI_API_BASE}/embeddings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: DEFAULT_EMBEDDING_MODEL,
        input: batch
      })
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`EMBEDDING_FAILED: status=${response.status} body=${body.slice(0, 500)}`);
    }

    const payload = (await response.json()) as EmbeddingsResponse;
    const items = Array.isArray(payload.data) ? payload.data : [];
    if (items.length !== batch.length) {
      throw new Error("EMBEDDING_FAILED: unexpected embeddings response length");
    }

    for (const item of items) {
      vectors.push(toSafeEmbedding(item.embedding));
    }
  }

  return {
    model: DEFAULT_EMBEDDING_MODEL,
    vectors
  };
}
