import { describe, expect, it, vi } from "vitest";
import { finnhubActionHandlers, validateFinnhubCredential } from "./runtime.ts";

describe("Finnhub provider runtime", () => {
  it("executes the fixed quote endpoint with token authentication", async () => {
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      expect(url.origin + url.pathname).toBe("https://finnhub.io/api/v1/quote");
      expect(url.searchParams.get("symbol")).toBe("AAPL");
      expect(url.searchParams.get("token")).toBe("finnhub-secret");
      return new Response(JSON.stringify({ c: 215.3 }), { status: 200 });
    });

    const result = await finnhubActionHandlers.get_quote({ symbol: "AAPL" }, { apiKey: "finnhub-secret", fetcher });

    expect(result).toEqual({ c: 215.3 });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([
    ["search_symbols", "/api/v1/search", { query: "Apple" }, { q: "Apple" }],
    ["get_company_profile", "/api/v1/stock/profile2", { symbol: "AAPL" }, { symbol: "AAPL" }],
    [
      "get_basic_financials",
      "/api/v1/stock/metric",
      { symbol: "AAPL", metric: "all" },
      { symbol: "AAPL", metric: "all" },
    ],
    [
      "get_financial_reports",
      "/api/v1/stock/financials-reported",
      { symbol: "AAPL", statement: "bs", frequency: "annual" },
      { symbol: "AAPL", statement: "bs", freq: "annual" },
    ],
    [
      "get_stock_candles",
      "/api/v1/stock/candle",
      { symbol: "AAPL", resolution: "D", from: 100, to: 200 },
      { symbol: "AAPL", resolution: "D", from: "100", to: "200" },
    ],
    [
      "get_company_news",
      "/api/v1/company-news",
      { symbol: "AAPL", startDate: "2026-07-01", endDate: "2026-07-15" },
      { symbol: "AAPL", from: "2026-07-01", to: "2026-07-15" },
    ],
  ] as const)("maps %s to the fixed endpoint", async (action, expectedPath, input, expectedQuery) => {
    const fetcher = vi.fn(async (request: URL | RequestInfo) => {
      const url = new URL(String(request));
      expect(url.pathname).toBe(expectedPath);
      for (const [key, value] of Object.entries(expectedQuery)) {
        expect(url.searchParams.get(key)).toBe(value);
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    await finnhubActionHandlers[action](input, { apiKey: "finnhub-secret", fetcher });
  });

  it("validates credentials with a fixed AAPL quote probe", async () => {
    const fetcher = vi.fn(async (request: URL | RequestInfo) => {
      const url = new URL(String(request));
      expect(url.pathname).toBe("/api/v1/quote");
      expect(url.searchParams.get("symbol")).toBe("AAPL");
      return new Response(JSON.stringify({ c: 215.3 }), { status: 200 });
    });

    const result = await validateFinnhubCredential({ apiKey: "finnhub-secret" }, { fetcher });

    expect(result.profile).toEqual({ accountId: "finnhub", displayName: "Finnhub API Key" });
  });
});
