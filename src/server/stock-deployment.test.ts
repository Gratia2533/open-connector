import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("stock deployment contract", () => {
  it("uses the runtime origin environment key consumed by the server", async () => {
    const [compose, serverEntry] = await Promise.all([
      readFile(new URL("../../docker-compose.yml", import.meta.url), "utf8"),
      readFile(new URL("./index.ts", import.meta.url), "utf8"),
    ]);

    expect(serverEntry).toContain("process.env.OOMOL_CONNECT_ORIGIN");
    expect(compose).toContain("OOMOL_CONNECT_ORIGIN:");
    expect(compose).not.toContain("OOMOL_CONNECT_PUBLIC_ORIGIN:");
  });

  it("allows only the complete expected action set without enabling a wildcard or proxy", async () => {
    const compose = await readFile(new URL("../../docker-compose.yml", import.meta.url), "utf8");
    const expectedActions = [
      "finmind.get_stock_prices",
      "finmind.get_stock_valuation",
      "finmind.get_monthly_revenue",
      "finmind.get_institutional_flows",
      "finmind.get_financial_statements",
      "finmind.get_balance_sheet",
      "finmind.get_cash_flow_statement",
      "finmind.get_margin_trading",
      "finnhub.search_symbols",
      "finnhub.get_quote",
      "finnhub.get_company_profile",
      "finnhub.get_basic_financials",
      "finnhub.get_financial_reports",
      "finnhub.get_stock_candles",
      "finnhub.get_company_news",
      "cloudflare_tunnel.list_tunnels",
      "cloudflare_tunnel.get_tunnel",
      "cloudflare_tunnel.get_tunnel_configuration",
      "cloudflare_tunnel.list_tunnel_connections",
      "cloudflare_tunnel.add_published_application",
      "cloudflare_tunnel.verify_published_application",
    ].sort();
    const lines = compose.split("\n");
    const allowlistStart = lines.findIndex((line) => line.includes("OOMOL_CONNECT_ALLOWED_ACTIONS: >-"));
    expect(allowlistStart).toBeGreaterThanOrEqual(0);
    const remainingLines = lines.slice(allowlistStart + 1);
    const allowlistEnd = remainingLines.findIndex((line) => !line.startsWith("        "));
    const actualActions = remainingLines
      .slice(0, allowlistEnd < 0 ? remainingLines.length : allowlistEnd)
      .map((line) => line.trim().replace(/,$/, ""))
      .sort();

    expect(actualActions).toEqual(expectedActions);
    expect(compose).not.toContain("cloudflare_tunnel.*");
    expect(compose).toContain('OOMOL_CONNECT_BLOCKED_PROXIES: "*"');
  });
});
