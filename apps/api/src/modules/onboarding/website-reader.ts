import { safeFetch } from '../../common/safe-fetch';
import { plainText } from '../catalog-feeds/feed-normalize';

export interface WebsitePage {
  url: string;
  text: string;
}

/** Links to the pages a customer's delivery, payment and returns questions are answered on. */
const POLICY_LINK =
  /доставк|оплат|обмін|поверн|гаранті|контакт|умови|про нас|про-нас|delivery|shipping|payment|oplata|dostavka|return|exchange|obmin|povernen|contact|kontakt|faq|about/i;
const MAX_PAGES = 6;
const MAX_PAGE_CHARS = 6000;

/**
 * The text of a store's home page and its policy pages (delivery, payment,
 * returns, contacts), for drafting store notes. Same site only, through
 * safeFetch. Pages that fail are skipped; nothing here throws for one bad page.
 */
export async function readWebsite(rawUrl: string): Promise<WebsitePage[]> {
  const home = await fetchPage(rawUrl);
  if (!home) return [];
  const pages: WebsitePage[] = [{ url: home.url, text: pageText(home.html) }];
  for (const link of policyLinks(home.html, home.url).slice(0, MAX_PAGES - 1)) {
    const page = await fetchPage(link);
    if (page) pages.push({ url: page.url, text: pageText(page.html) });
  }
  return pages.filter((p) => p.text.length > 0);
}

async function fetchPage(url: string): Promise<{ url: string; html: string } | null> {
  try {
    const res = await safeFetch(url, { timeoutMs: 15_000, maxBytes: 3 * 1024 * 1024, headers: { accept: 'text/html' } });
    if (res.status < 200 || res.status >= 300) return null;
    return { url: res.url, html: res.body.toString('utf8') };
  } catch {
    return null;
  }
}

/** Same-site links whose address or text looks like a policy page, best first. */
export function policyLinks(html: string, base: string): string[] {
  const host = new URL(base).host;
  const found = new Map<string, number>();
  for (const m of html.matchAll(/<a\s[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url: URL;
    try {
      url = new URL(m[1], base);
    } catch {
      continue;
    }
    if (url.host !== host || !/^https?:$/.test(url.protocol)) continue;
    const label = plainText(m[2]) ?? '';
    const haystack = `${decodeURIComponent(url.pathname)} ${label}`;
    if (!POLICY_LINK.test(haystack)) continue;
    const key = `${url.origin}${url.pathname}`;
    // Delivery and payment first: they're what customers ask most.
    const rank = /доставк|оплат|delivery|shipping|payment|oplata|dostavka/i.test(haystack) ? 0 : 1;
    found.set(key, Math.min(found.get(key) ?? 9, rank));
  }
  return [...found.entries()].sort((a, b) => a[1] - b[1]).map(([url]) => url);
}

/** Visible text of a page, without scripts, styles and the usual navigation chrome. */
export function pageText(html: string): string {
  const body = html
    // The footer stays: it is where shops put their phone and address.
    .replace(/<(script|style|noscript|svg|nav|header|form)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  return (plainText(body, MAX_PAGE_CHARS * 2) ?? '').replace(/\n{2,}/g, '\n').slice(0, MAX_PAGE_CHARS);
}
