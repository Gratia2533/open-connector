import { describe, expect, it, vi } from "vitest";
import { finmindActionHandlers, validateFinMindCredential } from "./runtime.ts";

describe("FinMind provider runtime", () => {
  it("executes the fixed stock-price dataset with bearer authentication", async () => {
    const fetcher = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.origin + url.pathname).toBe("https://api.finmindtrade.com/api/v4/data");
      expect(url.searchParams.get("dataset")).toBe("TaiwanStockPrice");
      expect(url.searchParams.get("data_id")).toBe("2330");
      expect(url.searchParams.get("start_date")).toBe("2026-07-01");
      expect(url.searchParams.get("end_date")).toBe("2026-07-15");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer finmind-secret");
      return new Response(JSON.stringify({ status: 200, data: [{ stock_id: "2330" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const result = await finmindActionHandlers.get_stock_prices(
      { stockId: "2330", startDate: "2026-07-01", endDate: "2026-07-15" },
      { apiKey: "finmind-secret", fetcher },
    );

    expect(result).toEqual([{ stock_id: "2330" }]);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([
    ["get_stock_valuation", "TaiwanStockPER"],
    ["get_monthly_revenue", "TaiwanStockMonthRevenue"],
    ["get_institutional_flows", "TaiwanStockInstitutionalInvestorsBuySell"],
    ["get_financial_statements", "TaiwanStockFinancialStatements"],
    ["get_balance_sheet", "TaiwanStockBalanceSheet"],
    ["get_cash_flow_statement", "TaiwanStockCashFlowsStatement"],
    ["get_margin_trading", "TaiwanStockMarginPurchaseShortSale"],
  ] as const)("maps %s to the fixed %s dataset", async (action, expectedDataset) => {
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      expect(new URL(String(input)).searchParams.get("dataset")).toBe(expectedDataset);
      return new Response(JSON.stringify({ status: 200, data: [] }), { status: 200 });
    });

    await finmindActionHandlers[action](
      { stockId: "2330", startDate: "2026-07-01" },
      { apiKey: "finmind-secret", fetcher },
    );
  });

  it("validates credentials with a fixed TaiwanStockInfo probe", async () => {
    const fetcher = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("dataset")).toBe("TaiwanStockInfo");
      expect(url.searchParams.get("data_id")).toBe("2330");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer finmind-secret");
      return new Response(JSON.stringify({ status: 200, data: [{ stock_id: "2330" }] }), {
        status: 200,
      });
    });

    const result = await validateFinMindCredential({ apiKey: "finmind-secret" }, { fetcher });

    expect(result.profile).toEqual({ accountId: "finmind", displayName: "FinMind API Token" });
  });
});
