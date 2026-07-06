import type { ExtractedContent, SignalResult } from "./types";

/**
 * Phrases and words that appear at far higher rates in LLM output than in
 * human prose. Matched case-insensitively against whole words/phrases.
 */
const AI_PHRASES = [
  "delve",
  "delves",
  "delving",
  "tapestry",
  "in today's fast-paced world",
  "in today's digital age",
  "in the ever-evolving",
  "ever-evolving landscape",
  "navigate the complexities",
  "navigating the complexities",
  "it's important to note",
  "it is important to note",
  "it's worth noting",
  "in conclusion",
  "unlock the potential",
  "unleash",
  "elevate your",
  "game-changer",
  "game changer",
  "treasure trove",
  "testament to",
  "seamlessly",
  "revolutionize",
  "whether you're a",
  "look no further",
  "dive deep",
  "deep dive into",
  "harness the power",
  "embark on a journey",
  "a myriad of",
  "plethora",
  "furthermore",
  "moreover",
  "additionally",
  "crucial role",
  "pivotal role",
  "comprehensive guide",
  "key takeaways",
  "at the end of the day",
  "when it comes to",
  "realm of",
  "landscape of",
  "world of possibilities",
  "cutting-edge",
  "robust",
  "holistic",
  "synergy",
  "paradigm",
  "foster",
  "leverage",
  "leveraging",
];

const AI_SITE_GENERATORS = /durable|10web|hostinger ai|wix adi|framer ai|b12|jimdo dolphin|zyro ai|mixo|gamma/i;

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Coefficient of variation (stddev / mean); 0 when there's nothing to measure. */
function coefficientOfVariation(values: number[]): number {
  if (values.length < 3) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return 0;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

function countAiPhrases(text: string): { hits: number; matched: string[] } {
  const lower = text.toLowerCase();
  let hits = 0;
  const matched: string[] = [];
  for (const phrase of AI_PHRASES) {
    const re = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
    const count = (lower.match(re) ?? []).length;
    if (count > 0) {
      hits += count;
      matched.push(phrase);
    }
  }
  return { hits, matched };
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.split(/\s+/).length >= 3);
}

/**
 * Run all local heuristic signals. Weights sum to 100, so the weighted sum of
 * scores is directly a 0-100 "AI probability" from heuristics alone.
 */
