import { JSDOM, VirtualConsole } from "jsdom";
import { Readability } from "@mozilla/readability";
import { detectHardTells, scanAssetsForTells } from "./fingerprints";
import { AppError, type ExtractedContent, type PageMetadata } from "./types";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const PRIVATE_HOST_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /\.local$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^0\./,
  /^\[?::1\]?$/,
  /^\[?f[cd][0-9a-f]{2}:/i,
];

export function validateUrl(input: string): URL {
  const trimmed = input.trim();
  // Accept bare domains like "example.com/article" by assuming https.
  const normalized = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new AppError("INVALID_URL", `"${input}" is not a valid URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new AppError("INVALID_URL", "Only http(s) URLs are supported.");
  }
  // ALLOW_PRIVATE_URLS=1 is a local-testing escape hatch (e.g. analyzing a page
  // served from localhost). Never set it in production — this check is the SSRF guard.
  const allowPrivate = process.env.ALLOW_PRIVATE_URLS === "1" || process.env.ALLOW_PRIVATE_URLS === "true";
  if (!allowPrivate && PRIVATE_HOST_PATTERNS.some((re) => re.test(url.hostname))) {
    throw new AppError("BLOCKED_URL", "Local and private network URLs are not allowed.");
  }
  return url;
}

export async function fetchHtml(url: URL): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new AppError("TIMEOUT", `The site took longer than ${FETCH_TIMEOUT_MS / 1000}s to respond.`);
    }
    throw new AppError("FETCH_FAILED", `Could not reach ${url.hostname}.`);
  }

  if (response.status === 403 || response.status === 401 || response.status === 429) {
    throw new AppError("BOT_BLOCKED", `${url.hostname} blocked the request (HTTP ${response.status}).`);
  }
  if (!response.ok) {
    throw new AppError("FETCH_FAILED", `${url.hostname} responded with HTTP ${response.status}.`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType && !/text\/html|application\/xhtml/i.test(contentType)) {
    throw new AppError("NOT_HTML", `Expected an HTML page but got "${contentType}".`);
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_BODY_BYTES) {
    throw new AppError("NOT_HTML", "Page is too large to analyze.");
  }
  return new TextDecoder().decode(buffer);
}

function extractMetadata(document: Document): PageMetadata {
  const meta = (name: string): string | undefined => {
    const el =
      document.querySelector(`meta[name="${name}"]`) ??
      document.querySelector(`meta[property="${name}"]`);
    return el?.getAttribute("content")?.trim() || undefined;
  };

  let hasJsonLdArticle = false;
  let jsonLdAuthor: string | undefined;
  let jsonLdDate: string | undefined;
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const parsed = JSON.parse(script.textContent ?? "");
      const nodes = Array.isArray(parsed) ? parsed : [parsed, ...(parsed["@graph"] ?? [])];
      for (const node of nodes) {
        const type = Array.isArray(node?.["@type"]) ? node["@type"].join(" ") : node?.["@type"];
        if (typeof type === "string" && /Article|BlogPosting|NewsArticle/i.test(type)) {
          hasJsonLdArticle = true;
          const author = Array.isArray(node.author) ? node.author[0] : node.author;
          jsonLdAuthor ??= typeof author === "string" ? author : author?.name;
          jsonLdDate ??= node.datePublished;
        }
      }
    } catch {
      // malformed JSON-LD is common in the wild; ignore
    }
  }

  return {
    author:
      meta("author") ??
      meta("article:author") ??
      jsonLdAuthor ??
      (document.querySelector('[rel="author"], .author-name, [itemprop="author"]')?.textContent?.trim() ||
        undefined),
    publishedDate:
      meta("article:published_time") ??
      jsonLdDate ??
      document.querySelector("time[datetime]")?.getAttribute("datetime") ??
      undefined,
    description: meta("description") ?? meta("og:description"),
    generator: meta("generator"),
    ogImage: meta("og:image"),
    hasJsonLdArticle,
  };
}

/** Parse raw HTML into structured content. Pure — no network — so it is unit-testable. */
export function extractFromHtml(html: string, url: string): ExtractedContent {
  const virtualConsole = new VirtualConsole(); // swallow jsdom CSS parse noise
  const dom = new JSDOM(html, { url, virtualConsole });
  const document = dom.window.document;

  const metadata = extractMetadata(document);

  // Readability mutates the DOM, so give it a clone and keep the original for fallbacks.
  const article = new Readability(document.cloneNode(true) as Document, {
    charThreshold: 250,
  }).parse();

  const textContent = (article?.textContent ?? document.body?.textContent ?? "")
    .replace(/\s+/g, " ")
    .trim();

  const headings = Array.from(document.querySelectorAll("h1, h2, h3"))
    .map((h) => h.textContent?.replace(/\s+/g, " ").trim() ?? "")
    .filter((t) => t.length > 0);

  let paragraphs: string[];
  if (article?.content) {
    const articleDom = new JSDOM(article.content, { virtualConsole });
    paragraphs = Array.from(articleDom.window.document.querySelectorAll("p"))
      .map((p) => p.textContent?.replace(/\s+/g, " ").trim() ?? "")
      .filter((t) => t.split(/\s+/).length >= 5);
  } else {
    paragraphs = Array.from(document.querySelectorAll("p"))
      .map((p) => p.textContent?.replace(/\s+/g, " ").trim() ?? "")
      .filter((t) => t.split(/\s+/).length >= 5);
  }

  const wordCount = textContent ? textContent.split(/\s+/).length : 0;

  // SPA shells often carry their only real copy in <title> and meta tags, so
  // hard tells (especially em dashes) must see that text too.
  const metaText = [
    document.title,
    ...Array.from(
      document.querySelectorAll(
        'meta[name="description"], meta[property^="og:"], meta[name^="twitter:"]',
      ),
    ).map((m) => m.getAttribute("content") ?? ""),
    ...headings,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    url,
    title: article?.title || document.title || url,
    textContent,
    wordCount,
    headings,
    paragraphs,
    metadata,
    hardTells: detectHardTells(html, textContent, metaText),
    headHtml: html.slice(0, 4000),
  };
}

/**
 * Fetch up to three same-origin script bundles and scan them for builder
 * fingerprints. Best-effort: failures just mean no extra evidence.
 */
async function scanBundles(html: string, pageUrl: URL): Promise<ReturnType<typeof scanAssetsForTells>> {
  const srcs = Array.from(
    html.matchAll(/<(?:script[^>]+src|link[^>]+(?:rel=["'](?:modulepreload|preload)["'])[^>]+href)=["']([^"']+\.(?:js|css)[^"']*)["']/gi),
    (m) => m[1],
  );

  const sameOrigin: string[] = [];
  for (const src of srcs) {
    try {
      const resolved = new URL(src, pageUrl);
      if (resolved.origin === pageUrl.origin) sameOrigin.push(resolved.href);
    } catch {
      // unresolvable src; skip
    }
    if (sameOrigin.length >= 3) break;
  }

  const sources = await Promise.all(
    sameOrigin.map(async (href) => {
      try {
        const res = await fetch(href, {
          headers: { "User-Agent": USER_AGENT },
          signal: AbortSignal.timeout(5_000),
        });
        if (!res.ok) return "";
        const buf = await res.arrayBuffer();
        if (buf.byteLength > 500 * 1024) return "";
        return new TextDecoder().decode(buf);
      } catch {
        return "";
      }
    }),
  );

  return scanAssetsForTells(sources.filter(Boolean));
}

/**
 * Serverless platforms (Vercel/Lambda) ship no system Chrome, so use the
 * @sparticuz/chromium build there; locally, full puppeteer manages its own.
 */
async function launchBrowser() {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    const [{ default: chromium }, { default: puppeteer }] = await Promise.all([
      import("@sparticuz/chromium"),
      import("puppeteer-core"),
    ]);
    return puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      // @sparticuz/chromium ships chrome-headless-shell; other modes fail to launch.
      headless: "shell",
    });
  }
  const puppeteer = (await import("puppeteer")).default;
  return puppeteer.launch({ headless: true });
}

/**
 * Render the page in headless Chrome so client-side apps (React/Vue SPAs)
 * produce their real content before extraction. Also captures a screenshot
 * of the top of the page so the LLM can judge the visual design.
 */
async function renderWithBrowser(url: URL): Promise<{ html: string; screenshot?: string }> {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);
    // Tall viewport: the screenshot covers the hero plus a few sections.
    await page.setViewport({ width: 1280, height: 2400 });
    await page.goto(url.href, { waitUntil: "networkidle2", timeout: 25_000 });
    // Give client frameworks a moment to hydrate and paint real text.
    await page
      .waitForFunction(() => (document.body?.innerText ?? "").length > 400, { timeout: 5_000 })
      .catch(() => {});
    const html = await page.content();
    let screenshot: string | undefined;
    try {
      const shot = await page.screenshot({ type: "jpeg", quality: 65 });
      screenshot = Buffer.from(shot).toString("base64");
    } catch {
      // A failed screenshot should not sink the whole analysis.
    }
    return { html, screenshot };
  } finally {
    await browser.close();
  }
}

export async function scrape(input: string): Promise<ExtractedContent> {
  const url = validateUrl(input);
  const html = await fetchHtml(url);
  let content = extractFromHtml(html, url.href);

  // A hard tell in the static HTML already decides the verdict; skip the
  // expensive browser render entirely.
  if (content.hardTells.length > 0) {
    return content;
  }

  // No tell in the HTML shell: check the shipped bundles, which often carry
  // the builder's markers. Still far cheaper than launching a browser.
  try {
    const bundleTells = await scanBundles(html, url);
    if (bundleTells.length > 0) {
      content.hardTells.push(...bundleTells);
      return content;
    }
  } catch {
    // best-effort only
  }

  // Almost no static text usually means a client-rendered SPA. Retry with a
  // real browser before giving up.
  if (content.wordCount < 100) {
    try {
      const { html: rendered, screenshot } = await renderWithBrowser(url);
      const renderedContent = extractFromHtml(rendered, url.href);
      if (renderedContent.wordCount > content.wordCount) {
        content = renderedContent;
      }
      content.screenshot = screenshot;
      // Keep the head as originally served: puppeteer's DOM serialization
      // normalizes the hand-edit quirks the LLM should get to see.
      content.headHtml = html.slice(0, 4000);
    } catch (err) {
      // Browser render is best-effort; fall through with the static result.
      console.error("browser render failed:", err);
    }
  }

  // With a screenshot the LLM can still judge the page visually, so thin
  // text is only fatal when we have neither a screenshot nor a hard tell.
  if (content.wordCount < 100 && content.hardTells.length === 0 && !content.screenshot) {
    throw new AppError(
      "INSUFFICIENT_TEXT",
      `Only ${content.wordCount} words of readable text found, too little to analyze reliably. The page may block automated browsers.`,
    );
  }
  return content;
}
