import { useState, FormEvent } from "react";

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

type PromptResult = Prompt & {
  answer: string;
  citations: Citation[];
  searchQueries: string[];
  brands: BrandMention[];
  targetMentioned: boolean;
  targetMentions: number;
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

const cardStyle: React.CSSProperties = {
  border: "1px solid #e5e5e5",
  borderRadius: 8,
  padding: "1rem",
  marginTop: "1rem",
  background: "#fafafa"
};

function BrandBanner({
  brand,
  url,
  cached,
  loading,
  onRefresh
}: {
  brand: Brand;
  url: string;
  cached: boolean;
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <section style={cardStyle}>
      <h2 style={{ margin: 0 }}>{brand.name}</h2>
      <p style={{ margin: "0.25rem 0 0.5rem", color: "#444" }}>{brand.description}</p>
      <p style={{ margin: 0, fontSize: "0.85rem", color: "#666" }}>
        {url} · {cached ? "cached result" : "fresh analysis"}{" "}
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          style={{ marginLeft: "0.5rem" }}
        >
          {loading ? "Re-analyzing…" : "Re-analyze"}
        </button>
      </p>
    </section>
  );
}

function VisibilityCard({ v }: { v: Aggregate["visibility"] }) {
  return (
    <section style={cardStyle}>
      <h3 style={{ marginTop: 0 }}>Visibility score</h3>
      <p style={{ fontSize: "2.5rem", margin: 0, fontWeight: 600 }}>
        {v.score.toFixed(1)}%
      </p>
      <p style={{ margin: "0.25rem 0 0", color: "#666", fontSize: "0.9rem" }}>
        {v.targetMentions} mention{v.targetMentions === 1 ? "" : "s"} of your brand out of{" "}
        {v.totalMentions} total brand mention{v.totalMentions === 1 ? "" : "s"} across all
        prompts (share of voice).
      </p>
    </section>
  );
}

function MarketShareTable({
  items,
  target
}: {
  items: Aggregate["marketShare"];
  target: string;
}) {
  if (items.length === 0) {
    return (
      <section style={cardStyle}>
        <h3 style={{ marginTop: 0 }}>Market share</h3>
        <p style={{ color: "#666" }}>No brands mentioned in any answers.</p>
      </section>
    );
  }
  const targetKey = target.trim().toLowerCase();
  return (
    <section style={cardStyle}>
      <h3 style={{ marginTop: 0 }}>Market share</h3>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
            <th style={{ padding: "0.4rem 0.25rem" }}>Brand</th>
            <th style={{ padding: "0.4rem 0.25rem", textAlign: "right" }}>Mentions</th>
            <th style={{ padding: "0.4rem 0.25rem", textAlign: "right" }}>Share</th>
          </tr>
        </thead>
        <tbody>
          {items.map((b) => {
            const isTarget = b.name.trim().toLowerCase() === targetKey;
            return (
              <tr
                key={b.name}
                style={{
                  borderBottom: "1px solid #eee",
                  fontWeight: isTarget ? 600 : 400,
                  background: isTarget ? "#fff8e1" : undefined
                }}
              >
                <td style={{ padding: "0.4rem 0.25rem" }}>
                  {b.name}
                  {isTarget && (
                    <span style={{ color: "#888", fontWeight: 400 }}> (you)</span>
                  )}
                </td>
                <td style={{ padding: "0.4rem 0.25rem", textAlign: "right" }}>
                  {b.mentions}
                </td>
                <td style={{ padding: "0.4rem 0.25rem", textAlign: "right" }}>
                  {b.percentage.toFixed(1)}%
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function CitationDomains({ items }: { items: Aggregate["citationDomains"] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (domain: string) => {
    const next = new Set(expanded);
    if (next.has(domain)) next.delete(domain);
    else next.add(domain);
    setExpanded(next);
  };
  if (items.length === 0) {
    return (
      <section style={cardStyle}>
        <h3 style={{ marginTop: 0 }}>Citation sources</h3>
        <p style={{ color: "#666" }}>Gemini didn't cite any sources for these prompts.</p>
      </section>
    );
  }
  return (
    <section style={cardStyle}>
      <h3 style={{ marginTop: 0 }}>Citation sources</h3>
      <p style={{ margin: "0 0 0.5rem", color: "#666", fontSize: "0.9rem" }}>
        Domains Gemini cited across all prompts. Click to expand URLs.
      </p>
      <ul style={{ paddingLeft: "1.25rem", margin: 0 }}>
        {items.map((d) => (
          <li key={d.domain} style={{ marginBottom: "0.25rem" }}>
            <button
              type="button"
              onClick={() => toggle(d.domain)}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                color: "#0366d6",
                textDecoration: "underline"
              }}
            >
              {d.domain} ({d.count})
            </button>
            {expanded.has(d.domain) && (
              <ul style={{ paddingLeft: "1.25rem", margin: "0.25rem 0" }}>
                {d.urls.map((u) => (
                  <li key={u} style={{ wordBreak: "break-all", fontSize: "0.85rem" }}>
                    <a href={u} target="_blank" rel="noreferrer">
                      {u}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function PromptDrillDown({ results }: { results: PromptResult[] }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  return (
    <section style={cardStyle}>
      <h3 style={{ marginTop: 0 }}>Per-prompt detail</h3>
      {results.map((r, i) => (
        <div
          key={i}
          style={{
            borderBottom: i === results.length - 1 ? "none" : "1px solid #eee",
            padding: "0.5rem 0"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <button
              type="button"
              onClick={() => setOpenIdx(openIdx === i ? null : i)}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                fontSize: "1rem"
              }}
              aria-label="toggle"
            >
              {openIdx === i ? "▾" : "▸"}
            </button>
            <span
              style={{
                fontSize: "0.75rem",
                color: "#666",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                minWidth: 130
              }}
            >
              {r.stage}
            </span>
            <span style={{ flex: 1 }}>{r.prompt}</span>
            <span
              style={{
                fontSize: "0.8rem",
                color: r.targetMentioned ? "#1a7f37" : "#888"
              }}
            >
              {r.targetMentioned ? "✓ you" : "✗ not cited"}
            </span>
          </div>
          {openIdx === i && (
            <div style={{ padding: "0.5rem 0 0 1.5rem", fontSize: "0.9rem" }}>
              <details open>
                <summary style={{ cursor: "pointer", color: "#666" }}>Answer</summary>
                <pre
                  style={{
                    whiteSpace: "pre-wrap",
                    background: "#fff",
                    padding: "0.5rem",
                    border: "1px solid #eee",
                    borderRadius: 4,
                    margin: "0.25rem 0"
                  }}
                >
                  {r.answer || "(empty)"}
                </pre>
              </details>
              <div style={{ marginTop: "0.5rem" }}>
                <strong>Brands mentioned:</strong>{" "}
                {r.brands.length === 0
                  ? "none"
                  : r.brands.map((b) => `${b.name} (${b.mentions})`).join(", ")}
              </div>
              <div style={{ marginTop: "0.25rem" }}>
                <strong>Citations:</strong>
                {r.citations.length === 0 ? (
                  " none"
                ) : (
                  <ul style={{ margin: "0.25rem 0", paddingLeft: "1.25rem" }}>
                    {r.citations.map((c, j) => (
                      <li key={j} style={{ wordBreak: "break-all" }}>
                        <a href={c.url} target="_blank" rel="noreferrer">
                          {c.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {r.searchQueries.length > 0 && (
                <div style={{ marginTop: "0.25rem", color: "#666", fontSize: "0.8rem" }}>
                  Gemini searched: {r.searchQueries.join(", ")}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </section>
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
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: 880,
        margin: "2rem auto",
        padding: "0 1rem"
      }}
    >
      <h1>blginc</h1>
      <p>Analyze how your website appears in Gemini (ChatGPT support coming).</p>

      <form onSubmit={(e) => run("analyze", e)}>
        <input
          type="text"
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="example.com or https://example.com"
          style={{ width: "100%", padding: "0.5rem", fontSize: "1rem", boxSizing: "border-box" }}
        />
        <button
          type="submit"
          disabled={loading || !url}
          style={{ marginTop: "0.5rem", padding: "0.5rem 1rem" }}
        >
          {loading ? "Working…" : "Analyze"}
        </button>
      </form>

      {error && <p style={{ color: "crimson" }}>{error}</p>}

      {result && (
        <>
          <BrandBanner
            brand={result.brand}
            url={result.url}
            cached={result.cached}
            loading={loading}
            onRefresh={() => run("refresh")}
          />
          <VisibilityCard v={result.aggregate.visibility} />
          <MarketShareTable items={result.aggregate.marketShare} target={result.brand.name} />
          <CitationDomains items={result.aggregate.citationDomains} />
          <PromptDrillDown results={result.promptResults} />
        </>
      )}
    </main>
  );
}
