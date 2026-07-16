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
});
