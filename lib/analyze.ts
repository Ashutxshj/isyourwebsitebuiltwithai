import { scrape } from "./scraper";
import { runHeuristics, heuristicScore } from "./heuristics";
import { analyzeWithLlm, llmAvailable } from "./llm";
import {
  AppError,
  type AnalysisReport,
  type ExtractedContent,
  type LlmVerdict,
  type SignalResult,
  type Verdict,
} from "./types";

/** LLM judgment dominates when available; heuristics keep it honest. */
const LLM_WEIGHT = 0.6;

/**
 * Verdict when a definitive AI fingerprint is present. No further analysis
 * (browser render, LLM call) is spent on the page.
 */
export function buildHardTellReport(content: ExtractedContent): AnalysisReport {
  const signals: SignalResult[] = content.hardTells.map((t) => ({
    id: t.id,
    label: t.label,
    source: "fingerprint",
    weight: 0,
    score: 1,
    detail: t.detail,
  }));

  return {
    url: content.url,
    finalScore: 98,
    verdict: "ai",
    heuristicScore: 98,
    usedLlm: false,
    signals,
    wordCount: content.wordCount,
    warnings: ["Definitive AI fingerprint found. Skipped deeper analysis."],
  };
}

export function toVerdict(score: number): Verdict {
  if (score < 20) return "human";
  if (score < 40) return "likely-human";
  if (score < 60) return "uncertain";
  if (score < 80) return "likely-ai";
  return "ai";
}

export function buildReport(
  content: ExtractedContent,
  llm: LlmVerdict | null,
  warnings: string[],
): AnalysisReport {
  const signals: SignalResult[] = runHeuristics(content);
  const hScore = heuristicScore(signals);

  if (llm) {
    for (const s of llm.signals) {
      signals.push({
        id: `llm-${s.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        label: s.name,
        source: "llm",
        weight: 0,
        score: 1,
        detail: s.description,
      });
    }
  }

  // Text-based heuristics are meaningless on near-empty pages; there the LLM
  // (reading the screenshot) carries the whole score.
  const llmWeight = content.wordCount < 100 ? 1 : LLM_WEIGHT;
  const finalScore = llm
    ? Math.round(hScore * (1 - llmWeight) + llm.aiProbability * llmWeight)
    : hScore;

  return {
    url: content.url,
    finalScore,
    verdict: toVerdict(finalScore),
    heuristicScore: hScore,
    llmScore: llm?.aiProbability,
    usedLlm: Boolean(llm),
    signals,
    llmReasoning: llm?.reasoning,
    wordCount: content.wordCount,
    warnings,
  };
}

export async function analyzeUrl(input: string): Promise<AnalysisReport> {
  const content = await scrape(input);

  if (content.hardTells.length > 0) {
    return buildHardTellReport(content);
  }

  const warnings: string[] = [];

  let llm: LlmVerdict | null = null;
  if (llmAvailable()) {
    try {
      llm = await analyzeWithLlm(content);
    } catch (err) {
      warnings.push(
        `LLM analysis failed (${err instanceof Error ? err.message : "unknown error"}); falling back to heuristics only.`,
      );
    }
  } else {
    warnings.push("GEMINI_API_KEY not set. Score is based on local heuristics only, which are less accurate.");
  }

  if (content.wordCount < 100) {
    if (!llm) {
      throw new AppError(
        "INSUFFICIENT_TEXT",
        `Only ${content.wordCount} words of readable text found, too little to analyze without an LLM. Set GEMINI_API_KEY to enable screenshot-based analysis.`,
      );
    }
    warnings.push(
      content.screenshot
        ? `Only ${content.wordCount} words of text. Verdict is based mainly on the LLM's reading of a page screenshot.`
        : `Only ${content.wordCount} words of text. Verdict is based on the LLM alone.`,
    );
  } else if (content.wordCount < 300) {
    warnings.push(`Only ${content.wordCount} words extracted. Short texts reduce detection confidence.`);
  }

  return buildReport(content, llm, warnings);
}
