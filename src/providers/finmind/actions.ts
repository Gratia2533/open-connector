import type { ActionDefinition } from "../../core/types.ts";

import { s } from "../../core/json-schema.ts";
import { defineProviderAction } from "../../core/provider-definition.ts";

const service = "finmind";
const datasetInput = s.actionInput(
  {
    stockId: s.nonEmptyString("The Taiwan stock identifier, such as 2330."),
    startDate: s.date("The inclusive start date."),
    endDate: s.date("The optional inclusive end date."),
  },
  ["stockId", "startDate"],
  "Input for one fixed FinMind stock dataset.",
);
const datasetOutput = s.array("Rows returned by the fixed FinMind dataset.", s.unknown("One FinMind dataset row."));

const definitions = [
  ["get_stock_prices", "Retrieve FinMind TaiwanStockPrice rows for one Taiwan stock."],
  ["get_stock_valuation", "Retrieve FinMind TaiwanStockPER rows for one Taiwan stock."],
  ["get_monthly_revenue", "Retrieve FinMind TaiwanStockMonthRevenue rows for one Taiwan stock."],
  ["get_institutional_flows", "Retrieve FinMind TaiwanStockInstitutionalInvestorsBuySell rows for one Taiwan stock."],
  ["get_financial_statements", "Retrieve FinMind TaiwanStockFinancialStatements rows for one Taiwan stock."],
  ["get_balance_sheet", "Retrieve FinMind TaiwanStockBalanceSheet rows for one Taiwan stock."],
  ["get_cash_flow_statement", "Retrieve FinMind TaiwanStockCashFlowsStatement rows for one Taiwan stock."],
  ["get_margin_trading", "Retrieve FinMind TaiwanStockMarginPurchaseShortSale rows for one Taiwan stock."],
] as const;

export const finmindActions: ActionDefinition[] = definitions.map(([name, description]) =>
  defineProviderAction(service, {
    name,
    description,
    inputSchema: datasetInput,
    outputSchema: datasetOutput,
  }),
);
