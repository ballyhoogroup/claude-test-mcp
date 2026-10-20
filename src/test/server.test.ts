import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.COMPANY_ACCESS_STORE_PATH = join(mkdtempSync(join(tmpdir(), "pitch-mcp-test-")), "access.json");
process.env.SUPPORTBRIDGE_API_KEY = "test-only-key";
process.env.SUPPORTBRIDGE_URL = "https://supportbridge.example.invalid";
process.env.SUPPORTBRIDGE_SOURCE = "pitch-fork-mcp";
globalThis.fetch = async () => Response.json({});
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



test("installs only the npm SDK tools beside the five business tools", async () => {
  const { client, server } = await connectedClient();
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(tool => tool.name).sort(), [
      "confirm_assistance", "decline_assistance", "decline_escalation", "fetch", "file_escalation", "get_company", "get_vendor_answer",
      "list_companies", "list_industries", "search", "support_end_session", "support_get_messages", "support_get_offer", "support_send_message", "talk_to_vendor_agent",
    ]);
    assert.equal(new Set(tools.map(tool => tool.name)).size, tools.length);
    assert.match(client.getInstructions() ?? "", /company discovery and market intelligence/);
    assert.match(client.getInstructions() ?? "", /Call get_vendor_answer/);
    const { resources } = await client.listResources();
    assert.deepEqual(resources.map(resource => resource.uri).sort(), ["ui://supportbridge/chat", "ui://supportbridge/intent-offer"]);
    for (const name of ["search", "fetch", "list_companies", "get_company", "list_industries"]) {
      assert.equal(tools.find(tool => tool.name === name)?._meta, undefined);
    }
  } finally { await client.close(); await server.close(); }
});

test("company results survive a SupportBridge outage and use the configured source", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: any }> = [];
  globalThis.fetch = async (input, init) => { calls.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : {} }); throw new Error("Service unavailable"); };
  const { client, server } = await connectedClient("real-test-subject");
  try {
    const result = await client.callTool({ name: "search", arguments: { query: "CashGrid" } });
    assert.notEqual(result.isError, true);
    assert.match(JSON.stringify(result.content), /CashGrid/);
    assert.equal(result._meta, undefined);
    assert.ok(calls.every(call => call.url.startsWith("https://supportbridge.example.invalid/")));
    const activity = calls.find(call => call.url.endsWith("/v1/activity"));
    assert.equal(activity?.body.source, "pitch-fork-mcp");
    assert.equal(activity?.body.customerUserId, "real-test-subject");
    assert.doesNotMatch(JSON.stringify(result.content), /offer.*(?:failed|inactive)/i);
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
