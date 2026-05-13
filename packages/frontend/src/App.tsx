import { useState, FormEvent } from "react";
import { ChevronRight, ChevronDown, Info, Sparkles, RefreshCw } from "lucide-react";
import { PieChart, Pie, ResponsiveContainer } from "recharts";

type Stage =
  | "awareness"
  | "consideration"
  | "decision"
  | "problem-focused"
  | "solution-focused";

type Prompt = { stage: Stage; prompt: string };
type Brand = { name: string; description: string };
type Citation = { url: string; title: string };
type BrandMention = { name: string; mentions: number };

type LlmName = "gemini" | "openai";

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

type Aggregate = {
  visibility: { score: number; targetMentions: number; totalMentions: number };
  marketShare: { name: string; mentions: number; percentage: number }[];
  citationDomains: { domain: string; count: number; urls: string[] }[];
};

type AnalyzeResponse = {
  url: string;
  brand: Brand;
  prompts: Prompt[];
  promptResults: PromptResult[];
  aggregate: Aggregate;
  cached: boolean;
};

const PALETTE = ["#F97316", "#6366F1", "#A5B4FC", "#8B5CF6", "#C7D2FE", "#FB923C", "#818CF8"];
const TARGET_COLOR = "#F97316";

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function colorFor(name: string, isTarget = false): string {
  if (isTarget) return TARGET_COLOR;
  return PALETTE[hashCode(name.toLowerCase()) % PALETTE.length];
}

