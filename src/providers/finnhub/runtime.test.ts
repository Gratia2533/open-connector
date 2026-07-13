import type { ApiKeyProviderContext } from "../provider-runtime.ts";

import { describe, expect, it, vi } from "vitest";
import { finnhubActionHandlers, validateFinnhubCredential } from "./runtime.ts";

function context(fetcher: typeof fetch): ApiKeyProviderContext {
  return {
    apiKey: "finnhub-key",
    fetcher,
  };
}

describe("Finnhub runtime", () => {
  it("retrieves and normalizes a quote through the fixed quote endpoint", async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
        Response.json({ c: 210.1, d: 1.5, dp: 0.72, h: 211, l: 207, o: 208, pc: 208.6, t: 1_720_000_000 }),
    );

    await expect(finnhubActionHandlers.get_quote({ symbol: "AAPL" }, context(fetcher))).resolves.toEqual({
      symbol: "AAPL",
      currentPrice: 210.1,
      change: 1.5,
      percentChange: 0.72,
      high: 211,
      low: 207,
      open: 208,
      previousClose: 208.6,
      timestamp: 1_720_000_000,
    });

    const url = new URL(String(fetcher.mock.calls[0]?.[0]));
    expect(url.origin + url.pathname).toBe("https://finnhub.io/api/v1/quote");
    expect(Object.fromEntries(url.searchParams)).toEqual({ symbol: "AAPL" });
    const headers = new Headers(fetcher.mock.calls[0]?.[1]?.headers);
    expect(headers.get("x-finnhub-token")).toBe("finnhub-key");
  });

  it("uses the quote action to validate credentials without exposing the key", async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
        Response.json({ c: 210.1, pc: 208.6, t: 1_720_000_000 }),
    );

    await expect(validateFinnhubCredential("finnhub-key", fetcher)).resolves.toMatchObject({
      profile: {
        accountId: "finnhub-api-key",
        displayName: "Finnhub API Key",
      },
      metadata: {
        validationEndpoint: "/quote",
      },
    });
  });

  it("maps Finnhub error payloads returned with HTTP 200", async () => {
    const responses = [{ error: "Invalid API key" }, { error: "API key rate limit exceeded" }];
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => Response.json(responses.shift()),
    );

    await expect(finnhubActionHandlers.get_quote({ symbol: "AAPL" }, context(fetcher))).rejects.toMatchObject({
      status: 401,
      message: "Invalid API key",
    });
    await expect(finnhubActionHandlers.get_quote({ symbol: "AAPL" }, context(fetcher))).rejects.toMatchObject({
      status: 429,
      message: "API key rate limit exceeded",
    });
  });

  it("maps every supported read action to a fixed Finnhub endpoint", async () => {
    const responses: unknown[] = [
      { count: 1, result: [{ symbol: "AAPL" }] },
      { ticker: "AAPL", name: "Apple Inc" },
      { s: "ok", c: [1], h: [2], l: [0.5], o: [0.8], t: [100], v: [10] },
      [{ id: 1, headline: "News" }],
      { metric: { peBasicExclExtraTTM: 30 } },
      { data: [{ year: 2025 }] },
    ];
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => Response.json(responses.shift()),
    );

    await expect(finnhubActionHandlers.search_symbols({ query: "apple" }, context(fetcher))).resolves.toEqual({
      results: [{ symbol: "AAPL" }],
    });
    await expect(finnhubActionHandlers.get_company_profile({ symbol: "AAPL" }, context(fetcher))).resolves.toEqual({
      ticker: "AAPL",
      name: "Apple Inc",
    });
    await expect(
      finnhubActionHandlers.get_stock_candles(
        { symbol: "AAPL", resolution: "D", from: 100, to: 200 },
        context(fetcher),
      ),
    ).resolves.toMatchObject({ status: "ok", close: [1], timestamp: [100] });
    await expect(
      finnhubActionHandlers.get_company_news(
        { symbol: "AAPL", from: "2026-01-01", to: "2026-01-31" },
        context(fetcher),
      ),
    ).resolves.toEqual({ items: [{ id: 1, headline: "News" }] });
    await expect(
      finnhubActionHandlers.get_basic_financials({ symbol: "AAPL", metric: "all" }, context(fetcher)),
    ).resolves.toEqual({ metric: { peBasicExclExtraTTM: 30 } });
    await expect(
      finnhubActionHandlers.get_financials({ symbol: "AAPL", statement: "bs", frequency: "annual" }, context(fetcher)),
    ).resolves.toEqual({ data: [{ year: 2025 }] });

    expect(fetcher.mock.calls.map((call) => new URL(String(call[0])).pathname)).toEqual([
      "/api/v1/search",
      "/api/v1/stock/profile2",
      "/api/v1/stock/candle",
      "/api/v1/company-news",
      "/api/v1/stock/metric",
      "/api/v1/stock/financials",
    ]);
    expect(Object.fromEntries(new URL(String(fetcher.mock.calls[2]?.[0])).searchParams)).toEqual({
      symbol: "AAPL",
      resolution: "D",
      from: "100",
      to: "200",
    });
    for (const call of fetcher.mock.calls) {
      expect(new URL(String(call[0])).searchParams.has("token")).toBe(false);
      expect(new Headers(call[1]?.headers).get("x-finnhub-token")).toBe("finnhub-key");
    }
  });

  it("rejects reversed and overlong market-data ranges before fetching", async () => {
    const fetcher = vi.fn();
    await expect(
      finnhubActionHandlers.get_company_news(
        { symbol: "AAPL", from: "2026-02-01", to: "2026-01-01" },
        context(fetcher),
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      finnhubActionHandlers.get_stock_candles(
        { symbol: "AAPL", resolution: "1", from: 0, to: 32 * 24 * 60 * 60 },
        context(fetcher),
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
