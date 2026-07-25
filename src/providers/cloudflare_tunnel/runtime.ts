import type { CredentialValidationResult } from "../../core/types.ts";
import type { ProviderFetch, ProviderRuntimeHandler } from "../provider-runtime.ts";
import type { CloudflareTunnelActionName } from "./actions.ts";

import {
  compactObject,
  optionalBoolean,
  optionalInteger,
  optionalRecord,
  optionalString,
  requiredString,
} from "../../core/cast.ts";
import { requestJson } from "../http-json-runtime.ts";
import { ProviderRequestError } from "../provider-runtime.ts";
import {
  assertCatchAllLast,
  findIngresses,
  hasUniqueFinalCatchAll,
  insertIngressRule,
  isIngressEffectivelyOrdered,
} from "./ingress-rules.ts";
import { withProcessLocalMutationLock } from "./mutation-lock.ts";
import {
  boundedPerPage,
  cloudflareErrorMessage,
  countActiveConnections,
  normalizeConfiguration,
  normalizeConnector,
  normalizeResultInfo,
  normalizeTunnel,
  readArray,
  readObject,
  requiredCredentialString,
  requiredResponseString,
  safeErrorMessage,
} from "./runtime-helpers.ts";

interface CloudflareEnvelope {
  success?: unknown;
  result?: unknown;
  errors?: unknown;
  messages?: unknown;
  result_info?: unknown;
}

interface CloudflareRequest {
  method?: "GET" | "POST" | "PUT";
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  phase?: "validate" | "execute";
}

export interface CloudflareTunnelContext {
  accessToken: string;
  accountId: string;
  fetcher: ProviderFetch;
  signal?: AbortSignal;
}

type ZoneSelector = { zoneId: string } | { zoneName: string };

interface ResolvedZone {
  zoneId: string;
  zone: Record<string, unknown>;
}

const apiBaseUrl = "https://api.cloudflare.com/client/v4";
const maxResponseBytes = 5 * 1024 * 1024;

export const cloudflareTunnelActionHandlers: Record<
  CloudflareTunnelActionName,
  ProviderRuntimeHandler<CloudflareTunnelContext>
> = {
  list_tunnels(input, context) {
    return listTunnels(input, context);
  },
  get_tunnel(input, context) {
    return getTunnel(input, context);
  },
  get_tunnel_configuration(input, context) {
    return getTunnelConfiguration(input, context);
  },
  list_tunnel_connections(input, context) {
    return listTunnelConnections(input, context);
  },
  add_published_application(input, context) {
    const tunnelId = requiredInputString(input.tunnelId, "tunnelId");
    const lockKey = JSON.stringify([context.accountId, tunnelId]);
    return withProcessLocalMutationLock(lockKey, () => addPublishedApplication(input, context));
  },
  verify_published_application(input, context) {
    return verifyPublishedApplication(input, context);
  },
};

export async function validateCloudflareTunnelCredential(
  values: Record<string, unknown>,
  fetcher: ProviderFetch,
  signal?: AbortSignal,
): Promise<CredentialValidationResult> {
  const accessToken = requiredCredentialString(values.apiKey, "apiKey");
  const accountId = requiredCredentialString(values.accountId, "accountId");
  const endpoint = `/accounts/${encodeURIComponent(accountId)}/cfd_tunnel`;
  const envelope = await requestCloudflare(
    { accessToken, accountId, fetcher, signal },
    {
      path: endpoint,
      query: { is_deleted: false, page: 1, per_page: 1 },
      phase: "validate",
    },
  );
  const tunnels = readArray(envelope.result, "Cloudflare Tunnel validation");
  const first = optionalRecord(tunnels[0]);
  return {
    profile: { accountId },
    grantedScopes: [],
    metadata: compactObject({
      accountId,
      validationEndpoint: `${endpoint}?is_deleted=false&page=1&per_page=1`,
      firstTunnelId: optionalString(first?.id),
      firstTunnelName: optionalString(first?.name),
    }),
  };
}

