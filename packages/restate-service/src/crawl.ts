import * as restate from "@restatedev/restate-sdk";
import { crawlSiteCloudflare } from "./crawl-cloudflare.js";
import { crawlSiteJina } from "./crawl-jina.js";

export async function crawlSite(
  ctx: restate.ObjectContext,
  url: string
): Promise<string> {
  const impl = (process.env.CRAWLER ?? "jina").toLowerCase();
  if (impl === "cloudflare") return crawlSiteCloudflare(ctx, url);
  if (impl === "jina") return crawlSiteJina(ctx, url);
  throw new Error(`Unknown CRAWLER value: "${impl}" (expected "jina" or "cloudflare")`);
}
