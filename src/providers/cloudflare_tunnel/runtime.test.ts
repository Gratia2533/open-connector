import { describe, expect, it, vi } from "vitest";
import { cloudflareTunnelActionHandlers, validateCloudflareTunnelCredential } from "./runtime.ts";

const credentialValues = { apiKey: "test-value", accountId: "account-123" };

function cloudflareResponse(result: unknown, init: ResponseInit = {}, resultInfo?: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify({
      success: true,
      errors: [],
      messages: [],
      result,
      ...(resultInfo ? { result_info: resultInfo } : {}),
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
      ...init,
    },
  );
}

interface PublishedApplicationFixtureOptions {
  configSource?: "cloudflare" | "local";
  zoneAccountId?: string;
  initialConfig?: Record<string, unknown>;
  initialRecords?: Array<Record<string, unknown>>;
  changeVersionBeforeWrite?: boolean;
  failDnsPost?: boolean;
  dnsRaceCreatesRecord?: boolean;
  dnsErrorMessage?: string;
  networkDelayMs?: number;
  moveCatchAllBeforeRouteOnFinalRead?: boolean;
  dnsPageSize?: number;
  zoneLookupResults?: Array<Record<string, unknown>>;
  connectionPendingReconnect?: boolean;
  tunnelDeletedAt?: string;
}

function createPublishedApplicationCloudflare(options: PublishedApplicationFixtureOptions = {}) {
  let version = 3;
  let config: Record<string, unknown> = options.initialConfig ?? { ingress: [{ service: "http_status:404" }] };
  let records: Array<Record<string, unknown>> = options.initialRecords ?? [];
  let configurationReads = 0;
  const mutations: string[] = [];

  const fetcher = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
    if (options.networkDelayMs) {
      await new Promise((resolve) => setTimeout(resolve, options.networkDelayMs));
    }
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const path = url.pathname;
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;

    if (path.endsWith("/cfd_tunnel/tunnel-1") && method === "GET") {
      return cloudflareResponse({
        id: "tunnel-1",
        name: "2F-desktop",
        status: "healthy",
        config_src: options.configSource ?? "cloudflare",
        deleted_at: options.tunnelDeletedAt ?? null,
      });
    }
    if (path.endsWith("/cfd_tunnel/tunnel-1/configurations")) {
      if (method === "GET") {
        configurationReads += 1;
        if (options.changeVersionBeforeWrite && configurationReads === 2) {
          version += 1;
        }
        if (options.moveCatchAllBeforeRouteOnFinalRead && configurationReads === 3) {
          const currentIngress = (config.ingress as unknown[]) ?? [];
          config = {
            ...config,
            ingress: [currentIngress.at(-1), ...currentIngress.slice(0, -1)],
          };
          version += 1;
        }
      }
      if (method === "PUT") {
        mutations.push("PUT configuration");
        config = body?.config as Record<string, unknown>;
        version += 1;
      }
      return cloudflareResponse({
        tunnel_id: "tunnel-1",
        version,
        source: options.configSource ?? "cloudflare",
        config,
      });
    }
    if (path.endsWith("/cfd_tunnel/tunnel-1/connections") && method === "GET") {
      return cloudflareResponse([
        {
          id: "connector-1",
          arch: "amd64",
          config_version: version,
          conns: [
            {
              id: "connection-1",
              client_id: "connector-1",
              client_version: "2026.7.0",
              colo_name: "TPE",
              is_pending_reconnect: options.connectionPendingReconnect ?? false,
            },
          ],
          features: ["serialized_headers"],
          run_at: "2026-07-16T00:00:00Z",
          version: "2026.7.0",
        },
      ]);
    }
    if (path.endsWith("/zones") && method === "GET") {
      const zones = options.zoneLookupResults ?? [
        {
          id: "zone-1",
          name: "example.com",
          account: { id: options.zoneAccountId ?? "account-123" },
        },
      ];
      return cloudflareResponse(
        zones,
        {},
        {
          page: 1,
          per_page: 5,
          count: zones.length,
          total_count: 17,
          total_pages: 4,
        },
      );
    }
    if (path.endsWith("/zones/zone-1") && method === "GET") {
      return cloudflareResponse({
        id: "zone-1",
        name: "example.com",
        account: { id: options.zoneAccountId ?? "account-123" },
      });
    }
    if (path.endsWith("/zones/zone-1/dns_records")) {
      if (method === "POST") {
        mutations.push("POST DNS");
        if (options.failDnsPost) {
          if (options.dnsRaceCreatesRecord) {
            records.push({
              id: "record-race",
              zone_id: "zone-1",
              type: "CNAME",
              name: body?.name,
              content: body?.content,
              proxied: body?.proxied,
              ttl: body?.ttl,
            });
          }
          return new Response(
            JSON.stringify({ success: false, errors: [{ message: options.dnsErrorMessage ?? "DNS write failed" }] }),
            {
              status: 500,
              headers: { "content-type": "application/json" },
            },
          );
        }
        records.push({
          id: `record-${records.length + 1}`,
          zone_id: "zone-1",
          type: "CNAME",
          name: body?.name,
          content: body?.content,
          proxied: body?.proxied,
          ttl: body?.ttl,
        });
      }
      const requestedName = url.searchParams.get("name")?.toLowerCase();
      const matchingRecords = requestedName
        ? records.filter((record) => String(record.name).toLowerCase() === requestedName)
        : records;
      if (method === "POST") {
        return cloudflareResponse(records.at(-1));
      }
      const requestedPage = Number(url.searchParams.get("page") ?? "1");
      const requestedPerPage = Number(url.searchParams.get("per_page") ?? "100");
      const pageSize = Math.min(options.dnsPageSize ?? requestedPerPage, requestedPerPage);
      const pageStart = (requestedPage - 1) * pageSize;
      const pageRecords = matchingRecords.slice(pageStart, pageStart + pageSize);
      const totalPages = Math.max(1, Math.ceil(matchingRecords.length / pageSize));
      return cloudflareResponse(
        pageRecords,
        {},
        {
          page: requestedPage,
          per_page: pageSize,
          count: pageRecords.length,
          total_count: matchingRecords.length,
          total_pages: totalPages,
        },
      );
    }
    throw new Error(`unexpected Cloudflare request: ${method} ${path}`);
  });

  return {
    fetcher,
    mutations,
    getConfig: () => config,
    getRecords: () => records,
  };
}

