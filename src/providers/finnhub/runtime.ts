import type { QueryValue } from "../../core/request.ts";
import type { CredentialValidationResult } from "../../core/types.ts";
import type { ApiKeyProviderContext } from "../provider-runtime.ts";

import { arrayPayload, objectPayload, requestJson } from "../http-json-runtime.ts";
import { ProviderRequestError } from "../provider-runtime.ts";

export const finnhubApiBaseUrl = "https://finnhub.io/api/v1";
const finnhubMaxResponseBytes = 5_242_880;

type FinnhubActionHandler = (input: Record<string, unknown>, context: ApiKeyProviderContext) => Promise<unknown>;

export const finnhubActionHandlers: Record<string, FinnhubActionHandler> = {
  search_symbols(input, context) {
    return executeSymbolSearch(input, context);
  },
  get_quote(input, context) {
    return executeQuote(input, context);
  },
  get_company_profile(input, context) {
    return finnhubGetObject("/stock/profile2", { symbol: readRequiredString(input, "symbol").toUpperCase() }, context);
  },
  get_stock_candles(input, context) {
    return executeStockCandles(input, context);
  },
  get_company_news(input, context) {
    return executeCompanyNews(input, context);
  },
  get_basic_financials(input, context) {
    return finnhubGetObject(
      "/stock/metric",
      {
        symbol: readRequiredString(input, "symbol").toUpperCase(),
        metric: readOptionalString(input.metric) ?? "all",
      },
      context,
    );
  },
  get_financials(input, context) {
    return finnhubGet(
      "/stock/financials",
      {
        symbol: readRequiredString(input, "symbol").toUpperCase(),
        statement: readRequiredString(input, "statement"),
        freq: readRequiredString(input, "frequency"),
      },
      context,
    );
  },
};

export async function validateFinnhubCredential(
  apiKey: string,
  fetcher: typeof fetch,
  signal?: AbortSignal,
): Promise<CredentialValidationResult> {
  await executeQuote({ symbol: "AAPL" }, { apiKey, fetcher, signal });
  return {
    profile: {
      accountId: "finnhub-api-key",
      displayName: "Finnhub API Key",
    },
    grantedScopes: [],
    metadata: {
      apiBaseUrl: finnhubApiBaseUrl,
      validationEndpoint: "/quote",
    },
  };
}

async function executeSymbolSearch(input: Record<string, unknown>, context: ApiKeyProviderContext): Promise<unknown> {
  const payload = await finnhubGetObject("/search", { q: readRequiredString(input, "query") }, context);
  return { results: readRequiredArray(payload.result, "Finnhub search result") };
}

async function executeQuote(input: Record<string, unknown>, context: ApiKeyProviderContext): Promise<unknown> {
  const symbol = readRequiredString(input, "symbol").toUpperCase();
  const payload = await finnhubGetObject("/quote", { symbol }, context);
  return {
    symbol,
    currentPrice: readOptionalNumber(payload.c),
    change: readOptionalNumber(payload.d),
    percentChange: readOptionalNumber(payload.dp),
    high: readOptionalNumber(payload.h),
    low: readOptionalNumber(payload.l),
    open: readOptionalNumber(payload.o),
    previousClose: readOptionalNumber(payload.pc),
    timestamp: readOptionalNumber(payload.t),
  };
}

async function executeStockCandles(input: Record<string, unknown>, context: ApiKeyProviderContext): Promise<unknown> {
  const resolution = readRequiredString(input, "resolution");
  const from = readRequiredInteger(input, "from");
  const to = readRequiredInteger(input, "to");
  validateCandleRange(resolution, from, to);
  const payload = await finnhubGetObject(
    "/stock/candle",
    {
      symbol: readRequiredString(input, "symbol").toUpperCase(),
      resolution,
      from,
      to,
    },
    context,
  );
  return {
    status: readRequiredString(payload, "s"),
    open: payload.o,
    high: payload.h,
    low: payload.l,
    close: payload.c,
    volume: payload.v,
    timestamp: payload.t,
  };
}

