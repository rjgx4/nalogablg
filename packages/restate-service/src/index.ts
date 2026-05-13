import "dotenv/config";
import * as restate from "@restatedev/restate-sdk";
import { crawlSite } from "./crawl.js";
import { generatePrompts, type Prompt } from "./gemini.js";

async function runAnalysis(ctx: restate.ObjectContext, url: string) {
  const content = await crawlSite(ctx, url);
  const prompts = await ctx.run("generatePrompts", () => generatePrompts(content));
  ctx.set("prompts", prompts);
  return { url, prompts, cached: false };
}

const analyzer = restate.object({
  name: "Analyzer",
  handlers: {
    analyze: async (ctx: restate.ObjectContext, req: { url: string }) => {
      const cached = await ctx.get<Prompt[]>("prompts");
      if (cached) return { url: req.url, prompts: cached, cached: true };
      return runAnalysis(ctx, req.url);
    },
    refresh: (ctx: restate.ObjectContext, req: { url: string }) =>
      runAnalysis(ctx, req.url)
  }
});

restate.serve({ services: [analyzer], port: 9080 });
