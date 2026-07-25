import { describe, expect, it } from "vitest";
import { withProcessLocalMutationLock } from "./mutation-lock.ts";

describe("Cloudflare Tunnel process-local mutation lock", () => {
  it.each([
    { accountId: "account-1", tunnelId: "tunnel-2", label: "the same account and a different Tunnel" },
    { accountId: "account-2", tunnelId: "tunnel-1", label: "a different account and the same Tunnel" },
  ])("does not block $label", async ({ accountId, tunnelId }) => {
    let releaseFirst = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = withProcessLocalMutationLock(JSON.stringify(["account-1", "tunnel-1"]), async () => {
      await gate;
      return "first";
    });
    const independent = withProcessLocalMutationLock(JSON.stringify([accountId, tunnelId]), async () => "independent");

    await expect(independent).resolves.toBe("independent");
    releaseFirst();
    await expect(first).resolves.toBe("first");
  });
});
