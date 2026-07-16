import type { CredentialValidationResult } from "../../core/types.ts";
import type { ApiKeyProviderContext } from "../provider-runtime.ts";

import { integer, optionalString, requiredString } from "../../core/cast.ts";
import { requestJson } from "../http-json-runtime.ts";
import { ProviderRequestError } from "../provider-runtime.ts";

const finnhubApiBaseUrl = "https://finnhub.io/api/v1";
type FinnhubActionContext = Pick<ApiKeyProviderContext, "apiKey" | "fetcher" | "signal">;
type FinnhubActionHandler = (input: Record<string, unknown>, context: FinnhubActionContext) => Promise<unknown>;

type FinnhubActionName =
  | "search_symbols"
  | "get_quote"
  | "get_company_profile"
  | "get_basic_financials"
  | "get_financial_reports"
  | "get_stock_candles"
  | "get_company_news";

export const finnhubActionHandlers: Record<FinnhubActionName, FinnhubActionHandler> = {
  search_symbols(input, context) {
    return finnhubGet("/search", { q: requiredInputString(input.query, "query") }, context);
  },
  get_quote(input, context) {
    return finnhubGet("/quote", { symbol: requiredInputString(input.symbol, "symbol") }, context);
  },
  get_company_profile(input, context) {
    return finnhubGet("/stock/profile2", { symbol: requiredInputString(input.symbol, "symbol") }, context);
  },
  get_basic_financials(input, context) {
    return finnhubGet(
      "/stock/metric",
      {
        symbol: requiredInputString(input.symbol, "symbol"),
        metric: optionalString(input.metric) ?? "all",
      },
      context,
    );
  },
  get_financial_reports(input, context) {
    return finnhubGet(
      "/stock/financials-reported",
      {
        symbol: requiredInputString(input.symbol, "symbol"),
        statement: requiredInputString(input.statement, "statement"),
        freq: requiredInputString(input.frequency, "frequency"),
      },
      context,
    );
  },
  get_stock_candles(input, context) {
    return finnhubGet(
      "/stock/candle",
      {
        symbol: requiredInputString(input.symbol, "symbol"),
        resolution: requiredInputString(input.resolution, "resolution"),
        from: String(requiredInputInteger(input.from, "from")),
        to: String(requiredInputInteger(input.to, "to")),
      },
      context,
    );
  },
  get_company_news(input, context) {
    return finnhubGet(
      "/company-news",
      {
        symbol: requiredInputString(input.symbol, "symbol"),
        from: requiredInputString(input.startDate, "startDate"),
        to: requiredInputString(input.endDate, "endDate"),
      },
      context,
    );
  },
};

export async function validateFinnhubCredential(
  input: { apiKey: string },
  context: { fetcher: typeof fetch; signal?: AbortSignal },
): Promise<CredentialValidationResult> {
  await finnhubGet(
    "/quote",
    { symbol: "AAPL" },
    { apiKey: input.apiKey, fetcher: context.fetcher, signal: context.signal },
  );
  return {
    profile: { accountId: "finnhub", displayName: "Finnhub API Key" },
    grantedScopes: [],
    metadata: { apiBaseUrl: finnhubApiBaseUrl, validationEndpoint: "/quote" },
  };
}

function finnhubGet(path: string, query: Record<string, string>, context: FinnhubActionContext): Promise<unknown> {
  return requestJson({
    providerName: "Finnhub",
    baseUrl: finnhubApiBaseUrl,
    path,
    fetcher: context.fetcher,
    signal: context.signal,
    query: { ...query, token: context.apiKey },
    maxResponseBytes: 5_242_880,
  });
}

function requiredInputString(value: unknown, fieldName: string): string {
  return requiredString(value, fieldName, (message) => new ProviderRequestError(400, message));
}

function requiredInputInteger(value: unknown, fieldName: string): number {
  return integer(value, fieldName, (message) => new ProviderRequestError(400, message));
}
