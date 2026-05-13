import { useState, FormEvent } from "react";

type Stage =
  | "awareness"
  | "consideration"
  | "decision"
  | "problem-focused"
  | "solution-focused";

type Prompt = { stage: Stage; prompt: string };

type AnalyzeResponse = { url: string; prompts: Prompt[]; cached: boolean };

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
        maxWidth: 720,
        margin: "2rem auto",
        padding: "0 1rem"
      }}
    >
      <h1>blginc</h1>
      <p>Analyze how your website appears in ChatGPT and Gemini.</p>

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
        <section>
          <h2 style={{ marginBottom: "0.25rem" }}>
            Generated prompts for {result.url}
          </h2>
          <p style={{ color: "#666", marginTop: 0, fontSize: "0.9rem" }}>
            {result.cached ? "Showing cached result." : "Fresh analysis."}{" "}
            <button
              type="button"
              onClick={() => run("refresh")}
              disabled={loading}
              style={{ marginLeft: "0.5rem" }}
            >
              {loading ? "Re-analyzing…" : "Re-analyze"}
            </button>
          </p>
          <ul>
            {result.prompts.map((p, i) => (
              <li key={i} style={{ marginBottom: "0.5rem" }}>
                <strong>{p.stage}:</strong> {p.prompt}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