async function listTunnels(input: Record<string, unknown>, context: CloudflareTunnelContext): Promise<unknown> {
  const envelope = await requestCloudflare(context, {
    path: accountTunnelPath(context.accountId),
    query: {
      is_deleted: false,
      name: optionalString(input.name),
      status: optionalString(input.status),
      page: optionalInteger(input.page),
      per_page: boundedPerPage(input.perPage),
    },
  });
  return {
    tunnels: readArray(envelope.result, "Cloudflare Tunnel list").map(normalizeTunnel),
    resultInfo: normalizeResultInfo(envelope.result_info),
  };
}

async function getTunnel(input: Record<string, unknown>, context: CloudflareTunnelContext): Promise<unknown> {
  const envelope = await requestCloudflare(context, {
    path: tunnelPath(context.accountId, String(input.tunnelId)),
  });
  return { tunnel: normalizeTunnel(envelope.result) };
}

async function getTunnelConfiguration(
  input: Record<string, unknown>,
  context: CloudflareTunnelContext,
): Promise<unknown> {
  const envelope = await requestCloudflare(context, {
    path: `${tunnelPath(context.accountId, String(input.tunnelId))}/configurations`,
  });
  return { configuration: normalizeConfiguration(envelope.result) };
}

async function listTunnelConnections(
  input: Record<string, unknown>,
  context: CloudflareTunnelContext,
): Promise<unknown> {
  const envelope = await requestCloudflare(context, {
    path: `${tunnelPath(context.accountId, String(input.tunnelId))}/connections`,
  });
  return {
    connectors: readArray(envelope.result, "Cloudflare Tunnel connections").map(normalizeConnector),
  };
}

