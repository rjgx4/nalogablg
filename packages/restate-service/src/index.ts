import "dotenv/config";
import * as restate from "@restatedev/restate-sdk";
import { crawlSite } from "./crawl.js";
import { generatePrompts, type Brand, type Prompt } from "./gemini.js";
import {
  extractBrands,
  queryGeminiGrounded,
  type BrandMention,
  type Citation
} from "./llm-query.js";
import { aggregateAnalysis, type Aggregate } from "./aggregate.js";

type PromptResult = Prompt & {
  answer: string;
  citations: Citation[];
  searchQueries: string[];
  brands: BrandMention[];
  targetMentioned: boolean;
  targetMentions: number;
};

type Analysis = {
  url: string;
  brand: Brand;
  prompts: Prompt[];
  promptResults: PromptResult[];
  aggregate: Aggregate;
};

async function runAnalysis(
  ctx: restate.ObjectContext,
  url: string
): Promise<Analysis & { cached: false }> {
  const content = await crawlSite(ctx, url);
  const { brand, prompts } = await ctx.run("generatePrompts", () =>
    generatePrompts(content)
  );

  const grounded = await restate.RestatePromise.all(
    prompts.map((p, i) =>
      ctx.run(`gemini-grounded-${i}`, () => queryGeminiGrounded(p.prompt))
    )
  );
  const extracted = await restate.RestatePromise.all(
    grounded.map((g, i) =>
      ctx.run(`gemini-extract-${i}`, () =>
        extractBrands(g.answer, brand.name, g.citations)
      )
    )
  );
  const promptResults: PromptResult[] = prompts.map((p, i) => ({
    ...p,
    ...grounded[i],
    ...extracted[i]
  }));

  const aggregate = aggregateAnalysis(promptResults);
  const analysis: Analysis = { url, brand, prompts, promptResults, aggregate };
  ctx.set("analysis", analysis);
  return { ...analysis, cached: false };
}

const analyzer = restate.object({
  name: "Analyzer",
  handlers: {
    analyze: async (ctx: restate.ObjectContext, req: { url: string }) => {
      const cached = await ctx.get<Analysis>("analysis");
      if (cached) return { ...cached, cached: true };
      return runAnalysis(ctx, req.url);
    },
    refresh: (ctx: restate.ObjectContext, req: { url: string }) =>
      runAnalysis(ctx, req.url)
  }
});

restate.serve({ services: [analyzer], port: 9080 });
