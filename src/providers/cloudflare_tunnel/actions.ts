import type { ActionDefinition } from "../../core/types.ts";

import { s } from "../../core/json-schema.ts";
import { defineProviderAction } from "../../core/provider-definition.ts";

const service = "cloudflare_tunnel";
const connectorsRead = "Cloudflare One Connectors Read";
const connectorsWrite = "Cloudflare One Connectors Write";
const zoneRead = "Zone Read";
const dnsRead = "DNS Read";
const dnsWrite = "DNS Write";

const tunnelId = s.uuid("The Cloudflare Tunnel UUID.");
const zoneId = s.nonEmptyString("The Cloudflare zone ID. Provide exactly one of zoneId or zoneName.");
const zoneName = s.nonEmptyString("The Cloudflare zone name. Provide exactly one of zoneId or zoneName.");
const hostname = s.nonEmptyString("The published application hostname.");
const serviceUrl = s.nonEmptyString("The HTTP or HTTPS origin service URL.");
const path = s.string("The optional Cloudflare ingress path matcher.");
const tunnel = s.object(
  "A normalized Cloudflare Tunnel.",
  {
    id: tunnelId,
    name: s.string("The Tunnel name."),
    status: s.stringEnum("The Tunnel status.", ["inactive", "degraded", "healthy", "down"]),
    accountTag: s.string("The Cloudflare account ID associated with the Tunnel."),
    createdAt: s.dateTime("When the Tunnel was created."),
    deletedAt: s.nullable(s.dateTime("When the Tunnel was deleted.")),
    configSource: s.stringEnum("How the Tunnel configuration is managed.", ["local", "cloudflare"]),
  },
  { required: ["id"], optional: ["name", "status", "accountTag", "createdAt", "deletedAt", "configSource"] },
);
const resultInfo = s.object(
  "Cloudflare pagination metadata.",
  {
    page: s.positiveInteger("The current page."),
    perPage: s.positiveInteger("The requested page size."),
    count: s.nonNegativeInteger("The number of results on this page."),
    totalCount: s.nonNegativeInteger("The total number of matching results."),
    totalPages: s.nonNegativeInteger("The total number of pages."),
  },
  { optional: ["page", "perPage", "count", "totalCount", "totalPages"] },
);
const connection = s.object(
  "One connection from a cloudflared connector to Cloudflare's edge.",
  {
    id: s.nonEmptyString("The connection UUID."),
    clientId: s.string("The cloudflared connector UUID."),
    clientVersion: s.string("The cloudflared version for this connection."),
    coloName: s.string("The Cloudflare data center serving this connection."),
    openedAt: s.dateTime("When the connection was established."),
    originIp: s.string("The public IP address of the cloudflared host."),
    pendingReconnect: s.boolean("Whether the disconnected connection is retained for reconnect optimization."),
  },
  { required: ["id"], optional: ["clientId", "clientVersion", "coloName", "openedAt", "originIp", "pendingReconnect"] },
);
const connector = s.object(
  "One cloudflared connector client and its edge connections.",
  {
    id: s.nonEmptyString("The connector UUID."),
    arch: s.string("The connector architecture."),
    configVersion: s.nonNegativeInteger("The remote Tunnel configuration version used by the connector."),
    connections: s.array("The connector's edge connections.", connection),
    features: s.stringArray("Features enabled for the connector."),
    runAt: s.dateTime("When the connector started."),
    version: s.string("The cloudflared version."),
  },
  { required: ["id", "connections"], optional: ["arch", "configVersion", "features", "runAt", "version"] },
);
const configuration = s.object(
  "A normalized remotely-managed Tunnel configuration.",
  {
    tunnelId,
    version: s.nonNegativeInteger("The Tunnel configuration version."),
    source: s.stringEnum("How the configuration is managed.", ["local", "cloudflare"]),
    createdAt: s.dateTime("When this configuration version was created."),
    config: s.looseObject("The complete Cloudflare Tunnel configuration."),
  },
  { required: ["config"], optional: ["tunnelId", "version", "source", "createdAt"] },
);
const ingress = s.object(
  "A normalized Tunnel ingress rule.",
  {
    hostname,
    service: serviceUrl,
    path,
    originRequest: s.looseObject("Cloudflare origin-request settings preserved on the ingress rule."),
  },
  { required: ["hostname", "service"], optional: ["path", "originRequest"] },
);
const dnsRecord = s.object(
  "The proxied Tunnel CNAME.",
  {
    id: s.string("The DNS record ID."),
    zoneId: s.string("The Cloudflare zone ID."),
    type: s.literal("CNAME", { description: "The DNS record type." }),
    name: hostname,
    content: s.nonEmptyString("The Tunnel CNAME target."),
    proxied: s.boolean("Whether Cloudflare proxies this DNS record."),
    ttl: s.positiveInteger("The DNS TTL; 1 means automatic."),
  },
  { required: ["type", "name", "content", "proxied"], optional: ["id", "zoneId", "ttl"] },
);

export type CloudflareTunnelActionName =
  | "list_tunnels"
  | "get_tunnel"
  | "get_tunnel_configuration"
  | "list_tunnel_connections"
  | "add_published_application"
  | "verify_published_application";

