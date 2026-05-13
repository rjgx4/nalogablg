import type { BrandMention, Citation } from "./llm-query.js";

type PromptResultInput = {
  brands: BrandMention[];
  targetMentions: number;
  citations: Citation[];
};

export type Aggregate = {
  visibility: { score: number; targetMentions: number; totalMentions: number };
  marketShare: { name: string; mentions: number; percentage: number }[];
  citationDomains: { domain: string; count: number; urls: string[] }[];
};

function normalizeKey(name: string): string {
  return name.trim().toLowerCase();
}

function domainFromUrl(url: string): string | null {
  try {
    let host = new URL(url).hostname.toLowerCase();
    if (host.startsWith("www.")) host = host.slice(4);
    return host || null;
  } catch {
    return null;
  }
}

export function aggregateAnalysis(results: PromptResultInput[]): Aggregate {
  const tally = new Map<string, { displayName: string; mentions: number }>();
  let totalMentions = 0;
  let targetMentions = 0;

  for (const r of results) {
    targetMentions += r.targetMentions;
    for (const b of r.brands) {
      const key = normalizeKey(b.name);
      const existing = tally.get(key);
      if (existing) existing.mentions += b.mentions;
      else tally.set(key, { displayName: b.name, mentions: b.mentions });
      totalMentions += b.mentions;
    }
  }

  const score = totalMentions === 0 ? 0 : (targetMentions / totalMentions) * 100;

  const marketShare = Array.from(tally.values())
    .map((v) => ({
      name: v.displayName,
      mentions: v.mentions,
      percentage: totalMentions === 0 ? 0 : (v.mentions / totalMentions) * 100
    }))
    .sort((a, b) => b.mentions - a.mentions);

  const domainMap = new Map<string, Set<string>>();
  for (const r of results) {
    for (const c of r.citations) {
      const d = domainFromUrl(c.url);
      if (!d) continue;
      const urls = domainMap.get(d) ?? new Set<string>();
      urls.add(c.url);
      domainMap.set(d, urls);
    }
  }

  const citationDomains = Array.from(domainMap.entries())
    .map(([domain, urls]) => ({ domain, count: urls.size, urls: Array.from(urls) }))
    .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain));

  return {
    visibility: { score, targetMentions, totalMentions },
    marketShare,
    citationDomains
  };
}
