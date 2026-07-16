import type { ActionDefinition } from "../../core/types.ts";

import { s } from "../../core/json-schema.ts";
import { defineProviderAction } from "../../core/provider-definition.ts";

const service = "finnhub";
const symbolSchema = s.nonEmptyString("Global stock symbol, for example AAPL.");
const unknownOutput = s.unknown("The documented Finnhub response payload.");

export const finnhubActions: ActionDefinition[] = [
  defineProviderAction(service, {
    name: "search_symbols",
    description: "Search global stock symbols through Finnhub.",
    inputSchema: s.actionInput({ query: s.nonEmptyString("Company name or symbol search query.") }, ["query"]),
    outputSchema: unknownOutput,
  }),
  defineProviderAction(service, {
    name: "get_quote",
    description: "Get the current Finnhub quote for a global stock symbol.",
    inputSchema: s.actionInput({ symbol: symbolSchema }, ["symbol"]),
    outputSchema: unknownOutput,
  }),
  defineProviderAction(service, {
    name: "get_company_profile",
    description: "Get the Finnhub company profile for a global stock symbol.",
    inputSchema: s.actionInput({ symbol: symbolSchema }, ["symbol"]),
    outputSchema: unknownOutput,
  }),
  defineProviderAction(service, {
    name: "get_basic_financials",
    description: "Get Finnhub basic financial metrics for a global stock symbol.",
    inputSchema: s.actionInput(
      {
        symbol: symbolSchema,
        metric: s.nonEmptyString("Finnhub metric group; defaults to all."),
      },
      ["symbol"],
    ),
    outputSchema: unknownOutput,
  }),
  defineProviderAction(service, {
    name: "get_financial_reports",
    description: "Get standardized financial reports from Finnhub.",
    inputSchema: s.actionInput(
      {
        symbol: symbolSchema,
        statement: s.stringEnum("Statement type.", ["bs", "ic", "cf"]),
        frequency: s.stringEnum("Reporting frequency.", ["annual", "quarterly"]),
      },
      ["symbol", "statement", "frequency"],
    ),
    outputSchema: unknownOutput,
  }),
  defineProviderAction(service, {
    name: "get_stock_candles",
    description: "Get historical stock candles from Finnhub.",
    inputSchema: s.actionInput(
      {
        symbol: symbolSchema,
        resolution: s.stringEnum("Candle resolution.", ["1", "5", "15", "30", "60", "D", "W", "M"]),
        from: s.nonNegativeInteger("Inclusive start time as a Unix timestamp."),
        to: s.nonNegativeInteger("Inclusive end time as a Unix timestamp."),
      },
      ["symbol", "resolution", "from", "to"],
    ),
    outputSchema: unknownOutput,
  }),
  defineProviderAction(service, {
    name: "get_company_news",
    description: "Get dated company news from Finnhub.",
    inputSchema: s.actionInput(
      {
        symbol: symbolSchema,
        startDate: s.date("Inclusive start date in YYYY-MM-DD format."),
        endDate: s.date("Inclusive end date in YYYY-MM-DD format."),
      },
      ["symbol", "startDate", "endDate"],
    ),
    outputSchema: unknownOutput,
  }),
];