async function addPublishedApplication(
  input: Record<string, unknown>,
  context: CloudflareTunnelContext,
): Promise<unknown> {
  const tunnelId = requiredInputString(input.tunnelId, "tunnelId");
  const zoneSelector = readZoneSelector(input);
  const hostname = normalizeHostname(input.hostname);
  const service = normalizeServiceUrl(input.service);
  const path = optionalString(input.path);
  const ingress = compactObject({ hostname, service, path });

  const tunnel = await readTunnelRaw(context, tunnelId);
  if (tunnel.deleted_at) {
    throw new ProviderRequestError(400, "cannot publish an application on a deleted Tunnel");
  }
  if (optionalString(tunnel.config_src) !== "cloudflare") {
    throw new ProviderRequestError(400, "published applications can be changed only on remotely-managed Tunnels");
  }

  const initialConfiguration = await readConfigurationRaw(context, tunnelId);
  if (optionalString(initialConfiguration.source) !== "cloudflare") {
    throw new ProviderRequestError(
      400,
      "published applications can be changed only on remotely-managed configurations",
    );
  }
  const originalConfig = readObject(initialConfiguration.config, "Cloudflare Tunnel config");
  const existingIngress = readArray(originalConfig.ingress, "Cloudflare Tunnel ingress").map((rule) =>
    readObject(rule, "Cloudflare Tunnel ingress rule"),
  );
  assertCatchAllLast(existingIngress);
  const matchingIngresses = findIngresses(existingIngress, hostname, path);
  if (matchingIngresses.length > 1) {
    throw new ProviderRequestError(409, `hostname ${hostname} has duplicate ingress rules for the requested path`);
  }
  const matchingIngress = matchingIngresses[0];
  const matchingIngressIndex = matchingIngress ? existingIngress.indexOf(matchingIngress) : -1;
  if (matchingIngress && !isIngressEffectivelyOrdered(existingIngress, matchingIngressIndex, hostname)) {
    throw new ProviderRequestError(409, `hostname ${hostname} has a matching ingress rule that is shadowed`);
  }
  if (matchingIngress && optionalString(matchingIngress.service) !== service) {
    throw new ProviderRequestError(409, `hostname ${hostname} already routes to a different service`);
  }

  const { zoneId, zone } = await resolveZone(context, zoneSelector, hostname);
  assertZoneMatchesAccountAndHostname(zone, context.accountId, hostname);

  const expectedCname = `${tunnelId}.cfargotunnel.com`;
  const existingRecords = await listDnsRecords(context, zoneId, hostname);
  const matchingDns = findMatchingTunnelCname(existingRecords, hostname, expectedCname);
  if (existingRecords.length > 0 && !matchingDns) {
    throw new ProviderRequestError(409, `hostname ${hostname} already has a conflicting DNS record`);
  }

  if (matchingIngress && matchingDns) {
    return {
      changed: false,
      ingress: normalizeIngress(matchingIngress),
      dnsRecord: normalizeDnsRecord(matchingDns),
      configurationVersion: optionalInteger(initialConfiguration.version),
    };
  }

  let configurationVersion = optionalInteger(initialConfiguration.version);
  let appliedConfig: Record<string, unknown> | undefined;
  if (!matchingIngress) {
    const latestConfiguration = await readConfigurationRaw(context, tunnelId);
    assertConfigurationUnchanged(initialConfiguration, latestConfiguration);
    appliedConfig = {
      ...originalConfig,
      ingress: insertIngressRule(existingIngress, ingress, hostname),
    };
    const updated = await requestCloudflare(context, {
      method: "PUT",
      path: `${tunnelPath(context.accountId, tunnelId)}/configurations`,
      body: { config: appliedConfig },
    });
    configurationVersion = optionalInteger(readObject(updated.result, "Cloudflare Tunnel configuration").version);
  }

  let dnsRecord = matchingDns;
  if (!dnsRecord) {
    try {
      const created = await requestCloudflare(context, {
        method: "POST",
        path: `/zones/${encodeURIComponent(zoneId)}/dns_records`,
        body: { type: "CNAME", name: hostname, content: expectedCname, proxied: true, ttl: 1 },
      });
      dnsRecord = readObject(created.result, "Cloudflare DNS record");
    } catch (dnsError) {
      let concurrentRecords: Array<Record<string, unknown>>;
      try {
        concurrentRecords = await listDnsRecords(context, zoneId, hostname);
      } catch (verificationError) {
        throw new ProviderRequestError(
          502,
          "DNS creation failed and DNS state could not be verified; manual reconciliation is required",
          {
            partialState: appliedConfig
              ? "Tunnel ingress is present while DNS state is unknown"
              : "Tunnel ingress already existed while DNS state is unknown",
            dnsError: safeErrorMessage(dnsError),
            verificationError: safeErrorMessage(verificationError),
          },
        );
      }
      const concurrentDns = findMatchingTunnelCname(concurrentRecords, hostname, expectedCname);
      if (concurrentDns) {
        dnsRecord = concurrentDns;
      } else {
        throw new ProviderRequestError(
          502,
          "DNS creation failed; published application may be partially configured; manual reconciliation is required",
          {
            partialState: appliedConfig
              ? "Tunnel ingress is present while the expected DNS record is absent"
              : "Tunnel ingress already existed while the expected DNS record is absent",
            dnsError: safeErrorMessage(dnsError),
          },
        );
      }
    }
  }

  const finalConfiguration = await readConfigurationRaw(context, tunnelId);
  const finalConfig = readObject(finalConfiguration.config, "Cloudflare Tunnel config");
  const finalIngressRules = readArray(finalConfig.ingress, "Cloudflare Tunnel ingress").map((rule) =>
    readObject(rule, "Cloudflare Tunnel ingress rule"),
  );
  const finalIngressMatches = findIngresses(finalIngressRules, hostname, path);
  const finalIngress = finalIngressMatches.length === 1 ? finalIngressMatches[0] : undefined;
  const finalIngressIndex = finalIngress ? finalIngressRules.indexOf(finalIngress) : -1;
  const finalRecords = await listDnsRecords(context, zoneId, hostname);
  const finalDns = findMatchingTunnelCname(finalRecords, hostname, expectedCname);
  if (
    !finalIngress ||
    optionalString(finalIngress.service) !== service ||
    !finalDns ||
    !hasUniqueFinalCatchAll(finalIngressRules) ||
    !isIngressEffectivelyOrdered(finalIngressRules, finalIngressIndex, hostname)
  ) {
    throw new ProviderRequestError(502, "Cloudflare published application read-back verification failed");
  }

  return {
    changed: true,
    ingress: normalizeIngress(finalIngress),
    dnsRecord: normalizeDnsRecord(finalDns ?? dnsRecord),
    configurationVersion: optionalInteger(finalConfiguration.version) ?? configurationVersion,
  };
}

