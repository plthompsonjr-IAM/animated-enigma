import { describe, expect, it, vi } from 'vitest';
import type { WebScrapeResponse, WebSearchResponse } from 'context.dev/resources/web';

import {
  LOWES_CHECK_REQUIRED,
  lowesItemNumberFromUrl,
  sourceLowesMaterial,
  type LowesScrapeFn,
  type LowesSearchFn,
} from './lowes-material';

const PRODUCT_URL = 'https://www.lowes.com/pd/JELD-WEN-60-in-Interior-Door/5012345678';

describe('lowesItemNumberFromUrl', () => {
  it("reads the item number from a Lowe's product URL", () => {
    expect(lowesItemNumberFromUrl(PRODUCT_URL)).toBe('5012345678');
  });

  it("ignores other retailers and Lowe's search pages", () => {
    expect(lowesItemNumberFromUrl('https://www.homedepot.com/p/door/5012345678')).toBeNull();
    expect(lowesItemNumberFromUrl('https://www.lowes.com/search?searchTerm=door')).toBeNull();
  });
});

describe('sourceLowesMaterial', () => {
  it("searches Lowe's and scrapes one fresh product page", async () => {
    const search = vi.fn<LowesSearchFn>(async () => searchResponse([PRODUCT_URL]));
    const scrape = vi.fn<LowesScrapeFn>(async () => scrapeResponse());

    const result = await sourceLowesMaterial(
      { scope: '60-inch interior prehung door' },
      { search, scrape },
    );

    expect(search).toHaveBeenCalledTimes(1);
    expect(search.mock.calls[0]?.[0]).toMatchObject({
      includeDomains: ['lowes.com'],
      country: 'us',
      numResults: 10,
    });
    expect(scrape).toHaveBeenCalledTimes(1);
    expect(scrape.mock.calls[0]?.[0]).toMatchObject({
      url: PRODUCT_URL,
      formats: { product: true },
      maxAgeMs: 0,
      productParams: { useAIFallback: false },
    });
    expect(result.materials).toEqual([
      {
        description: 'JELD-WEN 60 in. White Interior Door',
        category: 'material',
        vendor: "Lowe's",
        itemNumber: '5012345678',
        unit: 'each',
        quantity: null,
        unitCostLow: 214,
        unitCostHigh: 214,
        productUrl: PRODUCT_URL,
        verification: LOWES_CHECK_REQUIRED,
      },
    ]);
    expect(result.creditsConsumed).toBe(3);
    expect(result.note).toContain(LOWES_CHECK_REQUIRED);
  });

  it('does not invent a price or item number when no product page is found', async () => {
    const search = vi.fn<LowesSearchFn>(async () =>
      searchResponse(['https://www.lowes.com/search?searchTerm=door']),
    );
    const scrape = vi.fn<LowesScrapeFn>();

    const result = await sourceLowesMaterial({ scope: 'prehung door' }, { search, scrape });

    expect(scrape).not.toHaveBeenCalled();
    expect(result.materials).toEqual([]);
    expect(result.note).toContain(LOWES_CHECK_REQUIRED);
  });

  it('keeps a missing page price null', async () => {
    const search = vi.fn<LowesSearchFn>(async () => searchResponse([PRODUCT_URL]));
    const scrape = vi.fn<LowesScrapeFn>(async () =>
      scrapeResponse({
        product: {
          requested: true,
          data: {
            isProductPage: true,
            product: {
              name: 'JELD-WEN door',
              price: null,
              sku: null,
              currency: null,
              availability: null,
              brand: null,
              category: null,
              description: null,
              dimensions: [],
              features: [],
              images: [],
              imageUrl: null,
              regularPrice: null,
              tags: [],
              targetAudience: [],
              variants: [],
            },
          },
        },
      }),
    );

    const result = await sourceLowesMaterial({ scope: 'prehung door' }, { search, scrape });

    expect(result.materials[0]?.unitCostLow).toBeNull();
    expect(result.materials[0]?.unitCostHigh).toBeNull();
    expect(result.materials[0]?.itemNumber).toBe('5012345678');
    expect(result.materials[0]?.verification).toBe(LOWES_CHECK_REQUIRED);
  });
});

function searchResponse(urls: string[]): WebSearchResponse {
  return {
    cache_metadata: { age_ms: 0, status: 'miss' },
    query: 'door',
    request_id: 'req-search',
    results: urls.map((url) => ({
      description: '',
      markdown: { code: 'NOT_REQUESTED', markdown: null },
      relevance: 'high',
      title: 'Door',
      url,
    })),
    key_metadata: { credits_consumed: 1, credits_remaining: 100 },
  };
}

function scrapeResponse(overrides: Partial<WebScrapeResponse> = {}): WebScrapeResponse {
  return {
    url: PRODUCT_URL,
    request_id: 'req-scrape',
    isPartial: undefined,
    key_metadata: { credits_consumed: 2, credits_remaining: 98 },
    product: {
      requested: true,
      data: {
        isProductPage: true,
        product: {
          name: 'JELD-WEN 60 in. White Interior Door',
          price: 214,
          sku: '5012345678',
          currency: 'USD',
          availability: 'in_stock',
          brand: 'JELD-WEN',
          category: 'Doors',
          description: null,
          dimensions: [],
          features: [],
          images: [],
          imageUrl: null,
          regularPrice: 214,
          tags: [],
          targetAudience: [],
          variants: [],
        },
      },
    },
    ...overrides,
  } as WebScrapeResponse;
}
