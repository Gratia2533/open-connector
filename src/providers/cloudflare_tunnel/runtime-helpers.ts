import {
  compactObject,
  optionalBoolean,
  optionalInteger,
  optionalRecord,
  optionalString,
  requiredString,
} from "../../core/cast.ts";
import { ProviderRequestError } from "../provider-runtime.ts";

export function normalizeTunnel(value: unknown): Record<string, unknown> {
  const tunnel = readObject(value, "Cloudflare Tunnel");
  return compactObject({
    id: requiredResponseString(tunnel.id, "Tunnel id"),
    name: optionalString(tunnel.name),
    status: optionalString(tunnel.status),
    accountTag: optionalString(tunnel.account_tag),
    createdAt: optionalString(tunnel.created_at),
    deletedAt: tunnel.deleted_at === null ? null : optionalString(tunnel.deleted_at),
    configSource: optionalString(tunnel.config_src),
  });
}

export function normalizeConfiguration(value: unknown): Record<string, unknown> {
  const configuration = readObject(value, "Cloudflare Tunnel configuration");
  return compactObject({
    tunnelId: optionalString(configuration.tunnel_id),
    version: optionalInteger(configuration.version),
    source: optionalString(configuration.source),
    createdAt: optionalString(configuration.created_at),
    config: readObject(configuration.config, "Cloudflare Tunnel config"),
  });
}

/** Normalize one connector client and its nested Cloudflare edge connections. */
export function normalizeConnector(value: unknown): Record<string, unknown> {
  const connector = readObject(value, "Cloudflare Tunnel connector");
  return compactObject({
    id: requiredResponseString(connector.id, "connector id"),
    arch: optionalString(connector.arch),
    configVersion: optionalInteger(connector.config_version),
    connections: Array.isArray(connector.conns) ? connector.conns.map(normalizeConnection) : [],
    features: Array.isArray(connector.features)
      ? connector.features.map(optionalString).filter((feature): feature is string => feature !== undefined)
      : undefined,
    runAt: optionalString(connector.run_at),
    version: optionalString(connector.version),
  });
}

/** Count connections that Cloudflare reports as actively serving traffic. */
export function countActiveConnections(connectors: Array<Record<string, unknown>>): number {
  return connectors.reduce((count, connector) => {
    if (!Array.isArray(connector.conns)) {
      return count;
    }
    return (
      count +
      connector.conns.filter(
        (connection) => optionalBoolean(optionalRecord(connection)?.is_pending_reconnect) === false,
      ).length
    );
  }, 0);
}

function normalizeConnection(value: unknown): Record<string, unknown> {
  const connection = readObject(value, "Cloudflare Tunnel connection");
  return compactObject({
    id: requiredResponseString(connection.id, "connection id"),
    clientId: optionalString(connection.client_id),
    clientVersion: optionalString(connection.client_version),
    coloName: optionalString(connection.colo_name),
    uuid: optionalString(connection.uuid),
    openedAt: optionalString(connection.opened_at),
    originIp: optionalString(connection.origin_ip),
    pendingReconnect: optionalBoolean(connection.is_pending_reconnect),
  });
}

export function normalizeResultInfo(value: unknown): Record<string, unknown> | undefined {
  const resultInfo = optionalRecord(value);
  return resultInfo
    ? compactObject({
        page: optionalInteger(resultInfo.page),
        perPage: optionalInteger(resultInfo.per_page),
        count: optionalInteger(resultInfo.count),
        totalCount: optionalInteger(resultInfo.total_count),
        totalPages: optionalInteger(resultInfo.total_pages),
      })
    : undefined;
}

export function boundedPerPage(value: unknown): number | undefined {
  const parsed = optionalInteger(value);
  if (parsed === undefined) {
    return undefined;
  }
  if (parsed < 1 || parsed > 1000) {
    throw new ProviderRequestError(400, "perPage must be between 1 and 1000");
  }
  return parsed;
}

export function readObject(value: unknown, fieldName: string): Record<string, unknown> {
  const record = optionalRecord(value);
  if (!record) {
    throw new ProviderRequestError(502, `${fieldName} returned a non-object payload`);
  }
  return record;
}

export function readArray(value: unknown, fieldName: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new ProviderRequestError(502, `${fieldName} returned a non-array payload`);
  }
  return value;
}

export function requiredCredentialString(value: unknown, fieldName: string): string {
  return requiredString(value, fieldName, (message) => new ProviderRequestError(400, message));
}

export function requiredResponseString(value: unknown, fieldName: string): string {
  const text = optionalString(value);
  if (!text) {
    throw new ProviderRequestError(502, `Cloudflare response is missing ${fieldName}`);
  }
  return text;
}

const maxErrorMessageChars = 500;

export function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, maxErrorMessageChars) : "unknown error";
}

export function cloudflareErrorMessage(envelope: Record<string, unknown>): string {
  for (const entry of Array.isArray(envelope.errors) ? envelope.errors : []) {
    const message = optionalString(optionalRecord(entry)?.message);
    if (message) {
      return message.slice(0, maxErrorMessageChars);
    }
  }
  return "Cloudflare request was not successful";
}