async function verifyPublishedApplication(
  input: Record<string, unknown>,
  context: CloudflareTunnelContext,
): Promise<unknown> {
  const tunnelId = requiredInputString(input.tunnelId, "tunnelId");
  const zoneSelector = readZoneSelector(input);
  const hostname = normalizeHostname(input.hostname);
  const expectedService = input.service === undefined ? undefined : normalizeServiceUrl(input.service);
  const path = optionalString(input.path);
  const tunnel = await readTunnelRaw(context, tunnelId);
  const configuration = await readConfigurationRaw(context, tunnelId);
  const config = readObject(configuration.config, "Cloudflare Tunnel config");
  const { zoneId, zone } = await resolveZone(context, zoneSelector, hostname);
  assertZoneMatchesAccountAndHostname(zone, context.accountId, hostname);
  const ingressRules = readArray(config.ingress, "Cloudflare Tunnel ingress").map((rule) =>
    readObject(rule, "Cloudflare Tunnel ingress rule"),
  );
  const ingressMatches = findIngresses(ingressRules, hostname, path);
  const ingress = ingressMatches.length === 1 ? ingressMatches[0] : undefined;
  const ingressIndex = ingress ? ingressRules.indexOf(ingress) : -1;
  const records = await listDnsRecords(context, zoneId, hostname);
  const dnsRecord = findMatchingTunnelCname(records, hostname, `${tunnelId}.cfargotunnel.com`);
  const connectionEnvelope = await requestCloudflare(context, {
    path: `${tunnelPath(context.accountId, tunnelId)}/connections`,
  });
  const connectors = readArray(connectionEnvelope.result, "Cloudflare Tunnel connections").map((connector) =>
    readObject(connector, "Cloudflare Tunnel connector"),
  );
  const activeConnections = countActiveConnections(connectors);
  const remotelyManaged =
    (tunnel.deleted_at === null || tunnel.deleted_at === undefined) &&
    optionalString(tunnel.config_src) === "cloudflare" &&
    optionalString(configuration.source) === "cloudflare";
  const ingressMatchesService = Boolean(
    ingress &&
    hasUniqueFinalCatchAll(ingressRules) &&
    isIngressEffectivelyOrdered(ingressRules, ingressIndex, hostname) &&
    (expectedService === undefined || optionalString(ingress.service) === expectedService),
  );
  const checks = {
    tunnelExists: tunnel.deleted_at === null || tunnel.deleted_at === undefined,
    remotelyManaged,
    ingressMatches: ingressMatchesService,
    dnsMatches: Boolean(dnsRecord),
    connectorHealthy: activeConnections > 0,
  };
  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    ingress: ingress ? normalizeIngress(ingress) : undefined,
    dnsRecord: dnsRecord ? normalizeDnsRecord(dnsRecord) : undefined,
    activeConnections,
  };
}

async function readTunnelRaw(context: CloudflareTunnelContext, tunnelId: string): Promise<Record<string, unknown>> {
  const envelope = await requestCloudflare(context, { path: tunnelPath(context.accountId, tunnelId) });
  return readObject(envelope.result, "Cloudflare Tunnel");
}

async function readConfigurationRaw(
  context: CloudflareTunnelContext,
  tunnelId: string,
): Promise<Record<string, unknown>> {
  const envelope = await requestCloudflare(context, {
    path: `${tunnelPath(context.accountId, tunnelId)}/configurations`,
  });
  return readObject(envelope.result, "Cloudflare Tunnel configuration");
}

