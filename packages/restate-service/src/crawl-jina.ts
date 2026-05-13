import * as restate from "@restatedev/restate-sdk";

async function fetchJina(url: string): Promise<string> {
  const apiKey = process.env.JINA_API_KEY;
  const headers: Record<string, string> = { Accept: "text/plain" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const res = await fetch(`https://r.jina.ai/${url}`, { headers });
  if (!res.ok) {
    throw new Error(`Jina fetch failed: ${res.status} ${await res.text()}`);
  }
  const text = await res.text();
  if (!text.trim()) throw new Error("Jina returned empty content");
  return text;
}

export async function crawlSiteJina(
  ctx: restate.ObjectContext,
  url: string
): Promise<string> {
  return ctx.run("jina-fetch", () => fetchJina(url));
}
