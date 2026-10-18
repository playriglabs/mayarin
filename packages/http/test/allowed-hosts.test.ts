import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { allowedHosts, parseHostList } from "../src/allowed-hosts.ts";

function app(hosts: string[]) {
  const hono = new Hono();
  hono.use("*", allowedHosts({ hosts }));
  hono.get("/health", (c) => c.text("ok"));
  hono.get("/v1/x", (c) => c.text("hit"));
  return hono;
}

const get = (hono: Hono, path: string, host?: string) =>
  hono.request(path, host === undefined ? {} : { headers: { host } });

describe("allowed hosts (SEC-13)", () => {
  test("answers a listed host, ignoring case and port", async () => {
    const hono = app(["api.mayarin.xyz"]);
    expect((await get(hono, "/v1/x", "api.mayarin.xyz")).status).toBe(200);
    expect((await get(hono, "/v1/x", "API.Mayarin.xyz:443")).status).toBe(200);
  });

  test("404s the generated origin domain and a missing Host", async () => {
    const hono = app(["api.mayarin.xyz"]);
    expect((await get(hono, "/v1/x", "mayarin-api-production.up.railway.app")).status).toBe(404);
    expect((await get(hono, "/v1/x", "")).status).toBe(404);
  });

  test("lets the health probe through whatever the host", async () => {
    const hono = app(["api.mayarin.xyz"]);
    expect((await get(hono, "/health", "healthcheck.railway.app")).status).toBe(200);
  });

  test("an empty list switches the check off", async () => {
    expect((await get(app([]), "/v1/x", "anything.example")).status).toBe(200);
  });

  test("parses a comma-separated list", () => {
    expect(parseHostList(" a.example, ,b.example ")).toEqual(["a.example", "b.example"]);
    expect(parseHostList("")).toEqual([]);
  });
});