function readZoneSelector(input: Record<string, unknown>): ZoneSelector {
  const zoneId = optionalString(input.zoneId);
  const zoneName = optionalString(input.zoneName);
  if (zoneId && !zoneName) return { zoneId };
  if (zoneName && !zoneId) return { zoneName: normalizeHostname(zoneName) };
  throw new ProviderRequestError(400, "provide exactly one of zoneId or zoneName");
}

async function resolveZone(
  context: CloudflareTunnelContext,
  selector: ZoneSelector,
  hostname: string,
): Promise<ResolvedZone> {
  if ("zoneId" in selector) {
    return { zoneId: selector.zoneId, zone: await readZoneRaw(context, selector.zoneId) };
  }
  const envelope = await requestCloudflare(context, {
    path: "/zones",
    query: { name: selector.zoneName, "account.id": context.accountId, page: 1, per_page: 5 },
  });
  const zones = readArray(envelope.result, "Cloudflare zone lookup").map((zone) => readObject(zone, "Cloudflare zone"));
  if (zones.length !== 1) {
    throw new ProviderRequestError(409, `zoneName ${selector.zoneName} must resolve to exactly one Zone`);
  }
  const zone = zones[0];
  if (requiredResponseString(zone.name, "zone name").toLowerCase() !== selector.zoneName) {
    throw new ProviderRequestError(502, "Cloudflare zone lookup returned a different zone name");
  }
  assertZoneMatchesAccountAndHostname(zone, context.accountId, hostname);
  return { zoneId: requiredResponseString(zone.id, "zone id"), zone };
}

async function readZoneRaw(context: CloudflareTunnelContext, zoneId: string): Promise<Record<string, unknown>> {
  const envelope = await requestCloudflare(context, { path: `/zones/${encodeURIComponent(zoneId)}` });
  return readObject(envelope.result, "Cloudflare zone");
}

async function listDnsRecords(
  context: CloudflareTunnelContext,
  zoneId: string,
  hostname: string,
): Promise<Array<Record<string, unknown>>> {
  const records: Array<Record<string, unknown>> = [];
  const maxPages = 100;
  for (let page = 1; page <= maxPages; page += 1) {
    const envelope = await requestCloudflare(context, {
      path: `/zones/${encodeURIComponent(zoneId)}/dns_records`,
      query: { name: hostname, match: "all", page, per_page: 100 },
    });
    records.push(
      ...readArray(envelope.result, "Cloudflare DNS records").map((record) =>
        readObject(record, "Cloudflare DNS record"),
      ),
    );
    if (records.length > 1) {
      return records;
    }

    const resultInfo = optionalRecord(envelope.result_info);
    const reportedPage = optionalInteger(resultInfo?.page);
    const totalPages = optionalInteger(resultInfo?.total_pages);
    if (!resultInfo || reportedPage !== page || totalPages === undefined || totalPages < page) {
      throw new ProviderRequestError(502, "Cloudflare DNS pagination metadata is missing or inconsistent");
    }
    if (totalPages > maxPages) {
      throw new ProviderRequestError(409, "Cloudflare DNS result set is too large to verify safely");
    }
    if (page === totalPages) {
      return records;
    }
  }
  throw new ProviderRequestError(409, "Cloudflare DNS result set is too large to verify safely");
}

function assertZoneMatchesAccountAndHostname(zone: Record<string, unknown>, accountId: string, hostname: string): void {
  if (optionalString(optionalRecord(zone.account)?.id) !== accountId) {
    throw new ProviderRequestError(400, "zone does not belong to the configured Cloudflare account");
  }
  const zoneName = requiredResponseString(zone.name, "zone name").toLowerCase();
  if (hostname !== zoneName && !hostname.endsWith(`.${zoneName}`)) {
    throw new ProviderRequestError(400, "hostname does not belong to the selected Cloudflare zone");
  }
}

