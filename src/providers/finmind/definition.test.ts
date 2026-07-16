import { describe, expect, it } from "vitest";
import { provider } from "./definition.ts";
import * as executorModule from "./executors.ts";

describe("FinMind provider definition", () => {
  it("exposes only the eight curated read-only actions and no proxy", () => {
    expect(provider.actions.map((action) => action.id)).toEqual([
      "finmind.get_stock_prices",
      "finmind.get_stock_valuation",
      "finmind.get_monthly_revenue",
      "finmind.get_institutional_flows",
      "finmind.get_financial_statements",
      "finmind.get_balance_sheet",
      "finmind.get_cash_flow_statement",
      "finmind.get_margin_trading",
    ]);
    expect("proxy" in executorModule).toBe(false);
  });
});
