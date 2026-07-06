export interface PageMetadata {
  author?: string;
  publishedDate?: string;
  description?: string;
  generator?: string;
  ogImage?: string;
  hasJsonLdArticle: boolean;
}

/** A definitive AI fingerprint. Any single one short-circuits the verdict to "ai". */
export interface HardTell {
  id: string;
  label: string;
  detail: string;
}

export interface ExtractedContent {
  url: string;
  title: string;
  textContent: string;
  wordCount: number;
  headings: string[];
  paragraphs: string[];
  metadata: PageMetadata;
  hardTells: HardTell[];
  /** Base64 JPEG of the rendered page, captured when the browser fallback ran. */
  screenshot?: string;
  /**
   * First few KB of the raw HTML exactly as served. Hand-edit artifacts
   * (commented-out tags, inconsistent quoting) are human evidence the LLM
   * can weigh; a rendered-DOM serialization would normalize them away.
   */
  headHtml?: string;
}

export interface SignalResult {
  id: string;
  label: string;
  source: "heuristic" | "llm" | "fingerprint";
  /** Contribution weight toward the 0-100 heuristic score. 0 for LLM signals. */
  weight: number;
  /** 0 = not detected (human-leaning), 1 = fully detected (AI-leaning). */
  score: number;
  detail: string;
}

export type Verdict =
  | "human"
  | "likely-human"
  | "uncertain"
  | "likely-ai"
  | "ai";

export interface AnalysisReport {
  url: string;
  finalScore: number;
  verdict: Verdict;
  heuristicScore: number;
  llmScore?: number;
  usedLlm: boolean;
  signals: SignalResult[];
  llmReasoning?: string;
  wordCount: number;
  warnings: string[];
}

export type ErrorCode =
  | "INVALID_URL"
  | "BLOCKED_URL"
  | "FETCH_FAILED"
  | "TIMEOUT"
  | "NOT_HTML"
  | "BOT_BLOCKED"
  | "INSUFFICIENT_TEXT"
  | "INTERNAL";

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export interface LlmVerdict {
  aiProbability: number;
  signals: { name: string; description: string }[];
  reasoning: string;
}
