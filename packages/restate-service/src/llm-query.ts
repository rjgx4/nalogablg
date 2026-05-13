export type Citation = { url: string; title: string };

export type GroundedResponse = {
  answer: string;
  citations: Citation[];
  searchQueries: string[];
};

export type BrandMention = { name: string; mentions: number };

export type BrandExtraction = {
  brands: BrandMention[];
  targetMentioned: boolean;
  targetMentions: number;
};

function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY must be set");
  return key;
}

function endpoint(apiKey: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
}

let firstGroundedLogged = false;

type GroundingChunk = { web?: { uri?: string; title?: string } };
type Candidate = {
  content?: { parts?: { text?: string }[] };
  groundingMetadata?: {
    groundingChunks?: GroundingChunk[];
    webSearchQueries?: string[];
  };
};

export async function queryGeminiGrounded(prompt: string): Promise<GroundedResponse> {
  const apiKey = getApiKey();
  const res = await fetch(endpoint(apiKey), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      tools: [{ googleSearch: {} }]
    })
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Gemini grounded call failed: ${res.status} ${body}`);

  if (!firstGroundedLogged) {
    console.log("[llm-query] first grounded response (truncated):", body.slice(0, 2000));
    firstGroundedLogged = true;
  }

  const data = JSON.parse(body) as { candidates?: Candidate[] };
  const candidate = data.candidates?.[0];
  if (!candidate) {
    throw new Error(`Gemini grounded returned no candidates: ${body.slice(0, 500)}`);
  }

  const answer = (candidate.content?.parts ?? [])
    .map((p) => p.text ?? "")
    .join("")
    .trim();

  const citations: Citation[] = (candidate.groundingMetadata?.groundingChunks ?? [])
    .map((c) => c.web)
    .filter((w): w is { uri: string; title?: string } => !!w?.uri)
    .map((w) => ({ url: w.uri, title: w.title ?? w.uri }));

  const searchQueries = candidate.groundingMetadata?.webSearchQueries ?? [];

  return { answer, citations, searchQueries };
}

const EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    brands: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          mentions: { type: "integer" }
        },
        required: ["name", "mentions"]
      }
    },
    targetMentioned: { type: "boolean" },
    targetMentions: { type: "integer" }
  },
  required: ["brands", "targetMentioned", "targetMentions"]
};

type ExtractResponse = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
};

export async function extractBrands(
  answer: string,
  targetBrand: string
): Promise<BrandExtraction> {
  const apiKey = getApiKey();
  const systemPrompt = `You extract brand/company/product names from an answer text.

Identify all distinct brands, companies, products, or services mentioned. For each, count how many times it appears across the text (case-insensitive; treat variations like "Stripe Inc." and "stripe" as the same "Stripe"). Use the canonical brand name in your output.

You will be given a target brand: "${targetBrand}". Set targetMentioned=true if the target brand is mentioned in any form (variations, differing capitalization, with corporate suffixes); set targetMentions to its occurrence count. The target brand should also appear in the brands array if mentioned.

Only list actual brand/company/product names — not generic categories, features, or technologies. If no brands are mentioned, return an empty brands array, targetMentioned=false, targetMentions=0.`;

  const res = await fetch(endpoint(apiKey), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: answer }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: EXTRACT_SCHEMA
      }
    })
  });

  if (!res.ok) {
    throw new Error(`Brand extraction failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as ExtractResponse;
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Brand extraction returned no content");

  return JSON.parse(text) as BrandExtraction;
}
