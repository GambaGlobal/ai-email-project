import type { CitationPayload } from "@ai-email/shared";

const OPENAI_API_BASE = process.env.OPENAI_API_BASE_URL?.trim() || "https://api.openai.com/v1";
const DEFAULT_RESPONSES_MODEL =
  process.env.OPENAI_RESPONSES_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini";

type ResponsesApiPayload = {
  output_text?: unknown;
  output?: Array<{
    content?: Array<{
      text?: unknown;
    }>;
  }>;
};

function assertApiKey(): string {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new Error("OPENAI_API_KEY is required for generation preview");
  }
  return key;
}

function extractOutputText(payload: ResponsesApiPayload): string {
  if (typeof payload.output_text === "string" && payload.output_text.trim().length > 0) {
    return payload.output_text.trim();
  }

  const segments: string[] = [];
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (typeof content.text === "string" && content.text.trim().length > 0) {
        segments.push(content.text.trim());
      }
    }
  }

  return segments.join("\n").trim();
}

export async function generatePreviewDraft(input: {
  query: string;
  citationPayload: CitationPayload;
}): Promise<string> {
  const key = assertApiKey();

  const systemInstruction = [
    "You are drafting a concise customer support reply for an outdoor travel operator.",
    "Use only the provided citation payload sources.",
    "If sources are insufficient, say you do not have enough information and ask a clarifying follow-up.",
    "Do not invent policies, prices, dates, or exceptions."
  ].join(" ");

  const userPrompt = [
    `User query: ${input.query}`,
    "Citation payload (JSON):",
    JSON.stringify(input.citationPayload)
  ].join("\n\n");

  const response = await fetch(`${OPENAI_API_BASE}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: DEFAULT_RESPONSES_MODEL,
      temperature: 0,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: systemInstruction }]
        },
        {
          role: "user",
          content: [{ type: "input_text", text: userPrompt }]
        }
      ]
    })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`RESPONSES_FAILED: status=${response.status} body=${body.slice(0, 500)}`);
  }

  const payload = (await response.json()) as ResponsesApiPayload;
  const draft = extractOutputText(payload);
  if (draft.length === 0) {
    throw new Error("RESPONSES_FAILED: empty output text");
  }
  return draft;
}
