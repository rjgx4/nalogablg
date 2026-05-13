export type Stage =
  | "awareness"
  | "consideration"
  | "decision"
  | "problem-focused"
  | "solution-focused";

export type Prompt = { stage: Stage; prompt: string };

export type Brand = { name: string; description: string };

export type PromptGenResult = { brand: Brand; prompts: Prompt[] };

const SYSTEM_PROMPT = `You analyze a website's content and produce two things:

1. brand: identify the brand at this site. Provide a short canonical name (e.g., "Stripe", "HubSpot") and a one-line description of what they do.

2. prompts: generate exactly 5 prompts that potential customers might ask AI assistants (ChatGPT, Gemini) when looking for solutions in this business's domain.

For prompts, generate exactly one for each buying-journey stage:
- awareness: broad, problem-space exploration ("what tools help with X")
- consideration: comparing options/categories ("best X for Y")
- decision: comparing specific named products ("X vs Y")
- problem-focused: a specific pain point ("how to do X effectively")
- solution-focused: a specific feature/integration need ("X with Y feature")

Make the prompts realistic, diverse, and the kind of thing a real prospective customer would type. Do not mention the analyzed brand's name in the prompts.`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    brand: {
      type: "object",
      properties: {
        name: { type: "string" },
        description: { type: "string" }
      },
      required: ["name", "description"]
    },
    prompts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          stage: {
            type: "string",
            enum: ["awareness", "consideration", "decision", "problem-focused", "solution-focused"]
          },
          prompt: { type: "string" }
        },
        required: ["stage", "prompt"]
      },
      minItems: 5,
      maxItems: 5
    }
  },
  required: ["brand", "prompts"]
};

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
};

export async function generatePrompts(siteContent: string): Promise<PromptGenResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY must be set");

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [
        {
          role: "user",
          parts: [{ text: `Website content:\n\n${siteContent.slice(0, 30_000)}` }]
        }
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA
      }
    })
  });

  if (!res.ok) {
    throw new Error(`Gemini call failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as GeminiResponse;
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no content");

  return JSON.parse(text) as PromptGenResult;
}
