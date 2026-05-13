import * as restate from "@restatedev/restate-sdk";

type PostResponse = {
  success: boolean;
  result: string;
  errors?: Array<{ code: number; message: string }>;
};

type CrawlRecord = {
  url: string;
  status?: string | number;
  markdown?: string;
  metadata?: { status?: number; title?: string };
};

type PollResponse = {
  success: boolean;
  result: {
    id: string;
    status: "pending" | "running" | "completed" | "failed" | string;
    records?: CrawlRecord[];
  };
};

type PollOutcome =
  | { status: "running" }
  | { status: "completed"; markdown: string }
  | { status: "failed"; reason: string };

function creds() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiToken) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN must be set");
  }
  return {
    apiToken,
    endpoint: `https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering/crawl`
  };
}

async function submitCrawlJob(url: string): Promise<string> {
  const { apiToken, endpoint } = creds();
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ url, depth: 1, limit: 5, formats: ["markdown"] })
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Crawl POST failed: ${res.status} ${body}`);
  const data = JSON.parse(body) as PostResponse;
  if (!data.success || typeof data.result !== "string") {
    throw new Error(`Crawl POST unexpected body: ${body}`);
  }
  return data.result;
}

async function pollCrawlJob(jobId: string): Promise<PollOutcome> {
  const { apiToken, endpoint } = creds();
  const res = await fetch(`${endpoint}/${jobId}`, {
    headers: { Authorization: `Bearer ${apiToken}` }
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Crawl poll failed: ${res.status} ${body}`);
  const data = JSON.parse(body) as PollResponse;
  const status = data.result?.status;

  if (status === "completed") {
    const markdown = (data.result.records ?? [])
      .filter((r) => r.markdown)
      .map((r) => `# ${r.metadata?.title ?? r.url}\n\n${r.markdown}`)
      .join("\n\n---\n\n");
    if (!markdown) return { status: "failed", reason: "no markdown in records" };
    return { status: "completed", markdown };
  }
  if (status === "failed") {
    return { status: "failed", reason: JSON.stringify(data).slice(0, 500) };
  }
  return { status: "running" };
}

export async function crawlSiteCloudflare(
  ctx: restate.ObjectContext,
  url: string
): Promise<string> {
  const jobId = await ctx.run("cf-submitCrawl", () => submitCrawlJob(url));

  const maxAttempts = 40;
  for (let i = 0; i < maxAttempts; i++) {
    await ctx.sleep(5000);
    const poll = await ctx.run(`cf-poll-${i}`, () => pollCrawlJob(jobId));
    if (poll.status === "completed") return poll.markdown;
    if (poll.status === "failed") throw new Error(`Crawl failed: ${poll.reason}`);
  }
  throw new Error("Crawl timed out");
}
