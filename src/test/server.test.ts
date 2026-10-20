import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.COMPANY_ACCESS_STORE_PATH = join(mkdtempSync(join(tmpdir(), "pitch-mcp-test-")), "access.json");
const { createServer } = await import("../server.js");

async function connectedClient(userId = `test-${crypto.randomUUID()}`) {
  const { server } = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const send = clientTransport.send.bind(clientTransport);
  clientTransport.send = (message, options) => send(message, { ...options, authInfo: { token: "test", clientId: "test", scopes: [], extra: { sub: userId } } });
  const client = new Client({ name: "pitch-fork-test", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}



test("exposes only five business tools with no SDK instructions or UI resources", async () => {
  const { client, server } = await connectedClient();
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(tool => tool.name).sort(), ["fetch", "get_company", "list_companies", "list_industries", "search"]);
    assert.equal(client.getServerCapabilities()?.resources, undefined);
    assert.equal(client.getInstructions(), "Pitch-Fork provides company discovery and market intelligence from its company catalog.");
    assert.ok(tools.every(tool => tool._meta === undefined));
    const removed = await client.callTool({ name: "get_vendor_answer", arguments: { topic: "pricing", question: "Cost?" } });
    assert.equal(removed.isError, true);
    assert.match(JSON.stringify(removed.content), /not found/i);
  } finally { await client.close(); await server.close(); }
});

test("business calls make no external service requests", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error("Unexpected external service call"); };
  const { client, server } = await connectedClient();
  try {
    const result = await client.callTool({ name: "search", arguments: { query: "CashGrid" } });
    assert.notEqual(result.isError, true);
    assert.match(JSON.stringify(result.content), /CashGrid/);
    assert.equal(result.structuredContent, undefined);
    assert.equal(result._meta, undefined);
    assert.equal(requests, 0);
  } finally { globalThis.fetch = originalFetch; await client.close(); await server.close(); }
});

test("business tools keep their schemas and results", async () => {
  const { client, server } = await connectedClient();
  try {
    const result = await client.callTool({ name: "get_company", arguments: { id: "co-001" } });
    assert.equal(result.isError, undefined);
    assert.match(JSON.stringify(result.content), /co-001/);
    const industries = await client.callTool({ name: "list_industries", arguments: {} });
    assert.equal(industries.isError, undefined);
    assert.match(JSON.stringify(industries.content), /fintech/);
  } finally {
    await client.close();
    await server.close();
  }
});

test("business tool descriptions stay business-only", async () => {
  const { client, server } = await connectedClient();
  try {
    const tools = await client.listTools();
    const expected = new Map([
      ["search", "Search Pitch Fork companies by name, industry, or location."],
      ["fetch", "Fetch a Pitch Fork company record by ID."],
      ["list_companies", "List Pitch Fork companies with optional industry, location, and valuation filters."],
      ["get_company", "Get a Pitch Fork company record by ID."],
      ["list_industries", "List Pitch Fork industries and company counts."],
    ]);
    for (const [name, description] of expected) {
      assert.equal(tools.tools.find((tool) => tool.name === name)?.description, description);
    }
  } finally {
    await client.close();
    await server.close();
  }
});

test("company budget is shared across MCP tool calls and fresh server instances", async () => {
  const user = `quota-${crypto.randomUUID()}`;
  const first = await connectedClient(user);
  try {
    const result = await first.client.callTool({ name: "list_companies", arguments: { limit: 100 } });
    const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);
    assert.equal(data.companies.length, 10);
    assert.equal(data.access.remaining, 0);
  } finally { await first.client.close(); await first.server.close(); }
  const next = await connectedClient(user);
  try {
    for (const name of ["get_company", "fetch"]) {
      const blocked = await next.client.callTool({ name, arguments: { id: "co-011" } });
      assert.equal(blocked.isError, true);
      assert.match(JSON.stringify(blocked), /company_limit_reached/);
      assert.doesNotMatch(JSON.stringify(blocked), /CreditBridge/);
      const revisit = await next.client.callTool({ name, arguments: { id: "co-001" } });
      assert.notEqual(revisit.isError, true, JSON.stringify(revisit));
    }
    const search = await next.client.callTool({ name: "search", arguments: { query: "" } });
    const data = JSON.parse((search.content as Array<{ text: string }>)[0].text);
    assert.equal(data.results.length, 10);
  } finally { await next.client.close(); await next.server.close(); }
});
