/**
 * Embeddings default to HuggingFace's free inference API.
 * The database schema expects 384 dimensions, so every provider is forced to
 * return that size.
 */

const HF_MODEL = "sentence-transformers/all-MiniLM-L6-v2";
const HF_URL = `https://api-inference.huggingface.co/pipeline/feature-extraction/${HF_MODEL}`;

export const EMBEDDING_DIMS = 384;

export async function generateEmbedding(text: string): Promise<number[]> {
  const provider = process.env.EMBEDDING_PROVIDER?.trim().toLowerCase() ?? "local";

  if (provider === "local") {
    return generateLocalEmbedding(text);
  }

  if (provider === "openai") {
    try {
      return assertEmbeddingSize(await generateWithOpenAI(text), "OpenAI");
    } catch (err) {
      console.warn("OpenAI embedding failed, using local fallback:", err);
      return generateLocalEmbedding(text);
    }
  }

  try {
    return assertEmbeddingSize(await generateWithHuggingFace(text), "HuggingFace");
  } catch (err) {
    console.warn("HuggingFace embedding failed, using local fallback:", err);
    return generateLocalEmbedding(text);
  }
}

async function generateWithHuggingFace(text: string): Promise<number[]> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  // Optional: add HF token for higher rate limits
  if (process.env.HUGGINGFACE_TOKEN) {
    headers["Authorization"] = `Bearer ${process.env.HUGGINGFACE_TOKEN}`;
  }

  const res = await fetch(HF_URL, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(7_000),
    body: JSON.stringify({
      inputs: text,
      options: { wait_for_model: true },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`HuggingFace embedding error: ${err}`);
  }

  const data = await res.json();

  // HF returns [[...384 floats...]] for a single string input
  const embedding: number[] = Array.isArray(data[0]) ? data[0] : data;

  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error("Invalid embedding response from HuggingFace");
  }

  return embedding;
}

async function generateWithOpenAI(text: string): Promise<number[]> {
  const model = process.env.EMBEDDING_MODEL ?? "text-embedding-3-small";
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(7_000),
    body: JSON.stringify({ model, input: text, dimensions: EMBEDDING_DIMS }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI embedding error: ${err}`);
  }

  const data = await res.json();
  return data.data[0].embedding as number[];
}

function assertEmbeddingSize(embedding: number[], provider: string): number[] {
  if (embedding.length !== EMBEDDING_DIMS) {
    throw new Error(
      `${provider} returned ${embedding.length} embedding dimensions; expected ${EMBEDDING_DIMS}`
    );
  }

  return embedding;
}

function generateLocalEmbedding(text: string): number[] {
  const vector = new Array<number>(EMBEDDING_DIMS).fill(0);
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s.-]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2);

  for (const token of tokens) {
    const index = positiveHash(token) % EMBEDDING_DIMS;
    vector[index] += 1;

    const prefix = token.slice(0, 5);
    if (prefix && prefix !== token) {
      vector[positiveHash(prefix) % EMBEDDING_DIMS] += 0.35;
    }
  }

  const norm = Math.hypot(...vector);
  if (norm === 0) return vector;

  return vector.map((value) => value / norm);
}

function positiveHash(value: string): number {
  let hash = 2166136261;

  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}
