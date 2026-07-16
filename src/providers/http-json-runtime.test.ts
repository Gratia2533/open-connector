import { describe, expect, it } from "vitest";
import { requestJson } from "./http-json-runtime.ts";
import { ProviderRequestError } from "./provider-runtime.ts";

describe("requestJson", () => {
  it("rejects a response larger than maxResponseBytes", async () => {
    const fetcher = async () =>
      new Response(JSON.stringify({ data: "0123456789" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });

    const request = requestJson({
      providerName: "Test Provider",
      baseUrl: "https://provider.test",
      path: "/data",
      fetcher,
      maxResponseBytes: 8,
    });

    await expect(request).rejects.toMatchObject({ status: 413 } satisfies Partial<ProviderRequestError>);
  });
});