export function runHeuristics(content: ExtractedContent): SignalResult[] {
  const signals: SignalResult[] = [];
  const { textContent, wordCount, paragraphs, headings, metadata } = content;

  // 1. AI stock phrases (weight 25)
  const { hits, matched } = countAiPhrases(textContent);
  const hitsPer1000 = wordCount > 0 ? (hits / wordCount) * 1000 : 0;
  // ~2 hits per 1000 words is normal prose; 10+ is a strong AI tell.
  const phraseScore = clamp01((hitsPer1000 - 2) / 8);
  signals.push({
    id: "ai-phrases",
    label: "AI stock phrases",
    source: "heuristic",
    weight: 25,
    score: phraseScore,
    detail:
      hits === 0
        ? "No common AI phrases found."
        : `${hits} hit(s) (${hitsPer1000.toFixed(1)}/1000 words): ${matched.slice(0, 8).join(", ")}${matched.length > 8 ? ", …" : ""}`,
  });

  // 2. Sentence length uniformity — low "burstiness" (weight 15)
  const sentenceLengths = splitSentences(textContent).map((s) => s.split(/\s+/).length);
  const sentenceCv = coefficientOfVariation(sentenceLengths);
  // Human prose CV is typically 0.55-0.9; LLM output clusters near 0.3-0.45.
  const sentenceScore = sentenceLengths.length < 5 ? 0 : clamp01((0.55 - sentenceCv) / 0.3);
  signals.push({
    id: "sentence-uniformity",
    label: "Sentence length uniformity",
    source: "heuristic",
    weight: 15,
    score: sentenceScore,
    detail:
      sentenceLengths.length < 5
        ? "Too few sentences to measure."
        : `Variation coefficient ${sentenceCv.toFixed(2)} across ${sentenceLengths.length} sentences (lower = more machine-like).`,
  });

  // 3. Paragraph length uniformity (weight 10)
  const paragraphLengths = paragraphs.map((p) => p.split(/\s+/).length);
  const paragraphCv = coefficientOfVariation(paragraphLengths);
  const paragraphScore = paragraphLengths.length < 4 ? 0 : clamp01((0.5 - paragraphCv) / 0.3);
  signals.push({
    id: "paragraph-uniformity",
    label: "Paragraph length uniformity",
    source: "heuristic",
    weight: 10,
    score: paragraphScore,
    detail:
      paragraphLengths.length < 4
        ? "Too few paragraphs to measure."
        : `Variation coefficient ${paragraphCv.toFixed(2)} across ${paragraphLengths.length} paragraphs.`,
  });

  // 4. Formulaic heading structure (weight 10)
  const headingsPer500 = wordCount > 0 ? (headings.length / wordCount) * 500 : 0;
  const formulaicHeadings = headings.filter((h) =>
    /^(how|why|what|top \d|best \d|\d+\.|the ultimate|a guide|understanding|exploring|conclusion|final thoughts|key takeaways|faq)/i.test(h),
  ).length;
  const headingScore = clamp01(
    (headingsPer500 > 3 ? 0.5 : headingsPer500 / 6) +
      (headings.length > 0 ? (formulaicHeadings / headings.length) * 0.5 : 0),
  );
  signals.push({
    id: "heading-structure",
    label: "Formulaic heading structure",
    source: "heuristic",
    weight: 10,
    score: headingScore,
    detail: `${headings.length} heading(s), ${formulaicHeadings} formulaic (${headingsPer500.toFixed(1)} per 500 words).`,
  });

  // 5. Missing author (weight 15)
  const hasAuthor = Boolean(metadata.author && metadata.author.length > 1);
  signals.push({
    id: "missing-author",
    label: "Author attribution",
    source: "heuristic",
    weight: 15,
    score: hasAuthor ? 0 : 1,
    detail: hasAuthor ? `Author found: ${metadata.author}` : "No author metadata or byline found.",
  });

  // 6. Missing publication date (weight 10)
  const hasDate = Boolean(metadata.publishedDate);
  signals.push({
    id: "missing-date",
    label: "Publication date",
    source: "heuristic",
    weight: 10,
    score: hasDate ? 0 : 1,
    detail: hasDate ? `Published: ${metadata.publishedDate}` : "No publication date found.",
  });

  // 7. Known AI site builder (weight 10)
  const aiGenerator = Boolean(metadata.generator && AI_SITE_GENERATORS.test(metadata.generator));
  signals.push({
    id: "ai-generator",
    label: "AI site builder fingerprint",
    source: "heuristic",
    weight: 10,
    score: aiGenerator ? 1 : 0,
    detail: aiGenerator
      ? `Generator meta tag matches a known AI site builder: ${metadata.generator}`
      : metadata.generator
        ? `Generator: ${metadata.generator} (not a known AI builder).`
        : "No generator meta tag.",
  });

  // 8. Structured article markup (weight 5) — content farms often skip JSON-LD.
  signals.push({
    id: "no-jsonld",
    label: "Structured article markup",
    source: "heuristic",
    weight: 5,
    score: metadata.hasJsonLdArticle ? 0 : 1,
    detail: metadata.hasJsonLdArticle
      ? "JSON-LD Article schema present."
      : "No JSON-LD Article schema found.",
  });

  return signals;
}

/** Weighted 0-100 score from heuristic signals. */
export function heuristicScore(signals: SignalResult[]): number {
  const total = signals
    .filter((s) => s.source === "heuristic")
    .reduce((sum, s) => sum + s.weight * s.score, 0);
  return Math.round(clamp01(total / 100) * 100);
}
