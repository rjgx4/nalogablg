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
  targetBrand: string,
  citations: Citation[]
): Promise<BrandExtraction> {
  const apiKey = getApiKey();
  const systemPrompt = `You extract brand/company/product names from a Gemini answer and its source citations.

You have two signals:
1. Direct mentions in the answer text — count each occurrence.
2. Citation source domains that are brand-owned sites — count each such citation as one mention of that brand. Examples: "trybello.com" → "Bello", "color-wow.com" → "Color Wow", "theradome.com" → "Theradome".

Do NOT count citations from authoritative or general-purpose domains as brand mentions. Skip: medical/health authorities (mayoclinic.org, clevelandclinic.org, nih.gov, aafp.org, webmd.com), encyclopedic sites (wikipedia.org), social/video platforms (youtube.com, reddit.com, tiktok.com, instagram.com), search/news aggregators, app stores, and generic news sites. Apply judgment for borderline cases — only credit citations from sites that clearly represent a specific product, company, or commercial brand.

Output rules:
- One entry per distinct brand, using its canonical name (e.g., "Stripe" not "stripe inc.").
- "mentions" = (count of text mentions) + (count of citations from that brand's domain).
- The target brand is "${targetBrand}". Set targetMentioned=true if it appears via either signal; targetMentions = total combined count.
- The target brand should appear in the brands array if mentioned, with the combined count.
- If no brands are found through either signal, return an empty brands array, targetMentioned=false, targetMentions=0.`;

  const citationLines =
    citations.length === 0
      ? "(no citations)"
      : citations.map((c) => `- ${c.url} (${c.title})`).join("\n");

  const userInput = `Answer text:
${answer}

Source citations:
${citationLines}`;

  const res = await fetch(endpoint(apiKey), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: userInput }] }],
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
