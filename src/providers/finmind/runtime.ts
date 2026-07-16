import type { CredentialValidationResult } from "../../core/types.ts";
import type { ApiKeyProviderContext } from "../provider-runtime.ts";

import { objectPayload, requestJson } from "../http-json-runtime.ts";
import { ProviderRequestError } from "../provider-runtime.ts";

export const finmindApiBaseUrl = "https://api.finmindtrade.com/api/v4";
const finmindMaxResponseBytes = 5_242_880;

const datasets = {
  get_stock_prices: "TaiwanStockPrice",
  get_stock_valuation: "TaiwanStockPER",
  get_monthly_revenue: "TaiwanStockMonthRevenue",
  get_institutional_flows: "TaiwanStockInstitutionalInvestorsBuySell",
  get_financial_statements: "TaiwanStockFinancialStatements",
  get_balance_sheet: "TaiwanStockBalanceSheet",
  get_cash_flow_statement: "TaiwanStockCashFlowsStatement",
  get_margin_trading: "TaiwanStockMarginPurchaseShortSale",
} as const;

export type FinmindActionName = keyof typeof datasets;
type FinmindActionHandler = (input: Record<string, unknown>, context: ApiKeyProviderContext) => Promise<unknown>;

export const finmindActionHandlers: Record<FinmindActionName, FinmindActionHandler> = Object.fromEntries(
  Object.entries(datasets).map(([actionName, dataset]) => [
    actionName,
    (input: Record<string, unknown>, context: ApiKeyProviderContext) => executeDataset(dataset, input, context),
  ]),
) as Record<FinmindActionName, FinmindActionHandler>;

export async function validateFinmindCredential(
  apiKey: string,
  fetcher: typeof fetch,
  signal?: AbortSignal,
): Promise<CredentialValidationResult> {
  await requestDataset(
    "TaiwanStockInfo",
    { data_id: "2330" },
    {
      apiKey,
      fetcher,
      signal,
    },
  );
  return {
    profile: {
      accountId: "finmind-api-token",
      displayName: "FinMind API Token",
    },
    grantedScopes: [],
    metadata: {
      apiBaseUrl: finmindApiBaseUrl,
      validationDataset: "TaiwanStockInfo",
    },
  };
}

async function executeDataset(
  dataset: (typeof datasets)[FinmindActionName],
  input: Record<string, unknown>,
  context: ApiKeyProviderContext,
): Promise<unknown> {
  const startDate = readRequiredString(input, "startDate");
  const endDate = readOptionalString(input.endDate);
  validateDateRange(startDate, endDate, 3_660);
  return requestDataset(
    dataset,
    {
      data_id: readRequiredString(input, "stockId"),
      start_date: startDate,
      end_date: endDate,
    },
    context,
  );
}

async function requestDataset(
  dataset: string,
  query: Record<string, string | undefined>,
  context: ApiKeyProviderContext,
): Promise<unknown[]> {
  const payload = objectPayload(
    await requestJson({
      providerName: "FinMind",
      baseUrl: finmindApiBaseUrl,
      path: "/data",
      fetcher: context.fetcher,
      signal: context.signal,
      headers: { authorization: `Bearer ${context.apiKey}` },
      query: { dataset, ...query },
      maxResponseBytes: finmindMaxResponseBytes,
    }),
    `FinMind ${dataset}`,
  );
  if (payload.status !== 200) {
    const message = readOptionalString(payload.msg) ?? `FinMind ${dataset} request failed`;
    throw new ProviderRequestError(mapFinmindStatus(payload.status, message), message, payload);
  }
  if (!Array.isArray(payload.data)) {
    throw new ProviderRequestError(502, `FinMind ${dataset} data must be an array`, payload);
  }
  return payload.data;
}

function mapFinmindStatus(status: unknown, message: string): number {
  if (status === 401 || status === 402 || status === 403) {
    return 401;
  }
  if (status === 429) {
    return 429;
  }
  if (status === 400 || status === 404 || status === 422) {
    return 400;
  }
  const lowered = message.toLowerCase();
  if (lowered.includes("rate") || lowered.includes("limit") || lowered.includes("quota")) {
    return 429;
  }
  if (lowered.includes("token") || lowered.includes("auth")) {
    return 401;
  }
  return 502;
}

function validateDateRange(startDate: string, endDate: string | undefined, maxDays: number): void {
  const start = parseIsoDate(startDate, "startDate");
  const effectiveEnd = endDate ?? new Date().toISOString().slice(0, 10);
  const end = parseIsoDate(effectiveEnd, "endDate");
  const dayMs = 24 * 60 * 60 * 1_000;
  if (start > end) {
    throw new ProviderRequestError(400, "startDate must not be after endDate");
  }
  if ((end - start) / dayMs > maxDays) {
    throw new ProviderRequestError(400, `date range must not exceed ${maxDays} days`);
  }
  if (end > Date.now() + dayMs) {
    throw new ProviderRequestError(400, "endDate must not be in the future");
  }
}

function parseIsoDate(value: string, fieldName: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ProviderRequestError(400, `${fieldName} must use YYYY-MM-DD`);
  }
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) {
    throw new ProviderRequestError(400, `${fieldName} must be a valid date`);
  }
  return parsed;
}

function readRequiredString(input: Record<string, unknown>, key: string): string {
  const value = readOptionalString(input[key]);
  if (!value) {
    throw new ProviderRequestError(400, `${key} is required`);
  }
  return value;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