function findMatchingTunnelCname(
  records: Array<Record<string, unknown>>,
  hostname: string,
  expectedContent: string,
): Record<string, unknown> | undefined {
  if (records.length !== 1) {
    return undefined;
  }
  const record = records[0];
  return optionalString(record.type) === "CNAME" &&
    optionalString(record.name)?.toLowerCase() === hostname &&
    optionalString(record.content)?.toLowerCase() === expectedContent.toLowerCase() &&
    optionalBoolean(record.proxied) === true
    ? record
    : undefined;
}

function normalizeIngress(rule: Record<string, unknown>): Record<string, unknown> {
  return compactObject({
    hostname: optionalString(rule.hostname)?.toLowerCase(),
    service: optionalString(rule.service),
    path: optionalString(rule.path),
    originRequest: optionalRecord(rule.originRequest),
  });
}

function normalizeDnsRecord(record: Record<string, unknown>): Record<string, unknown> {
  return compactObject({
    id: optionalString(record.id),
    zoneId: optionalString(record.zone_id),
    type: optionalString(record.type),
    name: optionalString(record.name)?.toLowerCase(),
    content: optionalString(record.content),
    proxied: optionalBoolean(record.proxied),
    ttl: optionalInteger(record.ttl),
  });
}

function assertConfigurationUnchanged(initial: Record<string, unknown>, latest: Record<string, unknown>): void {
  if (
    optionalInteger(initial.version) !== optionalInteger(latest.version) ||
    JSON.stringify(initial.config) !== JSON.stringify(latest.config)
  ) {
    throw new ProviderRequestError(
      409,
      "Tunnel configuration changed during the publish workflow; retry from fresh state",
    );
  }
}

function normalizeHostname(value: unknown): string {
  const hostname = requiredInputString(value, "hostname").toLowerCase();
  if (
    hostname.length > 253 ||
    hostname.includes("*") ||
    !hostname.includes(".") ||
    !hostname.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  ) {
    throw new ProviderRequestError(400, "hostname must be a valid non-wildcard fully qualified domain name");
  }
  return hostname;
}

function normalizeServiceUrl(value: unknown): string {
  const raw = requiredInputString(value, "service");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ProviderRequestError(400, "service must be an absolute HTTP or HTTPS URL");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new ProviderRequestError(400, "service must be an HTTP(S) URL without credentials or fragments");
  }
  return url.toString().replace(/\/$/, "");
}

function requiredInputString(value: unknown, fieldName: string): string {
  return requiredString(value, fieldName, (message) => new ProviderRequestError(400, message));
}

async function requestCloudflare(
  context: CloudflareTunnelContext,
  request: CloudflareRequest,
): Promise<CloudflareEnvelope> {
  let payload: unknown;
  try {
    payload = await requestJson({
      providerName: "Cloudflare Tunnel",
      baseUrl: apiBaseUrl,
      path: request.path,
      method: request.method,
      headers: { authorization: `Bearer ${context.accessToken}` },
      query: request.query,
      body: request.body,
      phase: request.phase,
      maxResponseBytes,
      fetcher: context.fetcher,
      signal: context.signal,
    });
  } catch (error) {
    if (error instanceof ProviderRequestError) {
      const details = optionalRecord(error.details);
      const message = details ? cloudflareErrorMessage(details) : undefined;
      throw new ProviderRequestError(error.status, message ?? safeErrorMessage(error));
    }
    throw new ProviderRequestError(502, safeErrorMessage(error));
  }
  const envelope = readObject(payload, "Cloudflare response");
  if (envelope.success === false) {
    throw new ProviderRequestError(400, cloudflareErrorMessage(envelope));
  }
  return envelope;
}

function accountTunnelPath(accountId: string): string {
  return `/accounts/${encodeURIComponent(accountId)}/cfd_tunnel`;
}

function tunnelPath(accountId: string, tunnelId: string): string {
  return `${accountTunnelPath(accountId)}/${encodeURIComponent(tunnelId)}`;
}
