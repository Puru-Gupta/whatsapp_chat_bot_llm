import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { load, type CheerioAPI } from "cheerio";
import type { KnowledgeDocument } from "@/lib/knowledge";

const USER_AGENT =
  "AQLIKnowledgeBot/1.0 (+https://aqli-whatsapp-chatbot.vercel.app)";
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_DISCOVERED_URLS = 80;

export interface CrawlWebsiteResult {
  startUrl: string;
  documents: KnowledgeDocument[];
  pagesVisited: number;
  warnings: string[];
}

export async function crawlWebsite(
  rawUrl: string,
  options: { mode?: "page" | "site"; maxPages?: number } = {}
): Promise<CrawlWebsiteResult> {
  const startUrl = normalizeWebsiteUrl(rawUrl);
  const mode = options.mode ?? "site";
  const maxPages = Math.min(Math.max(options.maxPages ?? 12, 1), 20);
  const firstResponse = await fetchHtmlPage(startUrl);
  const rootOrigin = new URL(firstResponse.finalUrl).origin;
  const firstPage = extractPage(firstResponse.html, firstResponse.finalUrl, rootOrigin);

  if (!firstPage || firstPage.text.length < 120) {
    throw new WebsiteImportError(
      "The page did not contain enough readable text to index."
    );
  }

  const documents: KnowledgeDocument[] = [];
  const warnings: string[] = [];
  const seenUrls = new Set<string>();
  const seenContent = new Set<string>();
  const queue: string[] = [];
  let pagesVisited = 1;

  addPage(firstPage);
  if (mode === "site") enqueue(firstPage.links);

  while (
    mode === "site" &&
    queue.length > 0 &&
    documents.length < maxPages &&
    pagesVisited < maxPages * 3
  ) {
    const batch = queue.splice(0, Math.min(3, maxPages - documents.length));
    batch.forEach((url) => seenUrls.add(url));
    pagesVisited += batch.length;
    const results = await Promise.allSettled(
      batch.map(async (url) => {
        const response = await fetchHtmlPage(url);
        return extractPage(response.html, response.finalUrl, rootOrigin);
      })
    );

    results.forEach((result, index) => {
      if (result.status === "rejected") {
        if (warnings.length < 5) {
          warnings.push(`Skipped ${new URL(batch[index]).pathname}`);
        }
        return;
      }
      if (!result.value) return;
      addPage(result.value);
      enqueue(result.value.links);
    });
  }

  return {
    startUrl: firstResponse.finalUrl,
    documents,
    pagesVisited,
    warnings,
  };

  function addPage(page: ExtractedPage) {
    seenUrls.add(page.url);
    const digest = createHash("sha256")
      .update(page.text.replace(/\s+/g, " ").trim().toLowerCase())
      .digest("hex");
    if (seenContent.has(digest)) return;
    seenContent.add(digest);
    documents.push({
      text: page.text,
      metadata: {
        page_title: page.title,
        page_url: page.url,
      },
    });
  }

  function enqueue(urls: string[]) {
    for (const url of urls) {
      if (
        queue.length >= MAX_DISCOVERED_URLS ||
        seenUrls.has(url) ||
        queue.includes(url)
      ) {
        continue;
      }
      queue.push(url);
    }
    queue.sort((left, right) => linkPriority(left) - linkPriority(right));
  }
}

export function normalizeWebsiteUrl(rawUrl: string): string {
  const value = rawUrl.trim();
  if (!value) throw new WebsiteImportError("Website URL is required.");

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    throw new WebsiteImportError("Enter a valid website URL.");
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new WebsiteImportError("Only HTTP and HTTPS website URLs are supported.");
  }
  if (url.username || url.password) {
    throw new WebsiteImportError("Website URLs cannot include credentials.");
  }
  if (url.port && !["80", "443"].includes(url.port)) {
    throw new WebsiteImportError("Only standard website ports are supported.");
  }

  url.hash = "";
  return url.toString();
}

export function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase();

  if (normalized.startsWith("::ffff:")) {
    return isPrivateAddress(normalized.slice(7));
  }

  if (isIP(normalized) === 4) {
    const [a, b] = normalized.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }

  if (isIP(normalized) === 6) {
    return (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      /^fe[89ab]/.test(normalized) ||
      normalized.startsWith("2001:db8:")
    );
  }

  return true;
}

export class WebsiteImportError extends Error {
  constructor(
    message: string,
    public readonly status = 400
  ) {
    super(message);
    this.name = "WebsiteImportError";
  }
}

interface HtmlPage {
  html: string;
  finalUrl: string;
}

interface ExtractedPage {
  title: string;
  url: string;
  text: string;
  links: string[];
}

