import { describe, expect, it } from "vitest";
import { detectHardTells, scanAssetsForTells } from "@/lib/fingerprints";
import { buildHardTellReport } from "@/lib/analyze";
import { extractFromHtml } from "@/lib/scraper";

const AI_STUDIO_SHELL = `<!DOCTYPE html>
<html><head><title>Farm Shop</title>
<script>
  window.process = window.process || { env: { API_KEY: "" } };
</script>
<script src="https://cdn.tailwindcss.com"></script>
</head><body><div id="root"></div></body></html>`;

describe("detectHardTells", () => {
  it("detects the Google AI Studio export shim", () => {
    const tells = detectHardTells(AI_STUDIO_SHELL, "");
    expect(tells.map((t) => t.id)).toContain("google-ai-studio");
  });

  it("detects em dashes in body text as an instant tell", () => {
    const tells = detectHardTells("<html></html>", "Our snacks are healthy — and delicious — for everyone.");
    const emDash = tells.find((t) => t.id === "em-dash");
    expect(emDash).toBeDefined();
    expect(emDash!.detail).toContain("2 em dashes");
  });

  it("detects leftover chatbot phrases", () => {
    const tells = detectHardTells("<html></html>", "As an AI language model, I cannot browse the web.");
    expect(tells.map((t) => t.id)).toContain("chat-artifact");
  });

  it("detects Lovable and v0 artifacts", () => {
    expect(
      detectHardTells('<script src="https://cdn.gpteng.co/gptengineer.js"></script>', "").map((t) => t.id),
    ).toContain("lovable");
    expect(detectHardTells('<div data-v0-t="card"></div>', "").map((t) => t.id)).toContain("v0");
  });

  it("finds nothing on a clean page", () => {
    expect(detectHardTells("<html><body><p>Plain old hand-written site with hyphens - like this.</p></body></html>", "Plain old hand-written site with hyphens - like this.")).toEqual([]);
  });

  it("detects Lovable preview assets in og:image (roomtab case)", () => {
    const html = `<html><head><meta property="og:image" content="https://pub-abc.r2.dev/x/id-preview-8edf8d10--e27c1326.lovable.app-1780171350346.png"></head><body></body></html>`;
    expect(detectHardTells(html, "").map((t) => t.id)).toContain("lovable");
  });

  it("ignores em dashes used as title/meta separators (emofy case)", () => {
    const tells = detectHardTells(
      "<html></html>",
      "no dashes in body",
      "Emofy — Show social stats on Discord Server.\nEmofy — emofy.abku.dev",
    );
    expect(tells.find((t) => t.id === "em-dash")).toBeUndefined();
  });
});

describe("scanAssetsForTells", () => {
  it("finds builder markers inside bundles", () => {
    const bundle = 'var e="https://lovable.dev/projects/abc";export default e;';
    const tells = scanAssetsForTells([bundle]);
    expect(tells.map((t) => t.id)).toContain("lovable");
    expect(tells[0].detail).toContain("bundle");
  });

  it("returns nothing for clean bundles", () => {
    expect(scanAssetsForTells(['console.log("hello world - plain app");'])).toEqual([]);
  });
});

describe("hard-tell short-circuit", () => {
  it("extractFromHtml surfaces hard tells", () => {
    const content = extractFromHtml(AI_STUDIO_SHELL, "https://example.com");
    expect(content.hardTells.length).toBeGreaterThan(0);
  });

  it("extractFromHtml catches a roomtab-style SPA shell via meta tags", () => {
    const html = `<!DOCTYPE html><html><head>
      <title>roomTab — Part of the stay begins after check-in</title>
      <meta property="og:image" content="https://pub-abc.r2.dev/x/id-preview-8edf8d10--e27c1326.lovable.app-123.png">
      </head><body><div id="root"></div></body></html>`;
    const content = extractFromHtml(html, "https://roomtab.example");
    const ids = content.hardTells.map((t) => t.id);
    expect(ids).toContain("lovable");
  });

  it("buildHardTellReport returns an immediate ai verdict without the LLM", () => {
    const content = extractFromHtml(AI_STUDIO_SHELL, "https://example.com");
    const report = buildHardTellReport(content);
    expect(report.verdict).toBe("ai");
    expect(report.finalScore).toBeGreaterThanOrEqual(80);
    expect(report.usedLlm).toBe(false);
    expect(report.signals.every((s) => s.source === "fingerprint")).toBe(true);
    expect(report.warnings[0]).toContain("Skipped deeper analysis");
  });
});
