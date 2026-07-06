# AI Website Detector Tool Plan

This document outlines the architecture and implementation strategy for building a tool that can analyze a given URL and determine if the website or its content is AI-generated, without requiring the user to manually visit the site.

## User Review Required

> [!IMPORTANT]
> **API Costs and Selection:** To accurately detect AI content, we will need to integrate with third-party AI detection APIs (like GPTZero, Copyleaks, or Originality.ai). Most of these charge per word or per request. Are you comfortable with setting up an account and providing API keys for these services, or should we try to build a rudimentary, free heuristics-based detector first (which will be less accurate)?

> [!NOTE]
> **Tool Format:** Should this be a Command Line Interface (CLI) tool for developers, or a web application (e.g., built with Next.js or React) with a user interface? The plan below assumes a web application, but we can easily pivot to a CLI.

## Open Questions

1. **Scraping Depth:** Should the tool only scan the specific URL provided, or should it attempt to crawl the entire website (or check the `/sitemap.xml`) to look for signs of mass-generated programmatic SEO?
2. **Technology Stack:** I recommend Node.js/Next.js for the backend/frontend and Puppeteer or Cheerio for scraping. Does this stack align with your preferences?

## Proposed Architecture & Workflow

The tool will operate in a pipeline consisting of three main phases: Extraction, Analysis, and Scoring.

### 1. Data Extraction Layer (Scraping)
When a URL is submitted, the backend will fetch the page contents.
*   **Headless Browser/Scraper:** Use `Puppeteer` or `Cheerio` to bypass basic bot protection and render the DOM.
*   **Text Extraction:** Strip out HTML, scripts, and CSS. Extract the main article body, headings, and meta tags.
*   **Metadata Extraction:** Look for author tags, publication dates, and "About Us" information. Missing or highly generic metadata is a strong signal for AI content farms.

### 2. Analysis Layer
The extracted data will be passed through multiple analysis engines:
*   **API Integration (Primary Detection):** Send the core text to an AI detection API (e.g., GPTZero or Copyleaks) to analyze "perplexity" and "burstiness".
*   **Heuristics Engine (Secondary Detection):** A custom local script that scans for common AI "tells":
    *   Regex matching for common AI phrases ("In conclusion", "It's important to note that...", "Delve", "Tapestry").
    *   Checking for missing author biographies or generic stock imagery placeholders.

### 3. Scoring & Reporting Layer
*   **Aggregation:** Combine the API score and the Heuristic score into a final "AI Probability Score" (0-100%).
*   **Report Generation:** Present a breakdown explaining *why* the site was flagged (e.g., "High predictability in text," "Missing author metadata," "Use of 15 known AI phrases").

## Proposed Changes

If we proceed with a Next.js web application, the file structure will look like this:

### Frontend & Backend (Next.js)

#### [NEW] `package.json`
Dependencies for Next.js, Cheerio (scraping), and API clients.

#### [NEW] `app/page.tsx`
The main user interface with a URL input field, loading states, and a results dashboard displaying the AI Probability Score.

#### [NEW] `app/api/analyze/route.ts`
The backend API route that receives the URL, orchestrates the scraping, and calls the detection APIs.

#### [NEW] `lib/scraper.ts`
Utility functions for fetching the URL, parsing HTML, and extracting meaningful text and metadata.

#### [NEW] `lib/heuristics.ts`
Local logic to scan the extracted text for known AI patterns and metadata anomalies.

## Verification Plan

### Automated Tests
*   `npm test`: Unit tests for the `scraper.ts` to ensure it accurately extracts text from various HTML structures (blogs, news sites, landing pages).
*   Mock tests for the AI Detection API to ensure the scoring aggregation works correctly.

### Manual Verification
*   **Control Test (Human):** Input URLs of known, well-respected human-written articles (e.g., older New York Times articles, personal blogs) and verify the score is low (<10%).
*   **Control Test (AI):** Generate a raw article using ChatGPT, host it on a temporary URL, and verify the tool flags it with a high score (>90%).
*   **Edge Cases:** Test on sites with heavy JavaScript rendering to ensure the scraper extracts the text correctly before analysis.
