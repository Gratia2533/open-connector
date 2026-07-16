import { describe, expect, it, vi } from "vitest";
import { requestJson } from "./http-json-runtime.ts";

describe("requestJson response limits", () => {
  it("rejects a streamed body that exceeds maxResponseBytes", async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
        new Response("12345", { status: 200 }),
    );

    await expect(
      requestJson({
        providerName: "Limited API",
        baseUrl: "https://api.example.com",
        path: "/data",
        fetcher,
        maxResponseBytes: 4,
      }),
    ).rejects.toThrow("response exceeded 4 bytes");
  });

  it("parses JSON below maxResponseBytes", async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => Response.json({ ok: true }),
    );

    await expect(
      requestJson({
        providerName: "Limited API",
        baseUrl: "https://api.example.com",
        path: "/data",
        fetcher,
        maxResponseBytes: 1024,
      }),
    ).resolves.toEqual({ ok: true });
  });
});
