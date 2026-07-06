import { describe, expect, it } from "vitest";
import { buildReport, toVerdict } from "@/lib/analyze";
import type { ExtractedContent } from "@/lib/types";

const CONTENT: ExtractedContent = {
  url: "https://example.com/post",
  title: "Test",
  textContent: "word ".repeat(500).trim(),
  wordCount: 500,
  headings: [],
  paragraphs: [],
  metadata: { author: "Jane", publishedDate: "2024-01-01", hasJsonLdArticle: true },
  hardTells: [],
};

describe("toVerdict", () => {
  it("maps score bands to verdicts", () => {
    expect(toVerdict(0)).toBe("human");
    expect(toVerdict(19)).toBe("human");
    expect(toVerdict(20)).toBe("likely-human");
    expect(toVerdict(39)).toBe("likely-human");
    expect(toVerdict(40)).toBe("uncertain");
    expect(toVerdict(59)).toBe("uncertain");
    expect(toVerdict(60)).toBe("likely-ai");
    expect(toVerdict(79)).toBe("likely-ai");
    expect(toVerdict(80)).toBe("ai");
    expect(toVerdict(100)).toBe("ai");
  });
});

describe("buildReport", () => {
  it("uses heuristics alone when no LLM verdict is provided", () => {
    const report = buildReport(CONTENT, null, ["no key"]);
    expect(report.usedLlm).toBe(false);
    expect(report.llmScore).toBeUndefined();
    expect(report.finalScore).toBe(report.heuristicScore);
    expect(report.warnings).toEqual(["no key"]);
  });

  it("blends heuristic and LLM scores 40/60", () => {
    const report = buildReport(
      CONTENT,
      { aiProbability: 90, signals: [], reasoning: "very templated" },
      [],
    );
    expect(report.usedLlm).toBe(true);
    expect(report.llmScore).toBe(90);
    expect(report.finalScore).toBe(Math.round(report.heuristicScore * 0.4 + 90 * 0.6));
    expect(report.llmReasoning).toBe("very templated");
  });

  it("appends LLM signals with zero weight", () => {
    const report = buildReport(
      CONTENT,
      {
        aiProbability: 75,
        signals: [{ name: "Stock transitions", description: "Heavy use of 'moreover'." }],
        reasoning: "r",
      },
      [],
    );
    const llmSignal = report.signals.find((s) => s.source === "llm");
    expect(llmSignal).toBeDefined();
    expect(llmSignal!.weight).toBe(0);
    expect(llmSignal!.label).toBe("Stock transitions");
    // LLM signals must not affect the heuristic score.
    expect(report.heuristicScore).toBe(buildReport(CONTENT, null, []).heuristicScore);
  });

  it("gives the LLM full weight when text is too thin for heuristics", () => {
    const thin = { ...CONTENT, textContent: "word ".repeat(50).trim(), wordCount: 50 };
    const report = buildReport(thin, { aiProbability: 88, signals: [], reasoning: "" }, []);
    expect(report.finalScore).toBe(88);
  });

  it("keeps verdict consistent with final score", () => {
    const report = buildReport(CONTENT, { aiProbability: 100, signals: [], reasoning: "" }, []);
    expect(report.verdict).toBe(toVerdict(report.finalScore));
  });
});
