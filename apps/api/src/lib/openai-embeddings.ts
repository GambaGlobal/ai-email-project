const OPENAI_API_BASE = process.env.OPENAI_API_BASE_URL?.trim() || "https://api.openai.com/v1";
const DEFAULT_EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL?.trim() || "text-embedding-3-small";

export const DOC_CHUNK_EMBEDDING_DIMENSIONS = 1536;

function assertApiKey(): string {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new Error("OPENAI_API_KEY is required for retrieval embeddings");
  }
  return key;
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
  }>;
};

export async function embedTexts(input: { texts: string[] }): Promise<{ model: string; vectors: number[][] }> {
  if (input.texts.length === 0) {
    return {
      model: DEFAULT_EMBEDDING_MODEL,
      vectors: []
    };
  }

  const key = assertApiKey();
  const response = await fetch(`${OPENAI_API_BASE}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: DEFAULT_EMBEDDING_MODEL,
      input: input.texts
    })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`EMBEDDING_FAILED: status=${response.status} body=${body.slice(0, 500)}`);
  }

  const payload = (await response.json()) as EmbeddingsResponse;
  const items = Array.isArray(payload.data) ? payload.data : [];
  if (items.length !== input.texts.length) {
    throw new Error("EMBEDDING_FAILED: unexpected embeddings response length");
  }

  return {
    model: DEFAULT_EMBEDDING_MODEL,
    vectors: items.map((item) => toSafeEmbedding(item.embedding))
  };
}