async function executeCompanyNews(input: Record<string, unknown>, context: ApiKeyProviderContext): Promise<unknown> {
  const from = readRequiredString(input, "from");
  const to = readRequiredString(input, "to");
  validateIsoDateRange(from, to, 366);
  const payload = await finnhubGet(
    "/company-news",
    {
      symbol: readRequiredString(input, "symbol").toUpperCase(),
      from,
      to,
    },
    context,
  );
  return { items: arrayPayload(payload, "Finnhub company news") };
}

async function finnhubGetObject(
  path: string,
  query: Record<string, QueryValue>,
  context: ApiKeyProviderContext,
): Promise<Record<string, unknown>> {
  return objectPayload(await finnhubGet(path, query, context), `Finnhub ${path}`);
}

async function finnhubGet(
  path: string,
  query: Record<string, QueryValue>,
  context: ApiKeyProviderContext,
): Promise<unknown> {
  const payload = await requestJson({
    providerName: "Finnhub",
    baseUrl: finnhubApiBaseUrl,
    path,
    fetcher: context.fetcher,
    signal: context.signal,
    headers: { "x-finnhub-token": context.apiKey },
    query,
    maxResponseBytes: finnhubMaxResponseBytes,
  });
  const providerError =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? readOptionalString((payload as Record<string, unknown>).error)
      : undefined;
  if (providerError) {
    throw new ProviderRequestError(mapFinnhubErrorStatus(providerError), providerError);
  }
  return payload;
}

function mapFinnhubErrorStatus(message: string): number {
  const lowered = message.toLowerCase();
  if (lowered.includes("rate") || lowered.includes("limit") || lowered.includes("quota")) {
    return 429;
  }
  if (lowered.includes("api key") || lowered.includes("token") || lowered.includes("auth")) {
    return 401;
  }
  if (lowered.includes("permission") || lowered.includes("access denied") || lowered.includes("plan")) {
    return 403;
  }
  if (lowered.includes("invalid") || lowered.includes("parameter") || lowered.includes("symbol")) {
    return 400;
  }
  return 502;
}

function validateCandleRange(resolution: string, from: number, to: number): void {
  const intradayResolutions = new Set(["1", "5", "15", "30", "60"]);
  const longRangeResolutions = new Set(["D", "W", "M"]);
  if (!intradayResolutions.has(resolution) && !longRangeResolutions.has(resolution)) {
    throw new ProviderRequestError(400, "resolution is not supported");
  }
  if (from < 0 || to < 0 || from > to) {
    throw new ProviderRequestError(400, "from must not be after to");
  }
  const maxDays = intradayResolutions.has(resolution) ? 31 : 3_660;
  const daySeconds = 24 * 60 * 60;
  if (to - from > maxDays * daySeconds) {
    throw new ProviderRequestError(400, `candle range must not exceed ${maxDays} days`);
  }
  if (to > Math.floor(Date.now() / 1_000) + daySeconds) {
    throw new ProviderRequestError(400, "to must not be in the future");
  }
}

function validateIsoDateRange(from: string, to: string, maxDays: number): void {
  const start = parseIsoDate(from, "from");
  const end = parseIsoDate(to, "to");
  const dayMs = 24 * 60 * 60 * 1_000;
  if (start > end) {
    throw new ProviderRequestError(400, "from must not be after to");
  }
  if ((end - start) / dayMs > maxDays) {
    throw new ProviderRequestError(400, `date range must not exceed ${maxDays} days`);
  }
  if (end > Date.now() + dayMs) {
    throw new ProviderRequestError(400, "to must not be in the future");
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

function readRequiredInteger(input: Record<string, unknown>, key: string): number {
  const value = input[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new ProviderRequestError(400, `${key} must be an integer`);
  }
  return value;
}

function readRequiredArray(value: unknown, fieldName: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new ProviderRequestError(502, `${fieldName} must be an array`);
  }
  return value;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