async function fetchHtmlPage(initialUrl: string): Promise<HtmlPage> {
  let currentUrl = initialUrl;

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    await assertPublicUrl(currentUrl);
    const response = await fetch(currentUrl, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": USER_AGENT,
      },
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new WebsiteImportError("The website returned an invalid redirect.");
      }
      currentUrl = normalizeWebsiteUrl(new URL(location, currentUrl).toString());
      continue;
    }

    if (!response.ok) {
      throw new WebsiteImportError(
        `The website returned HTTP ${response.status}.`,
        422
      );
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      throw new WebsiteImportError("The URL does not point to an HTML page.");
    }

    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_PAGE_BYTES) {
      throw new WebsiteImportError("The page is too large to import.");
    }

    return {
      html: await readLimitedBody(response),
      finalUrl: canonicalizeUrl(currentUrl),
    };
  }

  throw new WebsiteImportError("The website redirected too many times.");
}

async function readLimitedBody(response: Response): Promise<string> {
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_PAGE_BYTES) {
      await reader.cancel();
      throw new WebsiteImportError("The page is too large to import.");
    }
    text += decoder.decode(value, { stream: true });
  }

  return text + decoder.decode();
}

async function assertPublicUrl(value: string): Promise<void> {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");

  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname === "metadata.google.internal"
  ) {
    throw new WebsiteImportError("Private or local website addresses are not allowed.");
  }

  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new WebsiteImportError("Private or local website addresses are not allowed.");
    }
    return;
  }

  let addresses: LookupAddress[];
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new WebsiteImportError("The website hostname could not be resolved.", 422);
  }

  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new WebsiteImportError("Private or local website addresses are not allowed.");
  }
}

function extractPage(
  html: string,
  pageUrl: string,
  rootOrigin: string
): ExtractedPage | null {
  const $ = load(html);
  const robots = $('meta[name="robots"]').attr("content")?.toLowerCase() ?? "";
  if (robots.includes("noindex")) return null;

  const links = extractLinks($, pageUrl, rootOrigin);
  $("script, style, noscript, svg, canvas, iframe, form, button, nav, footer, header").remove();
  $("[aria-hidden='true'], .cookie, .cookies, .modal, .popup").remove();

  const title = cleanInlineText(
    $('meta[property="og:title"]').attr("content") ??
      $("h1").first().text() ??
      $("title").text()
  );
  const root = $("main").first().length
    ? $("main").first()
    : $("article").first().length
      ? $("article").first()
      : $("body");
  const blocks: string[] = [];
  const seen = new Set<string>();

  root.find("h1, h2, h3, h4, p, li, dt, dd, th, td").each((_, element) => {
    const text = cleanInlineText($(element).text());
    const key = text.toLowerCase();
    if (text.length < 12 || seen.has(key)) return;
    seen.add(key);
    blocks.push(text);
  });

  const text = [title, ...blocks].filter(Boolean).join("\n\n").slice(0, 160_000);
  if (text.length < 120) return null;

  return { title: title || new URL(pageUrl).hostname, url: pageUrl, text, links };
}

function extractLinks($: CheerioAPI, pageUrl: string, rootOrigin: string): string[] {
  const links = new Set<string>();

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    if (!href || href.startsWith("#") || /^(mailto|tel|javascript):/i.test(href)) {
      return;
    }
    if ($(element).attr("rel")?.toLowerCase().includes("nofollow")) return;

    try {
      const url = new URL(href, pageUrl);
      if (url.origin !== rootOrigin || !['http:', 'https:'].includes(url.protocol)) return;
      if (shouldSkipPath(url.pathname)) return;
      links.add(canonicalizeUrl(url.toString()));
    } catch {
      // Ignore malformed links discovered in otherwise valid pages.
    }
  });

  return Array.from(links).sort(
    (left, right) => linkPriority(left) - linkPriority(right)
  );
}

function linkPriority(value: string): number {
  const pathname = new URL(value).pathname.toLowerCase();
  if (pathname.includes("/about/methodology")) return 0;
  if (pathname === "/about" || pathname.includes("/about/howitstarted")) return 1;
  if (pathname.includes("/about/contact")) return 2;
  if (pathname === "/") return 3;
  if (pathname === "/news") return 4;
  if (pathname.startsWith("/about/")) return 5;
  if (pathname.startsWith("/news/")) return 20;
  return 10;
}

function canonicalizeUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/{2,}/g, "/");
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/$/, "");
  return url.toString();
}

function shouldSkipPath(pathname: string): boolean {
  return (
    /\.(?:7z|avi|css|csv|docx?|gif|jpe?g|js|json|mp3|mp4|mov|pdf|png|pptx?|rar|rss|svg|webp|xlsx?|xml|zip)$/i.test(
      pathname
    ) ||
    /\/(?:admin|login|logout|search|wp-admin|wp-json)(?:\/|$)/i.test(pathname)
  );
}

function cleanInlineText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
