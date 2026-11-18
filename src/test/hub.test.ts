import assert from "node:assert/strict";
import test from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { SupportBridge, SERVER_INSTRUCTIONS } from "@getwithin/sdk";

async function connected(hubs: boolean) {
  const server = new McpServer({ name: "hub-contract", version: "1" }, { instructions: SERVER_INSTRUCTIONS });
  SupportBridge.install(server, { apiKey: "test-only-key", baseUrl: "https://hub.example.invalid", vendorName: "Pitch Fork", hubs });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const send = a.send.bind(a);
  a.send = (message, options) => send(message, { ...options, authInfo: { token: "test", clientId: "test", scopes: [], extra: { sub: "hub-test-customer" } } });
  const client = new Client({ name: "hub-contract-test", version: "1" });
  await Promise.all([server.connect(b), client.connect(a)]);
  return { client, server };
}

test("hubs is optional and preserves the existing four tool definitions", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => Response.json({});
  const off = await connected(false), on = await connected(true);
  try {
    const before = await off.client.listTools(), after = await on.client.listTools();
    assert.deepEqual(before.tools.map(t => t.name).sort(), ["confirm_assistance", "decline_assistance", "get_vendor_answer", "report_void"]);
    for (const tool of before.tools) assert.deepEqual(after.tools.find(t => t.name === tool.name), tool);
    assert.equal(after.tools.length, before.tools.length + 1);
    assert.equal((await off.client.listResources()).resources.some(r => r.uri === "ui://supportbridge/hub"), false);
    const hub = after.tools.find(t => t.name === "open_hub")!;
    assert.equal(hub.title, "Open hub");
    assert.equal((hub._meta as any).ui.resourceUri, "ui://supportbridge/hub");
    assert.equal(hub._meta?.["openai/outputTemplate"], "ui://supportbridge/hub");
    const page = await on.client.readResource({ uri: "ui://supportbridge/hub" });
    assert.equal(page.contents[0].mimeType, "text/html;profile=mcp-app");
    const html = String("text" in page.contents[0] ? page.contents[0].text : "");
    assert.match(html, /ui\/initialize/);
    assert.match(html, /ui\/notifications\/size-changed/);
    assert.match(html, /sendFollowUpMessage/);
    assert.match(html, /ui\/message/);
  } finally { await off.client.close(); await off.server.close(); await on.client.close(); await on.server.close(); globalThis.fetch = previous; }
});

test("hub returns real item text, private identity and matching UI metadata", async () => {
  const previous = globalThis.fetch;
  const calls: Array<{url: string; body: any}> = [];
  const payload = { status: "open", vendorName: "Pitch Fork", view: "suggestions", inbox: [{ title: "Real title", body: "Real body" }], suggestions: [{ title: "Workflow title", prompt: "Actual workflow prompt" }], messages: [{ text: "Actual message" }], usage: [{ tool: "search", count: 7 }] };
  globalThis.fetch = async (input, init) => { calls.push({url: String(input), body: init?.body ? JSON.parse(String(init.body)) : {}}); return Response.json(String(input).endsWith("/v1/hubs/open") ? payload : {}); };
  const {client, server} = await connected(true);
  try {
    const result = await client.callTool({ name: "open_hub", arguments: { view: "suggestions" } });
    const text = (result.content as any[]).filter(c => c.type === "text").map(c => c.text).join("\n");
    for (const value of ["Selected tab: suggestions", "Real title: Real body", "Workflow title: Actual workflow prompt", "Actual message", "search: 7"]) assert.ok(text.includes(value), value);
    assert.deepEqual(result.structuredContent, payload);
    assert.equal(result._meta?.["openai/outputTemplate"], "ui://supportbridge/hub");
    assert.equal((result._meta as any).ui.resourceUri, "ui://supportbridge/hub");
    const request = calls.find(c => c.url.endsWith("/v1/hubs/open"))!;
    assert.equal(request.body.customerUserId, "hub-test-customer");
    assert.equal(request.body.view, "suggestions");
  } finally { await client.close(); await server.close(); globalThis.fetch = previous; }
});

test("hub failure and decline statuses attach no page and never connect a representative", async () => {
  const previous = globalThis.fetch;
  let status = "off";
  const urls: string[] = [];
  globalThis.fetch = async input => { const url = String(input); urls.push(url); if (url.endsWith("/v1/install")) return Response.json({}); if (status === "unreachable") throw new Error("offline"); return Response.json({status}); };
  const {client, server} = await connected(true);
  try {
    for (const [next, text] of [["sign_in", "Sign in to open your hub."], ["off", "The hub is not turned on."], ["silenced", "Okay. The hub stays closed."], ["unreachable", "The hub could not be opened. Nothing was shared."]]) {
      status = next;
      const result = await client.callTool({name: "open_hub", arguments: {view: next === "silenced" ? "decline" : "inbox"}});
      assert.equal((result.content as any[])[0].text, text);
      assert.equal(result._meta, undefined);
      assert.equal((result.content as any[]).some(c => c.type === "resource"), false);
      if (next === "unreachable") assert.equal(result.isError, true);
    }
    assert.ok(urls.some(u => u.endsWith("/v1/hubs/decline")));
    assert.ok(urls.every(u => /\/v1\/(install|hubs\/(open|decline))$/.test(u)));
  } finally { await client.close(); await server.close(); globalThis.fetch = previous; }
});
