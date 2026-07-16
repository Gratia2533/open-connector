import { describe, expect, it } from "vitest";
import { provider } from "./definition.ts";
import * as executorModule from "./executors.ts";

describe("Finnhub provider definition", () => {
  it("exposes only the seven curated read-only actions and no proxy", () => {
    expect(provider.actions.map((action) => action.id)).toEqual([
      "finnhub.search_symbols",
      "finnhub.get_quote",
      "finnhub.get_company_profile",
      "finnhub.get_basic_financials",
      "finnhub.get_financial_reports",
      "finnhub.get_stock_candles",
      "finnhub.get_company_news",
    ]);
    expect("proxy" in executorModule).toBe(false);
  });
});
