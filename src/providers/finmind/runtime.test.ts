import type { ApiKeyProviderContext } from "../provider-runtime.ts";

import { describe, expect, it, vi } from "vitest";
import { finmindActionHandlers, validateFinmindCredential } from "./runtime.ts";

function context(fetcher: typeof fetch): ApiKeyProviderContext {
  return {
    apiKey: "finmind-token",
    fetcher,
  };
}

describe("FinMind runtime", () => {
  it("retrieves stock prices through the fixed TaiwanStockPrice dataset", async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
        Response.json({ status: 200, data: [{ stock_id: "2330", date: "2026-01-02", close: 1000 }] }),
    );

    await expect(
      finmindActionHandlers.get_stock_prices(
        { stockId: "2330", startDate: "2026-01-01", endDate: "2026-01-31" },
        context(fetcher),
      ),
    ).resolves.toEqual([{ stock_id: "2330", date: "2026-01-02", close: 1000 }]);

    const [input, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
    const url = new URL(String(input));
    expect(url.origin + url.pathname).toBe("https://api.finmindtrade.com/api/v4/data");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      dataset: "TaiwanStockPrice",
      data_id: "2330",
      start_date: "2026-01-01",
      end_date: "2026-01-31",
    });
    expect(init.headers).toMatchObject({ authorization: "Bearer finmind-token" });
  });

  it("maps every supported action to a fixed FinMind dataset", async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
        Response.json({ status: 200, data: [] }),
    );
    const input = { stockId: "2330", startDate: "2026-01-01", endDate: "2026-01-31" };

    await finmindActionHandlers.get_stock_valuation(input, context(fetcher));
    await finmindActionHandlers.get_monthly_revenue(input, context(fetcher));
    await finmindActionHandlers.get_institutional_flows(input, context(fetcher));
    await finmindActionHandlers.get_financial_statements(input, context(fetcher));
    await finmindActionHandlers.get_balance_sheet(input, context(fetcher));
    await finmindActionHandlers.get_cash_flow_statement(input, context(fetcher));
    await finmindActionHandlers.get_margin_trading(input, context(fetcher));

    expect(fetcher.mock.calls.map((call) => new URL(String(call[0])).searchParams.get("dataset"))).toEqual([
      "TaiwanStockPER",
      "TaiwanStockMonthRevenue",
      "TaiwanStockInstitutionalInvestorsBuySell",
      "TaiwanStockFinancialStatements",
      "TaiwanStockBalanceSheet",
      "TaiwanStockCashFlowsStatement",
      "TaiwanStockMarginPurchaseShortSale",
    ]);
  });

  it("validates credentials without returning the token", async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
        Response.json({ status: 200, data: [{ stock_id: "2330" }] }),
    );

    await expect(validateFinmindCredential("finmind-token", fetcher)).resolves.toMatchObject({
      profile: {
        accountId: "finmind-api-token",
        displayName: "FinMind API Token",
      },
      metadata: {
        validationDataset: "TaiwanStockInfo",
      },
    });
  });

  it("maps FinMind status errors", async () => {
    const responses = [
      { status: 402, msg: "Invalid token", data: [] },
      { status: 429, msg: "Rate limit exceeded", data: [] },
      { status: 400, msg: "Invalid date range", data: [] },
    ];
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => Response.json(responses.shift()),
    );

    await expect(
      finmindActionHandlers.get_stock_prices({ stockId: "2330", startDate: "2026-01-01" }, context(fetcher)),
    ).rejects.toMatchObject({ status: 401, message: "Invalid token" });
    await expect(
      finmindActionHandlers.get_stock_prices({ stockId: "2330", startDate: "2026-01-01" }, context(fetcher)),
    ).rejects.toMatchObject({ status: 429, message: "Rate limit exceeded" });
    await expect(
      finmindActionHandlers.get_stock_prices({ stockId: "2330", startDate: "2026-01-01" }, context(fetcher)),
    ).rejects.toMatchObject({ status: 400, message: "Invalid date range" });
  });

  it("rejects reversed and overlong date ranges before fetching", async () => {
    const fetcher = vi.fn();
    await expect(
      finmindActionHandlers.get_stock_prices(
        { stockId: "2330", startDate: "2026-02-01", endDate: "2026-01-01" },
        context(fetcher),
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      finmindActionHandlers.get_stock_prices(
        { stockId: "2330", startDate: "2010-01-01", endDate: "2026-01-01" },
        context(fetcher),
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
