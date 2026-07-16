import type { CredentialValidationResult } from "../../core/types.ts";
import type { ApiKeyProviderContext } from "../provider-runtime.ts";

import { optionalString, requiredString } from "../../core/cast.ts";
import { requestJson } from "../http-json-runtime.ts";
import { ProviderRequestError } from "../provider-runtime.ts";

const finmindApiBaseUrl = "https://api.finmindtrade.com/api/v4";

type FinMindActionContext = Pick<ApiKeyProviderContext, "apiKey" | "fetcher" | "signal">;
type FinMindActionHandler = (input: Record<string, unknown>, context: FinMindActionContext) => Promise<unknown>;

type FinMindActionName =
  | "get_stock_prices"
  | "get_stock_valuation"
  | "get_monthly_revenue"
  | "get_institutional_flows"
  | "get_financial_statements"
  | "get_balance_sheet"
  | "get_cash_flow_statement"
  | "get_margin_trading";

export const finmindActionHandlers: Record<FinMindActionName, FinMindActionHandler> = {
  get_stock_prices(input, context) {
    return fetchDataset("TaiwanStockPrice", input, context);
  },
  get_stock_valuation(input, context) {
    return fetchDataset("TaiwanStockPER", input, context);
  },
  get_monthly_revenue(input, context) {
    return fetchDataset("TaiwanStockMonthRevenue", input, context);
  },
  get_institutional_flows(input, context) {
    return fetchDataset("TaiwanStockInstitutionalInvestorsBuySell", input, context);
  },
  get_financial_statements(input, context) {
    return fetchDataset("TaiwanStockFinancialStatements", input, context);
  },
  get_balance_sheet(input, context) {
    return fetchDataset("TaiwanStockBalanceSheet", input, context);
  },
  get_cash_flow_statement(input, context) {
    return fetchDataset("TaiwanStockCashFlowsStatement", input, context);
  },
  get_margin_trading(input, context) {
    return fetchDataset("TaiwanStockMarginPurchaseShortSale", input, context);
  },
};

export async function validateFinMindCredential(
  input: { apiKey: string },
  context: { fetcher: typeof fetch; signal?: AbortSignal },
): Promise<CredentialValidationResult> {
  const payload = await requestJson({
    providerName: "FinMind",
    baseUrl: finmindApiBaseUrl,
    path: "/data",
    fetcher: context.fetcher,
    signal: context.signal,
    headers: { authorization: `Bearer ${input.apiKey}` },
    query: { dataset: "TaiwanStockInfo", data_id: "2330" },
    phase: "validate",
    maxResponseBytes: 5_242_880,
  });
  if (!isRecord(payload) || payload.status !== 200 || !Array.isArray(payload.data)) {
    throw new ProviderRequestError(400, "FinMind rejected the API token");
  }
  return {
    profile: { accountId: "finmind", displayName: "FinMind API Token" },
    grantedScopes: [],
    metadata: { apiBaseUrl: finmindApiBaseUrl, validationDataset: "TaiwanStockInfo" },
  };
}

async function fetchDataset(
  dataset: string,
  input: Record<string, unknown>,
  context: FinMindActionContext,
): Promise<unknown[]> {
  const payload = await requestJson({
    providerName: "FinMind",
    baseUrl: finmindApiBaseUrl,
    path: "/data",
    fetcher: context.fetcher,
    signal: context.signal,
    headers: { authorization: `Bearer ${context.apiKey}` },
    query: {
      dataset,
      data_id: requiredInputString(input.stockId, "stockId"),
      start_date: requiredInputString(input.startDate, "startDate"),
      end_date: optionalString(input.endDate),
    },
    maxResponseBytes: 5_242_880,
  });
  if (!isRecord(payload) || payload.status !== 200 || !Array.isArray(payload.data)) {
    throw new ProviderRequestError(502, "FinMind returned an invalid dataset response");
  }
  return payload.data;
}

function requiredInputString(value: unknown, fieldName: string): string {
  return requiredString(value, fieldName, (message) => new ProviderRequestError(400, message));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
