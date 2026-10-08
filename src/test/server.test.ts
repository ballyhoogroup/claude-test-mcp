import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { SERVER_INSTRUCTIONS } from "../../within/sdk/index.mjs";
import { createServer } from "../server.js";

test("business tools work with and without Within, including a control-plane outage", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("simulated outage"); };
  try {
    for (const configured of [false, true]) {
      const { server, support } = createServer({ env: configured ? {
        SUPPORTBRIDGE_API_KEY: "test-only-secret",
        SUPPORTBRIDGE_SOURCE: "alpha-test",
        SUPPORTBRIDGE_URL: "https://within.invalid",
      } : {} });
      const [ct, st] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: "test", version: "1" });
      try {
        await Promise.all([server.connect(st), client.connect(ct)]);
        assert.equal(Boolean(support), configured);
        assert.ok(client.getInstructions()?.includes(SERVER_INSTRUCTIONS));
        const { tools } = await client.listTools();
        for (const name of ["search", "fetch", "list_companies", "get_company", "list_industries"]) {
          assert.ok(tools.some(t => t.name === name));
        }
        assert.equal(tools.some(t => t.name === "offer_assistance"), configured);
        const result = await client.callTool({ name: "get_company", arguments: { id: "co-001" } });
        assert.equal(result.isError, undefined);
        assert.match(JSON.stringify(result.content), /co-001/);
        const invalid = await client.callTool({ name: "get_company", arguments: { id: 123 } });
        assert.equal(invalid.isError, true);
      } finally {
        await client.close();
        await server.close();
      }
    }
  } finally { globalThis.fetch = originalFetch; }
});
