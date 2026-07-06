"use client";

import { useState } from "react";
import type { AnalysisReport, Verdict } from "@/lib/types";

const VERDICT_LABELS: Record<Verdict, string> = {
  human: "Human-written",
  "likely-human": "Likely human",
  uncertain: "Uncertain",
  "likely-ai": "Likely AI",
  ai: "AI-generated",
};

const VERDICT_COLORS: Record<Verdict, string> = {
  human: "text-green-500",
  "likely-human": "text-green-400",
  uncertain: "text-zinc-500",
  "likely-ai": "text-red-400",
  ai: "text-red-500",
};

export default function Home() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function analyze(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim() || loading) return;
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? "Analysis failed.");
      } else {
        setReport(data);
      }
    } catch {
      setError("Could not reach the analysis service.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-1 justify-center bg-white px-6 py-20 font-sans text-black dark:bg-black dark:text-zinc-100">
      <main className="w-full max-w-xl">
        <h1
          className="text-5xl uppercase leading-none tracking-tight"
          style={{ fontFamily: "var(--font-anton)" }}
        >
          AI Website
          <br />
          Detector
        </h1>
        <p className="mt-3 text-sm text-zinc-500">
          Paste a URL to estimate whether its content is AI-generated.
        </p>

        <form onSubmit={analyze} className="mt-10 flex gap-3">
          <input
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="example.com/article"
            className="h-11 flex-1 border-b border-zinc-300 bg-transparent outline-none placeholder:text-zinc-400 focus:border-black dark:border-zinc-700 dark:focus:border-zinc-100"
          />
          <button
            type="submit"
            disabled={loading}
            className="h-11 bg-black px-6 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-black"
          >
            {loading ? "Analyzing" : "Analyze"}
          </button>
        </form>

        {loading && <p className="mt-8 animate-pulse text-sm text-zinc-500">Fetching and scoring the page.</p>}

        {error && <p className="mt-8 text-sm text-red-600 dark:text-red-400">{error}</p>}

        {report && (
          <div className="mt-12">
            <div className="flex items-end justify-between">
              <span
                className="text-7xl leading-none"
                style={{ fontFamily: "var(--font-anton)" }}
              >
                {report.finalScore}
              </span>
              <span className={`text-sm uppercase tracking-wide ${VERDICT_COLORS[report.verdict]}`}>
                {VERDICT_LABELS[report.verdict]}
              </span>
            </div>

            <div className="mt-4 h-px w-full bg-zinc-200 dark:bg-zinc-800">
              <div className="h-px bg-black dark:bg-zinc-100" style={{ width: `${report.finalScore}%` }} />
            </div>

            <p className="mt-3 text-xs text-zinc-500">
              Heuristics {report.heuristicScore}/100
              {report.usedLlm && <> &middot; LLM {report.llmScore}/100</>}
              {" "}&middot; {report.wordCount.toLocaleString()} words
            </p>

            {report.warnings.map((w) => (
              <p key={w} className="mt-2 text-xs text-zinc-400">
                {w}
              </p>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
