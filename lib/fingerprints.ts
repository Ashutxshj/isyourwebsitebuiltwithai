import type { HardTell } from "./types";

/**
 * Fingerprints left in raw HTML (and shipped JS/CSS bundles) by AI site
 * builders and one-shot LLM exports. Any match is treated as proof of AI
 * generation and ends the analysis.
 */
const HTML_FINGERPRINTS: { id: string; label: string; pattern: RegExp; detail: string }[] = [
  {
    id: "google-ai-studio",
    label: "Google AI Studio export",
    pattern: /window\.process\s*=\s*window\.process\s*\|\|\s*\{\s*env:\s*\{\s*API_KEY/i,
    detail: "Contains the window.process API_KEY shim that Google AI Studio injects into exported apps.",
  },
  {
    id: "genai-sdk",
    label: "Gemini SDK in the browser",
    pattern: /esm\.sh\/@google\/genai|@google\/genai/i,
    detail: "Loads the @google/genai SDK client-side, typical of AI Studio generated apps.",
  },
  {
    id: "lovable",
    label: "Lovable / GPT Engineer",
    pattern: /lovable\.(dev|app)|cdn\.gpteng\.co|lovable-badge|gptengineer|id-preview-[0-9a-f]+--/i,
    detail: "Contains Lovable (GPT Engineer) build artifacts, such as lovable.app preview assets.",
  },
  {
    id: "v0",
    label: "Vercel v0",
    pattern: /\bv0\.dev\b|data-v0-t/i,
    detail: "Contains Vercel v0 build artifacts.",
  },
  {
    id: "bolt",
    label: "Bolt.new",
    pattern: /bolt\.new/i,
    detail: "Contains Bolt.new build artifacts.",
  },
  {
    id: "base44",
    label: "Base44",
    pattern: /base44\.(app|com)|\bbase44\b/i,
    detail: "Contains Base44 build artifacts.",
  },
  {
    id: "ai-app-builder",
    label: "AI app builder",
    pattern: /same\.new|create\.xyz|emergent\.sh|app\.build|replit-badge|\.replit\.app/i,
    detail: "Contains artifacts from an AI app builder (Same, Create, Emergent, app.build, or Replit).",
  },
  {
    id: "ai-builder-meta",
    label: "AI site builder generator tag",
    pattern: /<meta[^>]+generator[^>]+content=["'][^"']*(durable|10web|mixo|gamma|hostinger ai|framer ai|b12|zyro)/i,
    detail: "The generator meta tag names a known AI website builder.",
  },
];

const TEXT_FINGERPRINTS: { id: string; label: string; pattern: RegExp; detail: string }[] = [
  {
    id: "chat-artifact",
    label: "Leftover chatbot text",
    pattern: /\bas an ai (language )?model\b|certainly! here('s| is)|i hope this helps/i,
    detail: "The page text contains leftover LLM chat phrases.",
  },
];

function countEmDashes(text: string): number {
  return (text.match(/—/g) ?? []).length;
}

/**
 * @param html raw page HTML, scanned for builder artifacts
 * @param visibleText extracted readable body text
 * @param metaText title, meta descriptions, og/twitter copy, and headings;
 *   scanned for chat artifacts only (em dashes there are just separators)
 */
export function detectHardTells(html: string, visibleText: string, metaText = ""): HardTell[] {
  const tells: HardTell[] = [];

  for (const fp of HTML_FINGERPRINTS) {
    if (fp.pattern.test(html)) {
      tells.push({ id: fp.id, label: fp.label, detail: fp.detail });
    }
  }

  for (const fp of TEXT_FINGERPRINTS) {
    if (fp.pattern.test(visibleText) || fp.pattern.test(metaText)) {
      tells.push({ id: fp.id, label: fp.label, detail: fp.detail });
    }
  }

  // Em dashes in body prose: humans writing casual web copy type hyphens;
  // LLM output is riddled with true em dashes (U+2014). Deliberately limited
  // to body text: "Brand — tagline" separators in titles/meta are a
  // decades-old human convention, and raw HTML could false-positive on
  // minified JS.
  const bodyDashes = countEmDashes(visibleText);
  if (bodyDashes > 0) {
    tells.push({
      id: "em-dash",
      label: "Em dashes in body text",
      detail: `${bodyDashes} em dash${bodyDashes === 1 ? "" : "es"} (—) found in the page text, a signature of LLM-written copy.`,
    });
  }

  return tells;
}

/**
 * Run the builder fingerprints over fetched JS/CSS bundle sources. Lovable,
 * v0 and friends often embed their own markers in shipped bundles even when
 * the HTML shell is clean.
 */
export function scanAssetsForTells(sources: string[]): HardTell[] {
  const tells: HardTell[] = [];
  for (const fp of HTML_FINGERPRINTS) {
    if (sources.some((src) => fp.pattern.test(src))) {
      tells.push({
        id: fp.id,
        label: fp.label,
        detail: `${fp.detail} (found in a linked script/style bundle)`,
      });
    }
  }
  return tells;
}