describe("Cloudflare Tunnel provider runtime", () => {
  it("validates the token and account against the fixed Tunnel list endpoint", async () => {
    const fetcher = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.origin + url.pathname).toBe("https://api.cloudflare.com/client/v4/accounts/account-123/cfd_tunnel");
      expect(url.searchParams.get("is_deleted")).toBe("false");
      expect(url.searchParams.get("page")).toBe("1");
      expect(url.searchParams.get("per_page")).toBe("1");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-value");
      return cloudflareResponse([{ id: "tunnel-1", name: "2F-desktop", status: "healthy" }]);
    });

    const result = await validateCloudflareTunnelCredential(credentialValues, fetcher);

    expect(result.profile).toEqual({ accountId: "account-123" });
    expect(result.metadata).toMatchObject({
      accountId: "account-123",
      validationEndpoint: "/accounts/account-123/cfd_tunnel?is_deleted=false&page=1&per_page=1",
      firstTunnelId: "tunnel-1",
      firstTunnelName: "2F-desktop",
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("uses only fixed read endpoints and normalizes Tunnel responses", async () => {
    const requests: string[] = [];
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      requests.push(url.pathname);
      if (url.pathname.endsWith("/configurations")) {
        return cloudflareResponse({
          version: 7,
          source: "cloudflare",
          config: {
            ingress: [
              { hostname: "app.example.com", service: "http://localhost:3000" },
              { service: "http_status:404" },
            ],
          },
        });
      }
      if (url.pathname.endsWith("/connections")) {
        return cloudflareResponse([
          {
            id: "connector-1",
            conns: [
              {
                id: "connection-1",
                client_id: "connector-1",
                client_version: "2026.7.0",
                is_pending_reconnect: false,
              },
            ],
          },
        ]);
      }
      return cloudflareResponse({ id: "tunnel-1", name: "2F-desktop", status: "healthy", config_src: "cloudflare" });
    });
    const context = { accessToken: "test-value", accountId: "account-123", fetcher };

    await expect(cloudflareTunnelActionHandlers.get_tunnel({ tunnelId: "tunnel/1" }, context)).resolves.toEqual({
      tunnel: expect.objectContaining({
        id: "tunnel-1",
        name: "2F-desktop",
        status: "healthy",
        configSource: "cloudflare",
      }),
    });
    await expect(
      cloudflareTunnelActionHandlers.get_tunnel_configuration({ tunnelId: "tunnel/1" }, context),
    ).resolves.toEqual({
      configuration: expect.objectContaining({ version: 7, source: "cloudflare", config: expect.any(Object) }),
    });
    await expect(
      cloudflareTunnelActionHandlers.list_tunnel_connections({ tunnelId: "tunnel/1" }, context),
    ).resolves.toEqual({
      connectors: [
        {
          id: "connector-1",
          connections: [
            {
              id: "connection-1",
              clientId: "connector-1",
              clientVersion: "2026.7.0",
              pendingReconnect: false,
            },
          ],
        },
      ],
    });

    expect(requests).toEqual([
      "/client/v4/accounts/account-123/cfd_tunnel/tunnel%2F1",
      "/client/v4/accounts/account-123/cfd_tunnel/tunnel%2F1/configurations",
      "/client/v4/accounts/account-123/cfd_tunnel/tunnel%2F1/connections",
    ]);
  });

  it("accepts the official Tunnel page-size limit and rejects larger requests", async () => {
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/client/v4/accounts/account-123/cfd_tunnel");
      expect(url.searchParams.get("per_page")).toBe("1000");
      return cloudflareResponse([], {}, { page: 1, per_page: 1000, count: 0, total_count: 0, total_pages: 0 });
    });
    const context = { accessToken: "test-value", accountId: "account-123", fetcher };

    await expect(cloudflareTunnelActionHandlers.list_tunnels({ perPage: 1000 }, context)).resolves.toEqual({
      tunnels: [],
      resultInfo: { page: 1, perPage: 1000, count: 0, totalCount: 0, totalPages: 0 },
    });
    await expect(cloudflareTunnelActionHandlers.list_tunnels({ perPage: 1001 }, context)).rejects.toThrow(
      "perPage must be between 1 and 1000",
    );
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("adds an ingress before the catch-all and creates the exact proxied Tunnel CNAME", async () => {
    const cloudflare = createPublishedApplicationCloudflare();
    const context = { accessToken: "test-value", accountId: "account-123", fetcher: cloudflare.fetcher };

    const result = await cloudflareTunnelActionHandlers.add_published_application(
      {
        tunnelId: "tunnel-1",
        zoneId: "zone-1",
        hostname: "App.Example.com",
        service: "http://localhost:3000",
      },
      context,
    );

    expect(result).toEqual({
      changed: true,
      ingress: { hostname: "app.example.com", service: "http://localhost:3000" },
      dnsRecord: expect.objectContaining({
        id: "record-1",
        type: "CNAME",
        name: "app.example.com",
        content: "tunnel-1.cfargotunnel.com",
        proxied: true,
      }),
      configurationVersion: 4,
    });
    expect(cloudflare.getConfig()).toEqual({
      ingress: [{ hostname: "app.example.com", service: "http://localhost:3000" }, { service: "http_status:404" }],
    });
    expect(cloudflare.getRecords()).toHaveLength(1);
    expect(cloudflare.mutations).toEqual(["PUT configuration", "POST DNS"]);
  });

  it("reports partial state without rollback when DNS creation fails", async () => {
    const cloudflare = createPublishedApplicationCloudflare({ failDnsPost: true });
    const context = { accessToken: "test-value", accountId: "account-123", fetcher: cloudflare.fetcher };

    await expect(
      cloudflareTunnelActionHandlers.add_published_application(
        {
          tunnelId: "tunnel-1",
          zoneId: "zone-1",
          hostname: "app.example.com",
          service: "http://localhost:3000",
        },
        context,
      ),
    ).rejects.toThrow("manual reconciliation");

    expect(cloudflare.getConfig()).toEqual({
      ingress: [{ hostname: "app.example.com", service: "http://localhost:3000" }, { service: "http_status:404" }],
    });
    expect(cloudflare.mutations).toEqual(["PUT configuration", "POST DNS"]);
  });

  it("verifies ingress, Tunnel CNAME, and active connector state without mutation", async () => {
    const cloudflare = createPublishedApplicationCloudflare();
    const context = { accessToken: "test-value", accountId: "account-123", fetcher: cloudflare.fetcher };
    await cloudflareTunnelActionHandlers.add_published_application(
      {
        tunnelId: "tunnel-1",
        zoneId: "zone-1",
        hostname: "app.example.com",
        service: "http://localhost:3000",
      },
      context,
    );
    cloudflare.mutations.length = 0;

    await expect(
      cloudflareTunnelActionHandlers.verify_published_application(
        {
          tunnelId: "tunnel-1",
          zoneId: "zone-1",
          hostname: "app.example.com",
          service: "http://localhost:3000",
        },
        context,
      ),
    ).resolves.toEqual({
      ok: true,
      checks: {
        tunnelExists: true,
        remotelyManaged: true,
        ingressMatches: true,
        dnsMatches: true,
        connectorHealthy: true,
      },
      ingress: { hostname: "app.example.com", service: "http://localhost:3000" },
      dnsRecord: expect.objectContaining({ content: "tunnel-1.cfargotunnel.com", proxied: true }),
      activeConnections: 1,
    });
    expect(cloudflare.mutations).toEqual([]);
  });

  it("does not treat a connector with only pending reconnects as healthy", async () => {
    const cloudflare = createPublishedApplicationCloudflare({ connectionPendingReconnect: true });
    const context = { accessToken: "test-value", accountId: "account-123", fetcher: cloudflare.fetcher };
    await cloudflareTunnelActionHandlers.add_published_application(
      {
        tunnelId: "tunnel-1",
        zoneId: "zone-1",
        hostname: "app.example.com",
        service: "http://localhost:3000",
      },
      context,
    );

    await expect(
      cloudflareTunnelActionHandlers.verify_published_application(
        {
          tunnelId: "tunnel-1",
          zoneId: "zone-1",
          hostname: "app.example.com",
          service: "http://localhost:3000",
        },
        context,
      ),
    ).resolves.toMatchObject({
      ok: false,
      checks: { connectorHealthy: false },
      activeConnections: 0,
    });
  });

  it("reports a soft-deleted Tunnel as unavailable", async () => {
    const cloudflare = createPublishedApplicationCloudflare({ tunnelDeletedAt: "2026-07-16T00:00:00Z" });
    const context = { accessToken: "test-value", accountId: "account-123", fetcher: cloudflare.fetcher };

    await expect(
      cloudflareTunnelActionHandlers.verify_published_application(
        {
          tunnelId: "tunnel-1",
          zoneId: "zone-1",
          hostname: "app.example.com",
          service: "http://localhost:3000",
        },
        context,
      ),
    ).resolves.toMatchObject({
      ok: false,
      checks: { tunnelExists: false, remotelyManaged: false },
    });
  });

  it("is idempotent when the ingress and exact Tunnel CNAME already exist", async () => {
    const cloudflare = createPublishedApplicationCloudflare();
    const context = { accessToken: "test-value", accountId: "account-123", fetcher: cloudflare.fetcher };
    const input = {
      tunnelId: "tunnel-1",
      zoneId: "zone-1",
      hostname: "app.example.com",
      service: "http://localhost:3000",
    };
    await cloudflareTunnelActionHandlers.add_published_application(input, context);
    cloudflare.mutations.length = 0;

    await expect(cloudflareTunnelActionHandlers.add_published_application(input, context)).resolves.toMatchObject({
      changed: false,
    });
    expect(cloudflare.mutations).toEqual([]);
  });

  it("resolves a unique Zone name for add and verify workflows", async () => {
    const cloudflare = createPublishedApplicationCloudflare();
    const context = { accessToken: "test-value", accountId: "account-123", fetcher: cloudflare.fetcher };
    const input = {
      tunnelId: "tunnel-1",
      zoneName: "example.com",
      hostname: "app.example.com",
      service: "http://localhost:3000",
    };

    await expect(cloudflareTunnelActionHandlers.add_published_application(input, context)).resolves.toMatchObject({
      changed: true,
    });
    await expect(cloudflareTunnelActionHandlers.verify_published_application(input, context)).resolves.toMatchObject({
      ok: true,
    });
    const zoneLookups = cloudflare.fetcher.mock.calls
      .map(([request]) => new URL(String(request)))
      .filter((url) => url.pathname.endsWith("/zones"));
    expect(zoneLookups).toHaveLength(2);
    for (const url of zoneLookups) {
      expect(url.searchParams.get("name")).toBe("example.com");
      expect(url.searchParams.get("account.id")).toBe("account-123");
      expect(url.searchParams.get("per_page")).toBe("5");
    }
  });

  it("rejects a non-unique Zone name before any mutation", async () => {
    const cloudflare = createPublishedApplicationCloudflare({
      zoneLookupResults: [
        { id: "zone-1", name: "example.com", account: { id: "account-123" } },
        { id: "zone-2", name: "example.com", account: { id: "account-123" } },
      ],
    });
    const context = { accessToken: "test-value", accountId: "account-123", fetcher: cloudflare.fetcher };

    await expect(
      cloudflareTunnelActionHandlers.add_published_application(
        {
          tunnelId: "tunnel-1",
          zoneName: "example.com",
          hostname: "app.example.com",
          service: "http://localhost:3000",
        },
        context,
      ),
    ).rejects.toThrow("exactly one");
    expect(cloudflare.mutations).toEqual([]);
  });

  it("rejects missing or ambiguous Zone selectors", async () => {
    const cloudflare = createPublishedApplicationCloudflare();
    const context = { accessToken: "test-value", accountId: "account-123", fetcher: cloudflare.fetcher };
    const baseInput = {
      tunnelId: "tunnel-1",
      hostname: "app.example.com",
      service: "http://localhost:3000",
    };

    await expect(cloudflareTunnelActionHandlers.add_published_application(baseInput, context)).rejects.toThrow(
      "exactly one of zoneId or zoneName",
    );
    await expect(
      cloudflareTunnelActionHandlers.add_published_application(
        { ...baseInput, zoneId: "zone-1", zoneName: "example.com" },
        context,
      ),
    ).rejects.toThrow("exactly one of zoneId or zoneName");
    expect(cloudflare.mutations).toEqual([]);
  });

  it("rejects local Tunnel configuration before any mutation", async () => {
    const cloudflare = createPublishedApplicationCloudflare({ configSource: "local" });
    const context = { accessToken: "test-value", accountId: "account-123", fetcher: cloudflare.fetcher };

    await expect(
      cloudflareTunnelActionHandlers.add_published_application(
        {
          tunnelId: "tunnel-1",
          zoneId: "zone-1",
          hostname: "app.example.com",
          service: "http://localhost:3000",
        },
        context,
      ),
    ).rejects.toThrow("remotely-managed");
    expect(cloudflare.mutations).toEqual([]);
  });

  it("rejects a conflicting DNS record before changing ingress", async () => {
    const cloudflare = createPublishedApplicationCloudflare({
      initialRecords: [{ id: "record-a", type: "A", name: "app.example.com", content: "192.0.2.1", proxied: true }],
    });
    const context = { accessToken: "test-value", accountId: "account-123", fetcher: cloudflare.fetcher };

    await expect(
      cloudflareTunnelActionHandlers.add_published_application(
        {
          tunnelId: "tunnel-1",
          zoneId: "zone-1",
          hostname: "app.example.com",
          service: "http://localhost:3000",
        },
        context,
      ),
    ).rejects.toThrow("conflicting DNS record");
    expect(cloudflare.mutations).toEqual([]);
  });

  it("rejects mixed matching and conflicting DNS records before changing ingress", async () => {
    const cloudflare = createPublishedApplicationCloudflare({
      initialRecords: [
        {
          id: "record-cname",
          type: "CNAME",
          name: "app.example.com",
          content: "tunnel-1.cfargotunnel.com",
          proxied: true,
        },
        { id: "record-a", type: "A", name: "app.example.com", content: "192.0.2.1", proxied: true },
      ],
    });
    const context = { accessToken: "test-value", accountId: "account-123", fetcher: cloudflare.fetcher };

    await expect(
      cloudflareTunnelActionHandlers.add_published_application(
        {
          tunnelId: "tunnel-1",
          zoneId: "zone-1",
          hostname: "app.example.com",
          service: "http://localhost:3000",
        },
        context,
      ),
    ).rejects.toThrow("conflicting DNS record");
    expect(cloudflare.mutations).toEqual([]);
  });

  it("enumerates every DNS page before accepting a unique Tunnel CNAME", async () => {
    const cloudflare = createPublishedApplicationCloudflare({
      dnsPageSize: 1,
      initialConfig: {
        ingress: [{ hostname: "app.example.com", service: "http://localhost:3000" }, { service: "http_status:404" }],
      },
      initialRecords: [
        {
          id: "record-cname",
          type: "CNAME",
          name: "app.example.com",
          content: "tunnel-1.cfargotunnel.com",
          proxied: true,
        },
        { id: "record-a", type: "A", name: "app.example.com", content: "192.0.2.1", proxied: true },
      ],
    });
    const context = { accessToken: "test-value", accountId: "account-123", fetcher: cloudflare.fetcher };

    await expect(
      cloudflareTunnelActionHandlers.add_published_application(
        {
          tunnelId: "tunnel-1",
          zoneId: "zone-1",
          hostname: "app.example.com",
          service: "http://localhost:3000",
        },
        context,
      ),
    ).rejects.toThrow("conflicting DNS record");
    const dnsReads = cloudflare.fetcher.mock.calls
      .map(([input]) => new URL(String(input)))
      .filter((url) => url.pathname.endsWith("/dns_records") && url.searchParams.has("page"));
    expect(dnsReads.map((url) => url.searchParams.get("page"))).toEqual(["1", "2"]);
    expect(cloudflare.mutations).toEqual([]);
  });

  it("fails closed when the configuration version changes during read-modify-write", async () => {
    const cloudflare = createPublishedApplicationCloudflare({ changeVersionBeforeWrite: true });
    const context = { accessToken: "test-value", accountId: "account-123", fetcher: cloudflare.fetcher };

    await expect(
      cloudflareTunnelActionHandlers.add_published_application(
        {
          tunnelId: "tunnel-1",
          zoneId: "zone-1",
          hostname: "app.example.com",
          service: "http://localhost:3000",
        },
        context,
      ),
    ).rejects.toThrow("changed during the publish workflow");
    expect(cloudflare.mutations).toEqual([]);
  });

  it("treats a failed DNS POST as success when a concurrent writer created the exact CNAME", async () => {
    const cloudflare = createPublishedApplicationCloudflare({ failDnsPost: true, dnsRaceCreatesRecord: true });
    const context = { accessToken: "test-value", accountId: "account-123", fetcher: cloudflare.fetcher };

    await expect(
      cloudflareTunnelActionHandlers.add_published_application(
        {
          tunnelId: "tunnel-1",
          zoneId: "zone-1",
          hostname: "app.example.com",
          service: "http://localhost:3000",
        },
        context,
      ),
    ).resolves.toMatchObject({
      changed: true,
      dnsRecord: { id: "record-race", content: "tunnel-1.cfargotunnel.com", proxied: true },
    });
    expect(cloudflare.mutations).toEqual(["PUT configuration", "POST DNS"]);
  });

  it("preserves unknown top-level config and catch-all fields during insertion", async () => {
    const cloudflare = createPublishedApplicationCloudflare({
      initialConfig: {
        originRequest: { connectTimeout: 30 },
        customFutureField: { enabled: true },
        ingress: [{ service: "http_status:404", originRequest: { noTLSVerify: false } }],
      },
    });
    const context = { accessToken: "test-value", accountId: "account-123", fetcher: cloudflare.fetcher };
    await cloudflareTunnelActionHandlers.add_published_application(
      {
        tunnelId: "tunnel-1",
        zoneId: "zone-1",
        hostname: "app.example.com",
        service: "http://localhost:3000",
      },
      context,
    );

    expect(cloudflare.getConfig()).toEqual({
      originRequest: { connectTimeout: 30 },
      customFutureField: { enabled: true },
      ingress: [
        { hostname: "app.example.com", service: "http://localhost:3000" },
        { service: "http_status:404", originRequest: { noTLSVerify: false } },
      ],
    });
  });

  it("verify rejects a zone from another account before reading DNS", async () => {
    const cloudflare = createPublishedApplicationCloudflare({ zoneAccountId: "other-account" });
    const context = { accessToken: "test-value", accountId: "account-123", fetcher: cloudflare.fetcher };

    await expect(
      cloudflareTunnelActionHandlers.verify_published_application(
        { tunnelId: "tunnel-1", zoneId: "zone-1", hostname: "app.example.com" },
        context,
      ),
    ).rejects.toThrow("zone does not belong");
  });

  it("rejects an idempotent path rule shadowed by a broader same-hostname rule", async () => {
    const cloudflare = createPublishedApplicationCloudflare({
      initialConfig: {
        ingress: [
          { hostname: "app.example.com", service: "http://localhost:3000" },
          { hostname: "app.example.com", path: "^/admin", service: "http://localhost:4000" },
          { service: "http_status:404" },
        ],
      },
      initialRecords: [
        {
          id: "record-1",
          type: "CNAME",
          name: "app.example.com",
          content: "tunnel-1.cfargotunnel.com",
          proxied: true,
        },
      ],
    });
    const context = { accessToken: "test-value", accountId: "account-123", fetcher: cloudflare.fetcher };

    await expect(
      cloudflareTunnelActionHandlers.add_published_application(
        {
          tunnelId: "tunnel-1",
          zoneId: "zone-1",
          hostname: "app.example.com",
          path: "^/admin",
          service: "http://localhost:4000",
        },
        context,
      ),
    ).rejects.toThrow("shadowed");
    expect(cloudflare.mutations).toEqual([]);
  });

  it("verify reports a shadowed path rule as not matching", async () => {
    const cloudflare = createPublishedApplicationCloudflare({
      initialConfig: {
        ingress: [
          { hostname: "app.example.com", service: "http://localhost:3000" },
          { hostname: "app.example.com", path: "^/admin", service: "http://localhost:4000" },
          { service: "http_status:404" },
        ],
      },
      initialRecords: [
        {
          id: "record-1",
          type: "CNAME",
          name: "app.example.com",
          content: "tunnel-1.cfargotunnel.com",
          proxied: true,
        },
      ],
    });
    const context = { accessToken: "test-value", accountId: "account-123", fetcher: cloudflare.fetcher };

    await expect(
      cloudflareTunnelActionHandlers.verify_published_application(
        {
          tunnelId: "tunnel-1",
          zoneId: "zone-1",
          hostname: "app.example.com",
          path: "^/admin",
          service: "http://localhost:4000",
        },
        context,
      ),
    ).resolves.toMatchObject({ ok: false, checks: { ingressMatches: false } });
  });

  it("rejects duplicate exact hostname and path ingress rules", async () => {
    const cloudflare = createPublishedApplicationCloudflare({
      initialConfig: {
        ingress: [
          { hostname: "app.example.com", path: "^/admin", service: "http://localhost:4000" },
          { hostname: "app.example.com", path: "^/admin", service: "http://localhost:4000" },
          { service: "http_status:404" },
        ],
      },
    });
    const context = { accessToken: "test-value", accountId: "account-123", fetcher: cloudflare.fetcher };

    await expect(
      cloudflareTunnelActionHandlers.add_published_application(
        {
          tunnelId: "tunnel-1",
          zoneId: "zone-1",
          hostname: "app.example.com",
          path: "^/admin",
          service: "http://localhost:4000",
        },
        context,
      ),
    ).rejects.toThrow("duplicate");
    expect(cloudflare.mutations).toEqual([]);
  });

  it("rejects duplicate exact ingress rules with conflicting services", async () => {
    const cloudflare = createPublishedApplicationCloudflare({
      initialConfig: {
        ingress: [
          { hostname: "app.example.com", path: "^/admin", service: "http://localhost:4000" },
          { hostname: "app.example.com", path: "^/admin", service: "http://localhost:5000" },
          { service: "http_status:404" },
        ],
      },
    });
    const context = { accessToken: "test-value", accountId: "account-123", fetcher: cloudflare.fetcher };

    await expect(
      cloudflareTunnelActionHandlers.add_published_application(
        {
          tunnelId: "tunnel-1",
          zoneId: "zone-1",
          hostname: "app.example.com",
          path: "^/admin",
          service: "http://localhost:4000",
        },
        context,
      ),
    ).rejects.toThrow("duplicate");
    expect(cloudflare.mutations).toEqual([]);
  });

  it("fails read-back when a catch-all appears before the published route", async () => {
    const cloudflare = createPublishedApplicationCloudflare({ moveCatchAllBeforeRouteOnFinalRead: true });
    const context = { accessToken: "test-value", accountId: "account-123", fetcher: cloudflare.fetcher };

    await expect(
      cloudflareTunnelActionHandlers.add_published_application(
        {
          tunnelId: "tunnel-1",
          zoneId: "zone-1",
          hostname: "app.example.com",
          service: "http://localhost:3000",
        },
        context,
      ),
    ).rejects.toThrow("read-back verification failed");
  });

  it.each([
    { path: undefined, label: "pathless" },
    { path: "^/admin", label: "path-specific" },
  ])("inserts a $label exact-host ingress before a matching broad wildcard", async ({ path }) => {
    const cloudflare = createPublishedApplicationCloudflare({
      initialConfig: {
        ingress: [{ hostname: "*.example.com", service: "http://localhost:3000" }, { service: "http_status:404" }],
      },
    });
    const context = { accessToken: "test-value", accountId: "account-123", fetcher: cloudflare.fetcher };

    await expect(
      cloudflareTunnelActionHandlers.add_published_application(
        {
          tunnelId: "tunnel-1",
          zoneId: "zone-1",
          hostname: "app.example.com",
          service: "http://localhost:4000",
          ...(path ? { path } : {}),
        },
        context,
      ),
    ).resolves.toMatchObject({ changed: true });
    expect((cloudflare.getConfig().ingress as unknown[])[0]).toEqual({
      hostname: "app.example.com",
      service: "http://localhost:4000",
      ...(path ? { path } : {}),
    });
    expect(cloudflare.mutations).toEqual(["PUT configuration", "POST DNS"]);
  });

  it("inserts a path-specific ingress before a broader rule for the same hostname", async () => {
    const cloudflare = createPublishedApplicationCloudflare({
      initialConfig: {
        ingress: [{ hostname: "app.example.com", service: "http://localhost:3000" }, { service: "http_status:404" }],
      },
    });
    const context = { accessToken: "test-value", accountId: "account-123", fetcher: cloudflare.fetcher };

    await cloudflareTunnelActionHandlers.add_published_application(
      {
        tunnelId: "tunnel-1",
        zoneId: "zone-1",
        hostname: "app.example.com",
        path: "^/admin",
        service: "http://localhost:4000",
      },
      context,
    );

    expect(cloudflare.getConfig()).toEqual({
      ingress: [
        { hostname: "app.example.com", path: "^/admin", service: "http://localhost:4000" },
        { hostname: "app.example.com", service: "http://localhost:3000" },
        { service: "http_status:404" },
      ],
    });
  });

  it("serializes concurrent writes for the same account and Tunnel within one process", async () => {
    const cloudflare = createPublishedApplicationCloudflare({ networkDelayMs: 5 });
    const context = { accessToken: "test-value", accountId: "account-123", fetcher: cloudflare.fetcher };
    const input = {
      tunnelId: "tunnel-1",
      zoneId: "zone-1",
      hostname: "app.example.com",
      service: "http://localhost:3000",
    };

    const results = await Promise.all([
      cloudflareTunnelActionHandlers.add_published_application(input, context),
      cloudflareTunnelActionHandlers.add_published_application(input, context),
    ]);

    expect(results.map((result) => (result as { changed: boolean }).changed).sort()).toEqual([false, true]);
    expect(cloudflare.mutations).toEqual(["PUT configuration", "POST DNS"]);
  });

  it("serializes concurrent different-host writes on the same Tunnel without losing ingress", async () => {
    const cloudflare = createPublishedApplicationCloudflare({ networkDelayMs: 5 });
    const context = { accessToken: "test-value", accountId: "account-123", fetcher: cloudflare.fetcher };

    const results = await Promise.all([
      cloudflareTunnelActionHandlers.add_published_application(
        {
          tunnelId: "tunnel-1",
          zoneId: "zone-1",
          hostname: "app.example.com",
          service: "http://localhost:3000",
        },
        context,
      ),
      cloudflareTunnelActionHandlers.add_published_application(
        {
          tunnelId: "tunnel-1",
          zoneId: "zone-1",
          hostname: "api.example.com",
          service: "http://localhost:4000",
        },
        context,
      ),
    ]);

    expect(results.map((result) => (result as { changed: boolean }).changed)).toEqual([true, true]);
    expect(cloudflare.getConfig()).toEqual({
      ingress: [
        { hostname: "app.example.com", service: "http://localhost:3000" },
        { hostname: "api.example.com", service: "http://localhost:4000" },
        { service: "http_status:404" },
      ],
    });
    expect(cloudflare.getRecords()).toHaveLength(2);
    expect(cloudflare.mutations).toEqual(["PUT configuration", "POST DNS", "PUT configuration", "POST DNS"]);
  });

  it("releases the process-local mutation lock after a failed write", async () => {
    const failingCloudflare = createPublishedApplicationCloudflare({ failDnsPost: true });
    const input = {
      tunnelId: "tunnel-1",
      zoneId: "zone-1",
      hostname: "app.example.com",
      service: "http://localhost:3000",
    };

    await expect(
      cloudflareTunnelActionHandlers.add_published_application(input, {
        accessToken: "test-value",
        accountId: "account-123",
        fetcher: failingCloudflare.fetcher,
      }),
    ).rejects.toThrow("manual reconciliation");

    const succeedingCloudflare = createPublishedApplicationCloudflare();
    await expect(
      cloudflareTunnelActionHandlers.add_published_application(input, {
        accessToken: "test-value",
        accountId: "account-123",
        fetcher: succeedingCloudflare.fetcher,
      }),
    ).resolves.toMatchObject({ changed: true });
  });

  it("bounds surfaced Cloudflare error messages", async () => {
    const cloudflare = createPublishedApplicationCloudflare({
      failDnsPost: true,
      dnsErrorMessage: "x".repeat(5_000),
    });
    const context = { accessToken: "test-value", accountId: "account-123", fetcher: cloudflare.fetcher };

    let message = "";
    try {
      await cloudflareTunnelActionHandlers.add_published_application(
        {
          tunnelId: "tunnel-1",
          zoneId: "zone-1",
          hostname: "app.example.com",
          service: "http://localhost:3000",
        },
        context,
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("manual reconciliation");
    expect(message.length).toBeLessThanOrEqual(700);
  });
});
