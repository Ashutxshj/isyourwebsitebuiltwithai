import { describe, expect, it } from "vitest";
import { extractFromHtml, validateUrl } from "@/lib/scraper";
import { AppError } from "@/lib/types";

const ARTICLE_HTML = `<!doctype html>
<html>
<head>
  <title>My Test Article</title>
  <meta name="author" content="Jane Doe">
  <meta name="description" content="A test article about gardening.">
  <meta property="article:published_time" content="2024-03-01T10:00:00Z">
  <meta name="generator" content="WordPress 6.4">
  <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"BlogPosting","headline":"My Test Article","author":{"@type":"Person","name":"Jane Doe"},"datePublished":"2024-03-01"}
  </script>
</head>
<body>
  <nav><a href="/">Home</a> <a href="/about">About</a></nav>
  <article>
    <h1>My Test Article</h1>
    <h2>Getting started with tomatoes</h2>
    ${Array.from({ length: 8 }, (_, i) => `<p>Paragraph number ${i} talks about growing tomatoes in a backyard garden, with plenty of practical detail about soil, watering schedules, and the mistakes I made during my first two summers of trying.</p>`).join("\n")}
  </article>
  <footer>Copyright 2024</footer>
</body>
</html>`;

describe("extractFromHtml", () => {
  const content = extractFromHtml(ARTICLE_HTML, "https://example.com/article");

  it("extracts title and body text", () => {
    expect(content.title).toContain("My Test Article");
    expect(content.textContent).toContain("growing tomatoes");
    expect(content.wordCount).toBeGreaterThan(100);
  });

  it("extracts headings and paragraphs", () => {
    expect(content.headings).toContain("Getting started with tomatoes");
    expect(content.paragraphs.length).toBeGreaterThanOrEqual(8);
  });

  it("extracts metadata", () => {
    expect(content.metadata.author).toBe("Jane Doe");
    expect(content.metadata.publishedDate).toBe("2024-03-01T10:00:00Z");
    expect(content.metadata.generator).toBe("WordPress 6.4");
    expect(content.metadata.hasJsonLdArticle).toBe(true);
  });

  it("handles pages with no article markup", () => {
    const bare = extractFromHtml(
      "<html><head><title>Bare</title></head><body><p>Just a short single paragraph of text here.</p></body></html>",
      "https://example.com/bare",
    );
    expect(bare.title).toBe("Bare");
    expect(bare.metadata.author).toBeUndefined();
    expect(bare.metadata.hasJsonLdArticle).toBe(false);
  });

  it("survives malformed JSON-LD", () => {
    const html = `<html><head><title>x</title><script type="application/ld+json">{not json</script></head><body><p>Some body text that is long enough to count.</p></body></html>`;
    expect(() => extractFromHtml(html, "https://example.com/x")).not.toThrow();
  });
});

describe("validateUrl", () => {
  it("accepts normal https URLs", () => {
    expect(validateUrl("https://example.com/post").hostname).toBe("example.com");
  });

  it("accepts bare domains by assuming https", () => {
    const url = validateUrl("farmzo.co.in");
    expect(url.protocol).toBe("https:");
    expect(url.hostname).toBe("farmzo.co.in");
    expect(validateUrl("example.com/some/article").pathname).toBe("/some/article");
  });

  it("still blocks private hosts entered without a scheme", () => {
    expect(() => validateUrl("localhost:3000")).toThrowError(/not allowed/);
    expect(() => validateUrl("192.168.1.1/admin")).toThrowError(/not allowed/);
  });

  it("rejects garbage", () => {
    expect(() => validateUrl("not a url")).toThrowError(AppError);
    expect(() => validateUrl("not a url")).toThrowError(/not a valid URL/);
  });

  it("rejects non-http protocols", () => {
    expect(() => validateUrl("ftp://example.com")).toThrowError(/http/);
    expect(() => validateUrl("file:///etc/passwd")).toThrowError(AppError);
  });

  it.each([
    "http://localhost:3000",
    "http://127.0.0.1/admin",
    "http://10.0.0.5/internal",
    "http://192.168.1.1",
    "http://172.16.0.1",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]:8080",
    "http://internal.local",
  ])("blocks private/internal address %s", (url) => {
    expect(() => validateUrl(url)).toThrowError(/not allowed/);
  });
});
