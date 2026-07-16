import type { ActionDefinition } from "../../core/types.ts";

import { s } from "../../core/json-schema.ts";
import { defineProviderAction } from "../../core/provider-definition.ts";

const service = "finmind";
const datasetInputSchema = s.object(
  "Input parameters for one fixed FinMind Taiwan-stock dataset.",
  {
    stockId: s.nonEmptyString("Taiwan security identifier, for example 2330."),
    startDate: s.date("Inclusive start date in YYYY-MM-DD format."),
    endDate: s.date("Optional inclusive end date in YYYY-MM-DD format."),
  },
  { optional: ["endDate"] },
);
const datasetOutputSchema = s.array(
  "Rows returned by the fixed FinMind dataset.",
  s.unknownObject("One FinMind dataset row."),
);

const actionDescriptions = [
  ["get_stock_prices", "Get historical Taiwan stock prices from FinMind."],
  ["get_stock_valuation", "Get historical Taiwan stock valuation metrics from FinMind."],
  ["get_monthly_revenue", "Get historical Taiwan company monthly revenue from FinMind."],
  ["get_institutional_flows", "Get Taiwan institutional investor trading flows from FinMind."],
  ["get_financial_statements", "Get Taiwan company income-statement rows from FinMind."],
  ["get_balance_sheet", "Get Taiwan company balance-sheet rows from FinMind."],
  ["get_cash_flow_statement", "Get Taiwan company cash-flow rows from FinMind."],
  ["get_margin_trading", "Get Taiwan margin-purchase and short-sale rows from FinMind."],
] as const;

export const finmindActions: ActionDefinition[] = actionDescriptions.map(([name, description]) =>
  defineProviderAction(service, {
    name,
    description,
    inputSchema: datasetInputSchema,
    outputSchema: datasetOutputSchema,
  }),
);
