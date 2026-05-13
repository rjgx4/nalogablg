import "dotenv/config";
import * as restate from "@restatedev/restate-sdk";
import { crawlSite } from "./crawl.js";
import { generatePrompts, type Brand, type Prompt } from "./gemini.js";
import {
  extractBrands,
  queryGeminiGrounded,
  queryOpenAIWebSearch,
  type BrandMention,
  type Citation,
  type LlmName
} from "./llm-query.js";
import { aggregateAnalysis, type Aggregate } from "./aggregate.js";

type LlmResponse = {
  answer: string;
  citations: Citation[];
  searchQueries: string[];
  brands: BrandMention[];
  targetMentioned: boolean;
  targetMentions: number;
};

type PromptResult = Prompt & {
  responses: Partial<Record<LlmName, LlmResponse>>;
  combined: LlmResponse;
};

type Analysis = {
  url: string;
  brand: Brand;
  prompts: Prompt[];
  promptResults: PromptResult[];
  aggregate: Aggregate;
};

function combineResponses(parts: LlmResponse[]): LlmResponse {
  const brandsByKey = new Map<string, BrandMention>();
  const citationsByUrl = new Map<string, Citation>();
  const queriesSet = new Set<string>();
  let answerParts: string[] = [];
  let targetMentions = 0;
  let targetMentioned = false;

  for (const p of parts) {
    if (p.answer) answerParts.push(p.answer);
    for (const b of p.brands) {
      const k = b.name.trim().toLowerCase();
      const ex = brandsByKey.get(k);
      if (ex) ex.mentions += b.mentions;
      else brandsByKey.set(k, { name: b.name, mentions: b.mentions });
    }
    for (const c of p.citations) {
      if (!citationsByUrl.has(c.url)) citationsByUrl.set(c.url, c);
    }
    for (const q of p.searchQueries) queriesSet.add(q);
    targetMentions += p.targetMentions;
    if (p.targetMentioned) targetMentioned = true;
  }

  return {
    answer: answerParts.join("\n\n---\n\n"),
    citations: Array.from(citationsByUrl.values()),
    searchQueries: Array.from(queriesSet),
    brands: Array.from(brandsByKey.values()),
    targetMentioned,
    targetMentions
  };
}

async function runAnalysis(
  ctx: restate.ObjectContext,
  url: string
): Promise<Analysis & { cached: false }> {
  const content = await crawlSite(ctx, url);
  const { brand, prompts } = await ctx.run("generatePrompts", () =>
    generatePrompts(content)
  );

  const hasOpenAI = !!process.env.OPENAI_API_KEY;

  // Phase 1: queries. Flat order: all Gemini, then all OpenAI (if enabled).
  const queryPromises = [
    ...prompts.map((p, i) =>
      ctx.run(`gemini-grounded-${i}`, () => queryGeminiGrounded(p.prompt))
    ),
    ...(hasOpenAI
      ? prompts.map((p, i) =>
          ctx.run(`openai-search-${i}`, () => queryOpenAIWebSearch(p.prompt))
        )
      : [])
  ];
  const queryResults = await restate.RestatePromise.all(queryPromises);
  const geminiAnswers = queryResults.slice(0, prompts.length);
  const openaiAnswers = hasOpenAI ? queryResults.slice(prompts.length) : [];

  // Phase 2: extracts. Same flat order.
  const extractPromises = [
    ...prompts.map((_, i) =>
      ctx.run(`gemini-extract-${i}`, () =>
        extractBrands(geminiAnswers[i].answer, brand.name, geminiAnswers[i].citations)
      )
    ),
    ...(hasOpenAI
      ? prompts.map((_, i) =>
          ctx.run(`openai-extract-${i}`, () =>
            extractBrands(
              openaiAnswers[i].answer,
              brand.name,
              openaiAnswers[i].citations
            )
          )
        )
      : [])
  ];
  const extractResults = await restate.RestatePromise.all(extractPromises);
  const geminiExtracts = extractResults.slice(0, prompts.length);
  const openaiExtracts = hasOpenAI ? extractResults.slice(prompts.length) : [];

  const promptResults: PromptResult[] = prompts.map((p, i) => {
    const responses: Partial<Record<LlmName, LlmResponse>> = {
      gemini: { ...geminiAnswers[i], ...geminiExtracts[i] }
    };
    if (hasOpenAI) {
      responses.openai = { ...openaiAnswers[i], ...openaiExtracts[i] };
    }
    const combined = combineResponses(
      Object.values(responses).filter((r): r is LlmResponse => !!r)
    );
    return { ...p, responses, combined };
  });

  const aggregate = aggregateAnalysis(
    promptResults.map((r) => ({
      brands: r.combined.brands,
      targetMentions: r.combined.targetMentions,
      citations: r.combined.citations
    }))
  );

  const analysis: Analysis = { url, brand, prompts, promptResults, aggregate };
  ctx.set("analysisV2", analysis);
  return { ...analysis, cached: false };
}

const analyzer = restate.object({
  name: "Analyzer",
  handlers: {
    analyze: async (ctx: restate.ObjectContext, req: { url: string }) => {
      const cached = await ctx.get<Analysis>("analysisV2");
      if (cached) return { ...cached, cached: true };
      return runAnalysis(ctx, req.url);
    },
    refresh: (ctx: restate.ObjectContext, req: { url: string }) =>
      runAnalysis(ctx, req.url)
  }
});

restate.serve({ services: [analyzer], port: 9080 });
