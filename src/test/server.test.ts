import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../server.js";

process.env.SUPPORTBRIDGE_API_KEY = "sb_test_demo_vendor";
process.env.SUPPORTBRIDGE_URL = "https://supportbridge-service.invalid";
globalThis.fetch = async () => Response.json({});

async function connectedClient(userId = `test-${crypto.randomUUID()}`) {
  const { server } = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const send = clientTransport.send.bind(clientTransport);
  clientTransport.send = (message, options) => send(message, { ...options, authInfo: { token: "test", clientId: "test", scopes: [], extra: { sub: userId } } });
  const client = new Client({ name: "pitch-fork-test", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

test("exposes the business tools and SDK-managed assistance tools", async () => {
  const { client, server } = await connectedClient();
  try {
    assert.match(client.getInstructions() ?? "", /Call get_vendor_answer for pricing/);
    assert.match(client.getInstructions() ?? "", /company discovery and market intelligence/);
    assert.doesNotMatch(client.getInstructions() ?? "", /ask_company|Company questions|Call offer_assistance when the user asks/i);
    const tools = await client.listTools();
    const expectedSupport = new Map([
      ["get_vendor_answer", "Vendor answer"],
      ["talk_to_vendor_agent", "Talk to the vendor assistant"],
      ["offer_assistance", "Pricing and commercial questions"],
      ["confirm_assistance", "Confirm assistance"],
      ["request_assistance", "Request assistance"],
      ["file_escalation", "File escalation"],
      ["decline_escalation", "Decline escalation"],
      ["decline_assistance", "Decline assistance"],
      ["support_get_messages", "Get assistance messages"],
      ["support_send_message", "Send assistance message"],
      ["support_end_session", "End assistance session"],
      ["support_get_offer", "Get assistance offer"],
    ]);
    assert.deepEqual(tools.tools.map(tool => tool.name).sort(),
      [...expectedSupport.keys(), "search", "fetch", "get_company", "list_companies", "list_industries"].sort());
    for (const [name, title] of expectedSupport) {
      assert.equal(tools.tools.find(tool => tool.name === name)?.title, title);
    }
    assert.equal(tools.tools.find(tool => tool.name === "offer_assistance")?._meta?.["openai/outputTemplate"], "ui://supportbridge/intent-offer");
    for (const name of ["search", "fetch", "get_company", "list_companies", "list_industries"]) {
      assert.equal(tools.tools.find(tool => tool.name === name)?._meta, undefined, name);
      assert.match(tools.tools.find(tool => tool.name === name)?.description ?? "", /Pitch Fork/);
    }
    assert.ok(tools.tools.every(tool => !tool.description?.startsWith("Deprecated")));
    assert.match(tools.tools.find(tool => tool.name === "get_vendor_answer")?.description ?? "", /Pitch Fork/);
    const resources = await client.listResources();
    assert.deepEqual(resources.resources.map(resource => resource.uri).sort(), ["ui://supportbridge/chat", "ui://supportbridge/intent-offer"]);
  } finally {
    await client.close();
    await server.close();
  }
});

test("pricing text in a business tool does not create or append an assistance offer", async () => {
  const requests: Array<{ url: string; authorization: string | null }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push({
      url,
      authorization: new Headers(init?.headers).get("authorization"),
    });
    return Response.json({});
  };

  const { client, server } = await connectedClient();
  try {
    const result = await client.callTool({
      name: "search",
      arguments: { query: "what is the pricing of the alpha connector" },
    });
    assert.equal(result.isError, undefined);
    assert.equal(result.structuredContent, undefined);
    assert.equal(result._meta, undefined);
    assert.doesNotMatch(JSON.stringify(result.content), /Optional live assistance|Show the assistance card/);
    assert.ok(!requests.some(({ url }) => url.endsWith("/v1/offers/intent")));
    assert.ok(requests.every(({ authorization }) => authorization === "Bearer sb_test_demo_vendor"));
  } finally {
    globalThis.fetch = async () => Response.json({});
    await client.close();
    await server.close();
  }
});

test("offer_assistance returns the assistance card", async () => {
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/v1/offers/intent")) {
      return Response.json({
        offer: {
          id: "offer-pricing-1",
          intent: "pricing",
          intentLabel: "Pricing",
          issueSummary: "Customer asked about pricing or plans.",
          representativeName: "Sarah",
          representativeRole: "account executive",
          vendorName: "Pitch Fork",
          expiresAt: "2026-09-28T21:00:00.000Z",
        },
      });
    }
    return Response.json({});
  };

  const { client, server } = await connectedClient();
  try {
    const result = await client.callTool({
      name: "offer_assistance",
      arguments: { intent: "pricing", issueSummary: "Customer asked about pricing." },
    });
    assert.equal(result.isError, undefined);
    assert.equal(result._meta?.["openai/outputTemplate"], "ui://supportbridge/intent-offer");
    assert.match(JSON.stringify(result.content), /Sarah can help with pricing now/);
  } finally {
    globalThis.fetch = async () => Response.json({});
    await client.close();
    await server.close();
  }
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
      assert.notEqual(revisit.isError, true);
    }
    const search = await next.client.callTool({ name: "search", arguments: { query: "" } });
    const data = JSON.parse((search.content as Array<{ text: string }>)[0].text);
    assert.equal(data.results.length, 10);
  } finally { await next.client.close(); await next.server.close(); }
});

test("vendor answers use the signed-in identity and answers endpoint without starting contact", async () => {
  const calls: Array<{ url: string; body: any }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : {} });
    return Response.json({ answer: { text: "Contact Pitch Fork for a tailored quote." } });
  };
  const { client, server } = await connectedClient("answer-test-user");
  try {
    const result = await client.callTool({ name: "get_vendor_answer", arguments: { topic: "pricing", question: "What plans are available?" } });
    assert.notEqual(result.isError, true);
    assert.match(JSON.stringify(result.content), /tailored quote/);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.endsWith("/v1/answers"));
    assert.equal(calls[0].body.customerUserId, "answer-test-user");
    assert.equal(calls[0].body.topic, "pricing");
  } finally {
    globalThis.fetch = async () => Response.json({});
    await client.close(); await server.close();
  }
});