export const cloudflareTunnelActions: ActionDefinition[] = [
  defineProviderAction(service, {
    name: "list_tunnels",
    description: "List Cloudflare-managed cloudflared tunnels in the configured account.",
    providerPermissions: [connectorsRead],
    inputSchema: s.object(
      "Tunnel list filters.",
      {
        name: s.string("Filter by tunnel name."),
        status: s.stringEnum("Filter by tunnel status.", ["inactive", "degraded", "healthy", "down"]),
        page: s.positiveInteger("The result page number."),
        perPage: s.positiveInteger("The page size.", { maximum: 1000 }),
      },
      { optional: ["name", "status", "page", "perPage"] },
    ),
    outputSchema: s.object(
      "The tunnel list result.",
      {
        tunnels: s.array("Cloudflare tunnels.", tunnel),
        resultInfo,
      },
      { required: ["tunnels"], optional: ["resultInfo"] },
    ),
  }),
  defineProviderAction(service, {
    name: "get_tunnel",
    description: "Get one cloudflared Tunnel from the configured account.",
    providerPermissions: [connectorsRead],
    inputSchema: s.object("Tunnel lookup.", { tunnelId }, { required: ["tunnelId"] }),
    outputSchema: s.object("The tunnel result.", { tunnel }, { required: ["tunnel"] }),
  }),
  defineProviderAction(service, {
    name: "get_tunnel_configuration",
    description: "Get the complete remotely-managed configuration for one cloudflared Tunnel.",
    providerPermissions: [connectorsRead],
    inputSchema: s.object("Tunnel configuration lookup.", { tunnelId }, { required: ["tunnelId"] }),
    outputSchema: s.object("The Tunnel configuration result.", { configuration }, { required: ["configuration"] }),
  }),
  defineProviderAction(service, {
    name: "list_tunnel_connections",
    description: "List connector clients and their Cloudflare edge connections for one cloudflared Tunnel.",
    providerPermissions: [connectorsRead],
    inputSchema: s.object("Tunnel connection lookup.", { tunnelId }, { required: ["tunnelId"] }),
    outputSchema: s.object(
      "The Tunnel connection result.",
      {
        connectors: s.array("cloudflared connector clients and their edge connections.", connector),
      },
      { required: ["connectors"] },
    ),
  }),
  defineProviderAction(service, {
    name: "add_published_application",
    description:
      "Idempotently add one HTTP(S) published application and ensure its proxied Tunnel CNAME. Mutations are serialized per account and Tunnel only within this runtime process; Cloudflare exposes no conditional configuration PUT, so concurrent Dashboard or other-runtime writes retain a residual race.",
    providerPermissions: [connectorsWrite, zoneRead, dnsWrite],
    inputSchema: {
      ...s.object(
        "Published application to add.",
        { tunnelId, zoneId, zoneName, hostname, service: serviceUrl, path },
        {
          required: ["tunnelId", "hostname", "service"],
          optional: ["zoneId", "zoneName", "path"],
        },
      ),
      oneOf: [{ required: ["zoneId"] }, { required: ["zoneName"] }],
    },
    outputSchema: s.object(
      "The resulting published application state.",
      {
        changed: s.boolean("Whether Cloudflare state changed."),
        ingress,
        dnsRecord,
        configurationVersion: s.nonNegativeInteger("The resulting Tunnel configuration version when reported."),
      },
      { required: ["changed", "ingress", "dnsRecord"], optional: ["configurationVersion"] },
    ),
  }),
  defineProviderAction(service, {
    name: "verify_published_application",
    description: "Verify Tunnel ingress, proxied CNAME, and connector state without making changes.",
    providerPermissions: [connectorsRead, zoneRead, dnsRead],
    inputSchema: {
      ...s.object(
        "Published application to verify.",
        { tunnelId, zoneId, zoneName, hostname, service: serviceUrl, path },
        {
          required: ["tunnelId", "hostname"],
          optional: ["zoneId", "zoneName", "service", "path"],
        },
      ),
      oneOf: [{ required: ["zoneId"] }, { required: ["zoneName"] }],
    },
    outputSchema: s.object(
      "The verification result.",
      {
        ok: s.boolean("Whether all required configuration checks passed."),
        checks: s.object(
          "Published-application verification checks.",
          {
            tunnelExists: s.boolean("Whether the Tunnel exists and is not deleted."),
            remotelyManaged: s.boolean("Whether the Tunnel and configuration are remotely managed."),
            ingressMatches: s.boolean("Whether exactly one effective ingress rule matches."),
            dnsMatches: s.boolean("Whether exactly one proxied Tunnel CNAME matches."),
            connectorHealthy: s.boolean("Whether at least one active edge connection exists."),
          },
          {
            required: ["tunnelExists", "remotelyManaged", "ingressMatches", "dnsMatches", "connectorHealthy"],
          },
        ),
        ingress,
        dnsRecord,
        activeConnections: s.nonNegativeInteger("The number of active Tunnel connector connections."),
      },
      { required: ["ok", "checks", "activeConnections"], optional: ["ingress", "dnsRecord"] },
    ),
  }),
];
