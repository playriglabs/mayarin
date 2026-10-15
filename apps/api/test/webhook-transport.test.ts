import { describe, expect, test } from "bun:test";
import { ValidationError } from "@mayarin/shared";
import { PinnedWebhookTransport } from "../src/services/webhook-transport.ts";

function transportResolving(addresses: readonly string[]) {
  const resolved: string[] = [];
  const transport = new PinnedWebhookTransport({
    timeoutMs: 500,
    resolve: async (hostname) => {
      resolved.push(hostname);
      return addresses;
    },
  });
  return { transport, resolved };
}

const send = (transport: PinnedWebhookTransport, url: string) =>
  transport.post({ url, body: "{}", headers: {} });

describe("PinnedWebhookTransport", () => {
  test("a name that now resolves to a private address is refused (DNS rebinding)", async () => {
    for (const address of ["127.0.0.1", "169.254.169.254", "10.0.0.5", "::1", "fd00::1"]) {
      const { transport } = transportResolving([address]);
      await expect(send(transport, "https://merchant.example/hook")).rejects.toThrow(
        "public address",
      );
    }
  });

  test("one private answer among public ones refuses the delivery", async () => {
    const { transport } = transportResolving(["8.8.8.8", "10.0.0.5"]);
    await expect(send(transport, "https://merchant.example/hook")).rejects.toThrow(
      "public address",
    );
  });

  test("a host that resolves to nothing is refused", async () => {
    const { transport } = transportResolving([]);
    await expect(send(transport, "https://merchant.example/hook")).rejects.toThrow(
      "public address",
    );
  });

  test("the registration policy applies at delivery too", async () => {
    const { transport, resolved } = transportResolving(["8.8.8.8"]);
    for (const url of [
      "http://merchant.example/hook",
      "https://merchant.example:8443/hook",
      "https://user:pass@merchant.example/hook",
      "https://127.0.0.1/hook",
      "https://localhost/hook",
    ]) {
      await expect(send(transport, url)).rejects.toThrow(ValidationError);
    }
    // Refused before any name was resolved.
    expect(resolved).toEqual([]);
  });
});
