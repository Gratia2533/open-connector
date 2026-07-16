import type { ActionDefinition } from "../../core/types.ts";

import { s } from "../../core/json-schema.ts";
import { defineProviderAction } from "../../core/provider-definition.ts";

const service = "finnhub";
const symbolInput = s.actionInput(
  { symbol: s.nonEmptyString("The global stock symbol, such as AAPL.") },
  ["symbol"],
  "Input for one Finnhub stock symbol.",
);
const providerObject = s.unknown("The documented object returned by Finnhub for this action.");

export const finnhubActions: ActionDefinition[] = [
  defineProviderAction(service, {
    name: "search_symbols",
    description: "Search Finnhub for global stock symbols matching a company name or ticker fragment.",
    inputSchema: s.actionInput(
      { query: s.nonEmptyString("The company name or ticker fragment to search.") },
      ["query"],
      "Input for searching Finnhub symbols.",
    ),
    outputSchema: s.object("The Finnhub symbol search result.", {
      results: s.array("Matching symbols.", s.unknown("One Finnhub symbol match.")),
    }),
  }),
  defineProviderAction(service, {
    name: "get_quote",
    description: "Retrieve the latest Finnhub quote for one global stock symbol.",
    inputSchema: symbolInput,
    outputSchema: s.object(
      "A normalized Finnhub quote.",
      {
        symbol: s.string("The normalized stock symbol."),
        currentPrice: s.number("The latest price."),
        change: s.number("The absolute price change."),
        percentChange: s.number("The percentage price change."),
        high: s.number("The session high."),
        low: s.number("The session low."),
        open: s.number("The session open."),
        previousClose: s.number("The previous close."),
        timestamp: s.integer("The quote Unix timestamp."),
      },
      { optional: ["currentPrice", "change", "percentChange", "high", "low", "open", "previousClose", "timestamp"] },
    ),
  }),
  defineProviderAction(service, {
    name: "get_company_profile",
    description: "Retrieve the Finnhub company profile for one global stock symbol.",
    inputSchema: symbolInput,
    outputSchema: providerObject,
  }),
  defineProviderAction(service, {
    name: "get_stock_candles",
    description: "Retrieve Finnhub OHLCV candles for one stock symbol and bounded Unix timestamp range.",
    inputSchema: s.actionInput(
      {
        symbol: s.nonEmptyString("The global stock symbol."),
        resolution: s.stringEnum("The Finnhub candle resolution.", ["1", "5", "15", "30", "60", "D", "W", "M"]),
        from: s.nonNegativeInteger("The inclusive start Unix timestamp."),
        to: s.nonNegativeInteger("The inclusive end Unix timestamp."),
      },
      ["symbol", "resolution", "from", "to"],
      "Input for a bounded Finnhub candle request.",
    ),
    outputSchema: providerObject,
  }),
  defineProviderAction(service, {
    name: "get_company_news",
    description: "Retrieve Finnhub company news for one symbol and bounded date range.",
    inputSchema: s.actionInput(
      {
        symbol: s.nonEmptyString("The global stock symbol."),
        from: s.date("The inclusive start date."),
        to: s.date("The inclusive end date."),
      },
      ["symbol", "from", "to"],
      "Input for bounded Finnhub company news.",
    ),
    outputSchema: s.object("Finnhub company news results.", {
      items: s.array("Company news items.", s.unknown("One Finnhub company news item.")),
    }),
  }),
  defineProviderAction(service, {
    name: "get_basic_financials",
    description: "Retrieve Finnhub basic financial metrics for one stock symbol.",
    inputSchema: s.actionInput(
      {
        symbol: s.nonEmptyString("The global stock symbol."),
        metric: s.nonEmptyString("The Finnhub metric set, normally all."),
      },
      ["symbol"],
      "Input for Finnhub basic financial metrics.",
    ),
    outputSchema: providerObject,
  }),
  defineProviderAction(service, {
    name: "get_financials",
    description: "Retrieve Finnhub standardized financial statements for one stock symbol.",
    inputSchema: s.actionInput(
      {
        symbol: s.nonEmptyString("The global stock symbol."),
        statement: s.stringEnum("The financial statement type.", ["bs", "ic", "cf"]),
        frequency: s.stringEnum("The reporting frequency.", ["annual", "quarterly"]),
      },
      ["symbol", "statement", "frequency"],
      "Input for Finnhub standardized financial statements.",
    ),
    outputSchema: providerObject,
  }),
];
