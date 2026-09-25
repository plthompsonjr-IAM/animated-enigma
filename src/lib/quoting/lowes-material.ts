import 'server-only';

import type {
  WebScrapeParams,
  WebScrapeResponse,
  WebSearchParams,
  WebSearchResponse,
} from 'context.dev/resources/web';

import { getContextDevClient, withContextDevRetry } from '@/lib/context-dev/client';

/** Live store price and stock were not confirmed with a Lowe's account. */
export const LOWES_CHECK_REQUIRED = 'NOT VERIFIED — CHECK REQUIRED';

export type LowesMaterialLine = {
  description: string;
  category: 'material';
  vendor: "Lowe's";
  itemNumber: string | null;
  unit: 'each';
  quantity: null;
  unitCostLow: number | null;
  unitCostHigh: number | null;
  productUrl: string | null;
  verification: string;
};

export type LowesMaterialResult = {
  materials: LowesMaterialLine[];
  sources: string[];
  partial: boolean;
  creditsConsumed: number | null;
  creditsRemaining: number | null;
  note: string;
};

export type LowesSearchFn = (body: WebSearchParams) => Promise<WebSearchResponse>;
export type LowesScrapeFn = (body: WebScrapeParams) => Promise<WebScrapeResponse>;

const NOTE =
  "Online Lowe's page only. Confirm the item number, store price, and stock before buying. NOT VERIFIED — CHECK REQUIRED.";

export function buildLowesQuery(scope: string): string {
  const query = scope.replace(/\s+/g, ' ').trim();
  if (!query) throw new Error("Lowe's search needs a scope");
  return query.slice(0, 180);
}

/** Item number published in a Lowe's product URL. Other sites and search pages return null. */
export function lowesItemNumberFromUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== 'lowes.com' && !host.endsWith('.lowes.com')) return null;
  const parts = parsed.pathname.split('/').filter(Boolean);
  const productIndex = parts.indexOf('pd');
  if (productIndex === -1 || productIndex === parts.length - 1) return null;
  const itemNumber = parts[parts.length - 1] ?? '';
  return /^\d{5,}$/.test(itemNumber) ? itemNumber : null;
}

export function pickLowesProductUrl(urls: string[]): string | null {
  for (const url of urls) {
    if (lowesItemNumberFromUrl(url)) return url;
  }
  return null;
}

export async function sourceLowesMaterial(
  input: { scope: string },
  deps?: { search?: LowesSearchFn; scrape?: LowesScrapeFn },
): Promise<LowesMaterialResult> {
  const search = deps?.search ?? defaultSearch;
  const scrape = deps?.scrape ?? defaultScrape;
  const searched = await search({
    query: buildLowesQuery(input.scope),
    includeDomains: ['lowes.com'],
    country: 'us',
    numResults: 10,
    tags: ['job-quote', 'lowes-material'],
  });

  const productUrl = pickLowesProductUrl(searched.results.map((result) => result.url));
  if (!productUrl) {
    return {
      materials: [],
      sources: searched.results.map((result) => result.url),
      partial: searched.partial === true,
      creditsConsumed: searched.key_metadata?.credits_consumed ?? null,
      creditsRemaining: searched.key_metadata?.credits_remaining ?? null,
      note: `No Lowe's product page found. ${NOTE}`,
    };
  }

  const page = await scrape({
    url: productUrl,
    formats: { product: true },
    maxAgeMs: 0,
    productParams: { useAIFallback: false },
    tags: ['job-quote', 'lowes-material'],
    timeoutOpts: { milliseconds: 45_000, behavior: 'fail' },
  });

  const product = page.product.data?.isProductPage ? page.product.data.product : null;
  const itemNumber =
    product?.sku?.trim() || lowesItemNumberFromUrl(page.url) || lowesItemNumberFromUrl(productUrl);
  const price =
    typeof product?.price === 'number' && Number.isFinite(product.price) ? product.price : null;
  const description = product?.name?.trim() || "Lowe's product";

  return {
    materials: [
      {
        description,
        category: 'material',
        vendor: "Lowe's",
        itemNumber: itemNumber || null,
        unit: 'each',
        quantity: null,
        unitCostLow: price,
        unitCostHigh: price,
        productUrl: page.url || productUrl,
        verification: LOWES_CHECK_REQUIRED,
      },
    ],
    sources: [page.url || productUrl],
    partial: searched.partial === true || page.isPartial === true,
    creditsConsumed: sumCredits(
      searched.key_metadata?.credits_consumed,
      page.key_metadata?.credits_consumed,
    ),
    creditsRemaining:
      page.key_metadata?.credits_remaining ?? searched.key_metadata?.credits_remaining ?? null,
    note: NOTE,
  };
}

async function defaultSearch(body: WebSearchParams): Promise<WebSearchResponse> {
  const client = getContextDevClient();
  return withContextDevRetry(() => client.web.search(body));
}

async function defaultScrape(body: WebScrapeParams): Promise<WebScrapeResponse> {
  const client = getContextDevClient();
  return withContextDevRetry(() => client.web.scrape(body));
}

function sumCredits(left: number | undefined, right: number | undefined): number | null {
  if (left === undefined && right === undefined) return null;
  return (left ?? 0) + (right ?? 0);
}
