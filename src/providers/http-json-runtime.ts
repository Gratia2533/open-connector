import type { QueryValue } from "../core/request.ts";
import type { ProviderFetch } from "./provider-runtime.ts";

import { optionalRecord, optionalString } from "../core/cast.ts";
import { queryParams } from "../core/request.ts";
import { providerUserAgent, ProviderRequestError } from "./provider-runtime.ts";

export type ProviderRequestPhase = "validate" | "execute";

export interface JsonRequestOptions {
  providerName: string;
  baseUrl: string;
  path: string;
  fetcher: ProviderFetch;
  signal?: AbortSignal;
  method?: string;
  headers?: Record<string, string>;
  query?: Record<string, QueryValue>;
  body?: unknown;
  phase?: ProviderRequestPhase;
  maxResponseBytes?: number;
}

export async function requestJson(input: JsonRequestOptions): Promise<unknown> {
  let response: Response;
  let payload: unknown;
  try {
    response = await input.fetcher(buildJsonRequestUrl(input.baseUrl, input.path, input.query), {
      method: input.method ?? (input.body === undefined ? "GET" : "POST"),
      headers: buildJsonRequestHeaders(input.headers, input.body),
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
      signal: input.signal,
    });
    payload = await readJsonResponse(response, input.providerName, input.maxResponseBytes);
  } catch (error) {
    if (error instanceof ProviderRequestError) {
      throw error;
    }
    throw new ProviderRequestError(
      502,
      error instanceof Error
        ? `${input.providerName} request failed: ${error.message}`
        : `${input.providerName} request failed`,
    );
  }

  if (!response.ok) {
    throw createJsonRequestError(input.providerName, response.status, payload, input.phase ?? "execute");
  }

  return payload;
}

export function objectPayload(payload: unknown, fieldName: string): Record<string, unknown> {
  const record = optionalRecord(payload);
  if (record) {
    return record;
  }
  throw new ProviderRequestError(502, `${fieldName} returned a non-object payload`, payload);
}

export function arrayPayload(payload: unknown, fieldName: string): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  throw new ProviderRequestError(502, `${fieldName} returned a non-array payload`, payload);
}

export function firstString(input: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  if (!input) {
    return undefined;
  }
  for (const key of keys) {
    const value = optionalString(input[key]);
    if (value) {
      return value;
    }
  }
  return undefined;
}

export function definedBody(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function buildJsonRequestUrl(baseUrl: string, path: string, query: Record<string, QueryValue> = {}): string {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
  const url = new URL(normalizedPath, normalizedBase);
  for (const [key, value] of Object.entries(queryParams(query))) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function buildJsonRequestHeaders(headers: Record<string, string> = {}, body: unknown): Record<string, string> {
  const output: Record<string, string> = {
    accept: "application/json",
    "user-agent": providerUserAgent,
    ...headers,
  };
  if (body !== undefined && !hasHeader(output, "content-type")) {
    output["content-type"] = "application/json";
  }
  return output;
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const normalized = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === normalized);
}

async function readJsonResponse(response: Response, providerName: string, maxResponseBytes?: number): Promise<unknown> {
  const text = await readResponseText(response, providerName, maxResponseBytes);
  if (!text.trim()) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ProviderRequestError(502, `${providerName} returned invalid JSON`);
  }
}

async function readResponseText(response: Response, providerName: string, maxResponseBytes?: number): Promise<string> {
  if (maxResponseBytes === undefined) {
    return response.text();
  }
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes <= 0) {
    throw new ProviderRequestError(500, "maxResponseBytes must be a positive integer");
  }

  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    const parsedLength = Number.parseInt(contentLength, 10);
    if (Number.isFinite(parsedLength) && parsedLength > maxResponseBytes) {
      throw responseSizeError(providerName, maxResponseBytes);
    }
  }

  if (!response.body) {
    return "";
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    totalBytes += value.byteLength;
    if (totalBytes > maxResponseBytes) {
      await reader.cancel();
      throw responseSizeError(providerName, maxResponseBytes);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function responseSizeError(providerName: string, maxResponseBytes: number): ProviderRequestError {
  return new ProviderRequestError(502, `${providerName} response exceeded ${maxResponseBytes} bytes`);
}

function createJsonRequestError(
  providerName: string,
  status: number,
  payload: unknown,
  phase: ProviderRequestPhase,
): ProviderRequestError {
  const message = extractProviderErrorMessage(payload) ?? `${providerName} request failed with HTTP ${status}`;
  if (status === 429) {
    return new ProviderRequestError(429, message, payload);
  }
  if (phase === "validate" && (status === 401 || status === 403)) {
    return new ProviderRequestError(400, message, payload);
  }
  if (status === 400 || status === 404 || status === 422) {
    return new ProviderRequestError(400, message, payload);
  }
  return new ProviderRequestError(status || 502, message, payload);
}

function extractProviderErrorMessage(payload: unknown): string | undefined {
  if (typeof payload === "string" && payload.trim()) {
    return payload;
  }
  const record = optionalRecord(payload);
  if (!record) {
    return undefined;
  }
  return (
    optionalString(record.message) ??
    optionalString(record.Message) ??
    optionalString(record.error) ??
    optionalString(record.Error) ??
    optionalString(record.detail) ??
    optionalString(record.Detail) ??
    optionalString(record.title) ??
    optionalString(record.Title)
  );
}
