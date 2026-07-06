import { describe, expect, it } from "vitest";
import { runHeuristics, heuristicScore } from "@/lib/heuristics";
import type { ExtractedContent } from "@/lib/types";

function makeContent(overrides: Partial<ExtractedContent> = {}): ExtractedContent {
  const paragraphs = overrides.paragraphs ?? [];
  const textContent = overrides.textContent ?? paragraphs.join(" ");
  return {
    url: "https://example.com/post",
    title: "Test",
    textContent,
    wordCount: textContent ? textContent.split(/\s+/).length : 0,
    headings: [],
    paragraphs,
    metadata: { hasJsonLdArticle: false },
    hardTells: [],
    ...overrides,
    ...(overrides.wordCount === undefined && textContent
      ? { wordCount: textContent.split(/\s+/).length }
      : {}),
  };
}

// Stereotypical LLM output: stock phrases, uniform sentences, formulaic headings.
const AI_TEXT = Array.from({ length: 12 }, () =>
  [
    "In today's fast-paced world, it's important to note that businesses must leverage cutting-edge solutions to stay ahead.",
    "Moreover, embracing a holistic approach can unlock the potential of your organization and elevate your brand seamlessly.",
    "Furthermore, navigating the complexities of the ever-evolving landscape requires a comprehensive guide and a robust strategy.",
    "Additionally, this treasure trove of insights serves as a testament to the crucial role of innovation in the realm of digital marketing.",
  ].join(" "),
).join(" ");

// Human-ish prose: varied rhythm, personal detail, no stock phrases.
const HUMAN_TEXT = `I killed my first three tomato plants. Dead. Not from neglect — I watered them obsessively, which it turns out was exactly the problem. My neighbor Rosa, who has been gardening this same clay-heavy plot since 1987, finally took pity on me one July morning. "You're drowning them," she said, poking a finger into the soggy soil. She was right. That summer I learned to check moisture two knuckles deep before reaching for the hose, and to stop fussing. The plants did better the moment I got lazier. There's a lesson in that somewhere, though I resisted it for years because doing nothing feels wrong when leaves start curling. Last August we picked forty pounds of Cherokee Purples off four plants. Rosa says the ugly ones taste best. She's right about that too, and about most things, honestly. The cracked, lopsided fruit that would never survive a supermarket loading dock beats anything in the store. My kids eat them off the vine like apples now, salt shaker in hand, standing barefoot in the dirt.`;

describe("runHeuristics", () => {
  it("scores stereotypical AI text high", () => {
    const content = makeContent({
      textContent: AI_TEXT,
      paragraphs: AI_TEXT.match(/.{1,400}(?:\s|$)/g) ?? [],
      headings: [
        "Understanding the Digital Landscape",
        "Why Innovation Matters",
        "How to Leverage AI",
        "Key Takeaways",
        "Conclusion",
      ],
    });
    const signals = runHeuristics(content);
    const score = heuristicScore(signals);

    expect(signals.find((s) => s.id === "ai-phrases")!.score).toBeGreaterThan(0.8);
    expect(signals.find((s) => s.id === "missing-author")!.score).toBe(1);
    expect(score).toBeGreaterThan(60);
  });

  it("scores human text with good metadata low", () => {
    const content = makeContent({
      textContent: HUMAN_TEXT,
      paragraphs: HUMAN_TEXT.split(". ").reduce<string[]>((acc, s, i) => {
        const idx = Math.floor(i / 3);
        acc[idx] = (acc[idx] ?? "") + s + ". ";
        return acc;
      }, []),
      headings: ["My tomato disaster"],
      metadata: {
        author: "Jane Doe",
        publishedDate: "2023-08-14",
        hasJsonLdArticle: true,
      },
    });
    const signals = runHeuristics(content);
    const score = heuristicScore(signals);

    expect(signals.find((s) => s.id === "ai-phrases")!.score).toBeLessThan(0.2);
    expect(signals.find((s) => s.id === "missing-author")!.score).toBe(0);
    expect(signals.find((s) => s.id === "missing-date")!.score).toBe(0);
    expect(score).toBeLessThan(35);
  });

  it("flags known AI site builders via the generator tag", () => {
    const content = makeContent({
      textContent: HUMAN_TEXT,
      metadata: { generator: "Durable AI Site Builder", hasJsonLdArticle: false },
    });
    expect(runHeuristics(content).find((s) => s.id === "ai-generator")!.score).toBe(1);
  });

  it("does not flag normal generators", () => {
    const content = makeContent({
      textContent: HUMAN_TEXT,
      metadata: { generator: "WordPress 6.4", hasJsonLdArticle: false },
    });
    expect(runHeuristics(content).find((s) => s.id === "ai-generator")!.score).toBe(0);
  });

  it("uses weights that sum to 100", () => {
    const signals = runHeuristics(makeContent({ textContent: HUMAN_TEXT }));
    expect(signals.reduce((sum, s) => sum + s.weight, 0)).toBe(100);
  });

  it("handles empty content without NaN", () => {
    const signals = runHeuristics(makeContent({ textContent: "", wordCount: 0 }));
    for (const s of signals) {
      expect(Number.isFinite(s.score)).toBe(true);
    }
    expect(Number.isFinite(heuristicScore(signals))).toBe(true);
  });
});