function normalizeUrl(input: string): string {
  try {
    const trimmed = input.trim();
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const u = new URL(withScheme);
    const hostname = u.hostname.toLowerCase();
    if (!hostname.includes(".")) throw new Error("missing TLD");
    return `https://${hostname}`;
  } catch {
    throw new Error("Please enter a valid URL");
  }
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function callAnalyzer(
  url: string,
  handler: "analyze" | "refresh"
): Promise<AnalyzeResponse> {
  const canonical = normalizeUrl(url);
  const key = await sha256Hex(canonical);
  const res = await fetch(`/restate/Analyzer/${key}/${handler}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: canonical })
  });
  if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
  return (await res.json()) as AnalyzeResponse;
}

function isTargetBrand(name: string, target: string): boolean {
  return name.trim().toLowerCase() === target.trim().toLowerCase();
}

function promptVisibility(r: PromptResult): number {
  const total = r.combined.brands.reduce((s, b) => s + b.mentions, 0);
  if (total === 0) return 0;
  return (r.combined.targetMentions / total) * 100;
}

function mostVisibleBrand(r: PromptResult): string | null {
  if (r.combined.brands.length === 0) return null;
  return [...r.combined.brands].sort((a, b) => b.mentions - a.mentions)[0].name;
}

const LLM_LABELS: Record<LlmName, string> = {
  gemini: "Gemini",
  openai: "OpenAI"
};

function BrandAvatar({
  name,
  target,
  size = "sm"
}: {
  name: string;
  target?: string;
  size?: "sm" | "md";
}) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  const isTarget = target ? isTargetBrand(name, target) : false;
  const color = colorFor(name, isTarget);
  const dim = size === "md" ? "w-7 h-7 text-sm" : "w-6 h-6 text-xs";
  return (
    <div
      className={`${dim} rounded-full flex items-center justify-center text-white font-semibold shrink-0`}
      style={{ backgroundColor: color }}
    >
      {initial}
    </div>
  );
}

function LlmIcon({ llm }: { llm: LlmName }) {
  const cls =
    llm === "gemini"
      ? "bg-gradient-to-br from-blue-400 via-purple-500 to-pink-400"
      : "bg-gray-900";
  return (
    <div
      title={LLM_LABELS[llm]}
      className={`w-6 h-6 rounded-full ${cls} flex items-center justify-center text-white shrink-0`}
    >
      <Sparkles className="w-3 h-3" />
    </div>
  );
}

function VisibilityScoreCard({
  score,
  brand
}: {
  score: number;
  brand: Brand;
}) {
  return (
    <div className="border border-gray-200 rounded-xl bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-400 via-purple-500 to-pink-400 flex items-center justify-center text-white">
          <Sparkles className="w-3.5 h-3.5" />
        </div>
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
          Visibility Score
        </span>
        <Info className="w-4 h-4 text-gray-300" />
      </div>
      <div className="flex items-baseline gap-3">
        <div className="text-5xl font-bold text-gray-900">{score.toFixed(0)}%</div>
        <div className="text-sm text-gray-500">{brand.name}</div>
      </div>
    </div>
  );
}

function PromptsTable({
  results,
  target
}: {
  results: PromptResult[];
  target: string;
}) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  return (
    <div className="border border-gray-200 rounded-xl bg-white overflow-hidden shadow-sm">
      <div className="grid grid-cols-[1fr_110px_140px_200px_36px] px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50 border-b border-gray-200">
        <div>Prompts</div>
        <div>Visibility</div>
        <div>Mentioned In</div>
        <div>Most Visible</div>
        <div></div>
      </div>
      {results.map((r, i) => {
        const v = promptVisibility(r);
        const mv = mostVisibleBrand(r);
        const open = openIdx === i;
        return (
          <div
            key={i}
            className={i === results.length - 1 ? "" : "border-b border-gray-100"}
          >
            <button
              type="button"
              onClick={() => setOpenIdx(open ? null : i)}
              className="w-full grid grid-cols-[1fr_110px_140px_200px_36px] px-5 py-4 items-center text-left hover:bg-gray-50 transition-colors"
            >
              <div className="text-sm text-gray-900 pr-4">{r.prompt}</div>
              <div className="text-sm font-medium text-gray-900">{v.toFixed(0)}%</div>
              <div className="flex items-center gap-1">
                {(["gemini", "openai"] as LlmName[]).map((llm) =>
                  r.responses[llm]?.targetMentioned ? (
                    <LlmIcon key={llm} llm={llm} />
                  ) : null
                )}
                {!r.responses.gemini?.targetMentioned &&
                  !r.responses.openai?.targetMentioned && (
                    <span className="text-gray-300">—</span>
                  )}
              </div>
              <div className="flex items-center gap-2 pr-2">
                {mv ? (
                  <>
                    <BrandAvatar name={mv} target={target} />
                    <span className="text-sm truncate">
                      {mv}
                      {isTargetBrand(mv, target) && (
                        <span className="text-gray-400"> (you)</span>
                      )}
                    </span>
                  </>
                ) : (
                  <span className="text-sm text-gray-400">—</span>
                )}
              </div>
              <div className="flex justify-end text-gray-400">
                {open ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronRight className="w-4 h-4" />
                )}
              </div>
            </button>
            {open && (
              <div className="px-5 pb-5 pt-3 bg-gray-50 border-t border-gray-100 space-y-4">
                {(["gemini", "openai"] as LlmName[]).map((llm) => {
                  const resp = r.responses[llm];
                  if (!resp) return null;
                  return (
                    <div key={llm} className="space-y-2">
                      <div className="flex items-center gap-2">
                        <LlmIcon llm={llm} />
                        <span className="text-sm font-medium text-gray-700">
                          {LLM_LABELS[llm]}
                        </span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
                            Brands mentioned
                          </div>
                          {resp.brands.length === 0 ? (
                            <div className="text-sm text-gray-500">none</div>
                          ) : (
                            <ul className="text-sm space-y-1">
                              {resp.brands.map((b) => (
                                <li
                                  key={b.name}
                                  className="flex items-center gap-2"
                                >
                                  <BrandAvatar name={b.name} target={target} />
                                  <span>
                                    {b.name} ({b.mentions})
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                        <div>
                          <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
                            Citations
                          </div>
                          {resp.citations.length === 0 ? (
                            <div className="text-sm text-gray-500">none</div>
                          ) : (
                            <ul className="text-sm space-y-1">
                              {resp.citations.map((c, j) => (
                                <li key={j} className="truncate">
                                  <a
                                    href={c.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-blue-600 hover:underline"
                                  >
                                    {c.title}
                                  </a>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function BrandsMentionedCard({
  marketShare,
  target
}: {
  marketShare: Aggregate["marketShare"];
  target: string;
}) {
  const top = marketShare.slice(0, 5);
  const rest = marketShare.slice(5);
  if (top.length === 0) {
    return (
      <div className="border border-gray-200 rounded-xl bg-white p-5 shadow-sm">
        <h3 className="text-base font-semibold text-gray-900 mb-3">Brands Mentioned</h3>
        <p className="text-sm text-gray-500">No brand mentions yet.</p>
      </div>
    );
  }
  const data: { name: string; value: number; fill: string }[] = top.map((b) => ({
    name: b.name,
    value: b.percentage,
    fill: colorFor(b.name, isTargetBrand(b.name, target))
  }));
  if (rest.length > 0) {
    const otherPct = rest.reduce((s, b) => s + b.percentage, 0);
    data.push({
      name: `Other (${rest.length})`,
      value: otherPct,
      fill: "#E5E7EB"
    });
  }
  return (
    <div className="border border-gray-200 rounded-xl bg-white p-5 shadow-sm">
      <h3 className="text-base font-semibold text-gray-900 mb-4">Brands Mentioned</h3>
      <div className="flex items-center gap-6">
        <div className="w-44 h-44 shrink-0">
          <ResponsiveContainer>
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                innerRadius={48}
                outerRadius={80}
                stroke="none"
                paddingAngle={1}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="space-y-2 text-sm flex-1 min-w-0">
          {data.map((b) => (
            <div key={b.name} className="flex items-center gap-2">
              <div
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: b.fill }}
              />
              <span className="truncate">
                {b.name}{" "}
                <span className="text-gray-500">({b.value.toFixed(0)}%)</span>
                {isTargetBrand(b.name, target) && (
                  <span className="text-gray-400"> (you)</span>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);

  async function run(handler: "analyze" | "refresh", e?: FormEvent) {
    e?.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = await callAnalyzer(url, handler);
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="max-w-6xl mx-auto px-4 py-8 space-y-5">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold text-gray-900">blginc</h1>
          <p className="text-sm text-gray-500">
            See how your brand shows up in AI assistants' answers.
          </p>
        </header>

        <form onSubmit={(e) => run("analyze", e)} className="flex gap-2">
          <input
            type="text"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="example.com or https://example.com"
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <button
            type="submit"
            disabled={loading || !url}
            className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Working…" : "Analyze"}
          </button>
        </form>

        {error && (
          <div className="border border-red-200 bg-red-50 text-red-700 rounded-lg px-4 py-3 text-sm">
            {error}
          </div>
        )}

        {result && (
          <>
            <div className="flex items-center justify-between text-sm text-gray-500">
              <div>
                <span className="font-medium text-gray-700">{result.brand.name}</span>{" "}
                · {result.url} · {result.cached ? "cached" : "fresh"}
              </div>
              <button
                type="button"
                onClick={() => run("refresh")}
                disabled={loading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-white disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
                Re-analyze
              </button>
            </div>

            <VisibilityScoreCard
              score={result.aggregate.visibility.score}
              brand={result.brand}
            />

            <PromptsTable results={result.promptResults} target={result.brand.name} />

            <BrandsMentionedCard
              marketShare={result.aggregate.marketShare}
              target={result.brand.name}
            />

          </>
        )}
      </main>
    </div>
  );
}
