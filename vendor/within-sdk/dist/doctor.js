import { randomBytes } from 'crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { BlockList } from 'net';
import 'dns/promises';
import 'https';

// src/doctor.ts

// ../core/src/intents.ts
var STANDARD_ASSISTANCE_INTENTS = [
  {
    id: "pricing",
    label: "Pricing",
    description: "Prices, plans, discounts, promotions, volume or usage pricing, and multi-year commitments",
    words: [
      "price",
      "prices",
      "pricing",
      "cost",
      "costs",
      "rate",
      "rates",
      "plan",
      "plans",
      "discount",
      "discounts",
      "promotion",
      "promotions",
      "comparison",
      "volume",
      "commitment",
      "multi-year",
      "usage pricing"
    ]
  },
  {
    id: "upgrade",
    label: "Upgrade",
    description: "Upgrades, limits, overages, feature gates, seats, and add-ons",
    words: [
      "upgrade",
      "upgrades",
      "purchase",
      "purchasing",
      "buy",
      "buying",
      "limit",
      "limits",
      "overage",
      "overages",
      "seat",
      "seats",
      "add-on",
      "add-ons",
      "module",
      "modules",
      "feature gate",
      "feature gating"
    ]
  },
  {
    id: "demo",
    label: "Demo",
    description: "A request for a demo or to talk with a person",
    words: ["demo", "demos", "walkthrough", "walkthroughs"]
  },
  {
    id: "trial",
    label: "Trial",
    description: "Trials, pilots, and sandboxes",
    words: [
      "trial",
      "trials",
      "pilot",
      "pilots",
      "sandbox",
      "sandboxes",
      "evaluation",
      "evaluations"
    ]
  },
  {
    id: "enterprise",
    label: "Enterprise",
    description: "Enterprise terms, quotes, contracts, procurement, and invoicing",
    words: [
      "enterprise",
      "quote",
      "quotes",
      "proposal",
      "proposals",
      "contract",
      "contracts",
      "procurement",
      "invoicing",
      "legal",
      "SLA",
      "SLAs",
      "payment terms",
      "vendor onboarding",
      "custom terms"
    ]
  },
  {
    id: "security",
    label: "Security",
    description: "Security, compliance, SSO, SCIM, and data residency",
    words: [
      "security",
      "compliance",
      "SOC 2",
      "ISO 27001",
      "HIPAA",
      "GDPR",
      "SSO",
      "SCIM",
      "DPA",
      "DPAs",
      "residency",
      "retention",
      "deletion"
    ]
  },
  {
    id: "implementation",
    label: "Implementation",
    description: "Implementation, onboarding, integrations, and migration",
    words: [
      "implementation",
      "setup",
      "onboarding",
      "migration",
      "training",
      "integration",
      "switching"
    ]
  },
  {
    id: "billing",
    label: "Billing",
    description: "Billing disputes, refunds, and invoice questions",
    words: [
      "billing",
      "bill",
      "bills",
      "invoice",
      "invoices",
      "refund",
      "refunds",
      "tax",
      "taxes",
      "payment",
      "payments",
      "dispute",
      "disputes"
    ]
  },
  {
    id: "cancellation",
    label: "Cancellation",
    description: "Cancellation, downgrades, pauses, and consolidation",
    words: [
      "cancellation",
      "cancel",
      "downgrade",
      "downgrades",
      "pause",
      "freeze",
      "consolidation",
      "close account"
    ]
  },
  {
    id: "renewal",
    label: "Renewal",
    description: "Renewal terms, usage concerns, and admin changes",
    words: ["renewal", "renewals", "renew", "admin change", "ownership change"]
  },
  {
    id: "competitive",
    label: "Competitive",
    description: "Competitive comparisons, business case, and references",
    words: [
      "competitive",
      "competitor",
      "competitors",
      "ROI",
      "business case",
      "reference",
      "proof"
    ]
  },
  {
    id: "buying_process",
    label: "Buying process",
    description: "Who else is involved, budget, and timing",
    words: [
      "budget",
      "timing",
      "timeline",
      "stakeholder",
      "stakeholders",
      "champion",
      "decision maker",
      "who else"
    ]
  }
];
var ASSISTANCE_INTENT_IDS = STANDARD_ASSISTANCE_INTENTS.map((intent) => intent.id);
var INTENT_ALIASES = {
  purchase: "upgrade",
  security_compliance: "security",
  billing_payment: "billing",
  cancellation_downgrade: "cancellation"
};
function intentById(id) {
  const normalized = String(id).trim().toLowerCase().replace(/[\s-]+/g, "_");
  const canonical = INTENT_ALIASES[normalized] || (normalized === "demo_or_pilot" ? "demo" : normalized);
  return STANDARD_ASSISTANCE_INTENTS.find((intent) => intent.id === canonical);
}

// ../core/src/custom-rules.ts
/* @__PURE__ */ new Set([
  ...ASSISTANCE_INTENT_IDS,
  ...Object.keys(INTENT_ALIASES),
  "demo_or_pilot"
]);
var blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4]
])
  blocked.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20]
])
  blocked.addSubnet(address, prefix, "ipv6");
var globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");

// src/constants.ts
var CHAT_RESOURCE = "ui://supportbridge/chat";
var INTENT_OFFER_RESOURCE = "ui://supportbridge/intent-offer";
(intentById("security")?.words ?? []).join(", ");
var WITHIN_TOOL_NAMES = [
  "get_vendor_answer",
  "confirm_assistance",
  "decline_assistance",
  "report_void",
  "request_exception"
];
var HUB_TOOL_NAME = "open_hub";
var HUB_CARD_TOOL_NAME = "hub_card";
function isWithinTool(name) {
  return WITHIN_TOOL_NAMES.includes(name) || name === HUB_TOOL_NAME || name === HUB_CARD_TOOL_NAME;
}
var CHECK_META = "within/check";

// src/doctor.ts
var CHECK_ID = /^chk_[0-9a-f]{16,32}$/;
var KINDS = {
  named: "their name and email",
  emailOnly: "their email only",
  nameOnly: "their name only",
  idOnly: "only a login ID",
  anonymous: "no login"
};
var message = (cause) => cause instanceof Error ? cause.message : String(cause);
async function runDoctor(options) {
  const steps = [];
  const done = () => ({
    ok: !steps.some((step) => step.status === "fail"),
    steps
  });
  const client = new Client({ name: "within-doctor", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(options.url), {
    requestInit: options.token ? { headers: { authorization: `Bearer ${options.token}` } } : {}
  });
  try {
    await client.connect(transport);
    steps.push({ name: "connect", status: "pass", detail: `Connected to ${options.url}.` });
  } catch (cause) {
    const text = message(cause);
    const login = /401|unauthori[sz]ed|invalid_token/i.test(text);
    steps.push({
      name: "connect",
      status: "fail",
      detail: login ? "The server asked for a login. Pass --token with a signed-in customer\u2019s access token." : `Could not connect: ${text}`
    });
    for (const name of ["tools", "card", "round trip"])
      steps.push({ name, status: "skip", detail: "Needs a connection." });
    return done();
  }
  try {
    const tools = [];
    let cursor;
    do {
      const page = await client.listTools(cursor ? { cursor } : {});
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor);
    const names = new Set(tools.map((tool) => tool.name));
    const missing = WITHIN_TOOL_NAMES.filter((name) => !names.has(name));
    const vendorTools = tools.filter((tool) => !isWithinTool(tool.name));
    const bare = vendorTools.filter((tool) => !(tool.inputSchema?.properties ?? {})["context"]).map((tool) => tool.name);
    const problems = [
      missing.length ? `Within's tools are missing: ${missing.join(", ")}. Is SupportBridge.install() called on this server?` : "",
      bare.length ? `These tools have no context field, so Within can't see what the customer wants: ${bare.join(", ")}. Register them after install(), or wrap them.` : ""
    ].filter(Boolean);
    steps.push(
      problems.length ? { name: "tools", status: "fail", detail: problems.join(" ") } : {
        name: "tools",
        status: "pass",
        detail: `Within's tools are there, and ${vendorTools.length} of your tools carry the context field.`
      }
    );
    const unreadable = [];
    for (const uri of [CHAT_RESOURCE, INTENT_OFFER_RESOURCE]) {
      try {
        const read = await client.readResource({ uri });
        const first = read.contents[0];
        const html = typeof first?.text === "string" && /<html|<!doctype/i.test(first.text);
        if (!html) unreadable.push(uri);
      } catch {
        unreadable.push(uri);
      }
    }
    steps.push(
      unreadable.length ? {
        name: "card",
        status: "fail",
        detail: `These cards don't read back as HTML: ${unreadable.join(", ")}.`
      } : { name: "card", status: "pass", detail: "The chat and offer cards read back as HTML." }
    );
    steps.push(await roundTrip(client, options));
  } catch (cause) {
    steps.push({
      name: "tools",
      status: "fail",
      detail: `The server stopped answering: ${message(cause)}`
    });
  } finally {
    await client.close().catch(() => {
    });
  }
  return done();
}
async function roundTrip(client, options) {
  const name = "round trip";
  if (!options.tool)
    return {
      name,
      status: "skip",
      detail: "Pass --tool with a tool that is safe to call once, and --api-key, to see who reaches Within."
    };
  if (options.check !== void 0 && !CHECK_ID.test(options.check))
    return {
      name,
      status: "fail",
      detail: "--check is not a check id. Copy the command from Check installation again."
    };
  if (!options.apiKey && !options.check)
    return {
      name,
      status: "skip",
      detail: "Pass --api-key (or SUPPORTBRIDGE_API_KEY) to ask Within what arrived."
    };
  const check = options.check ?? `chk_${randomBytes(12).toString("hex")}`;
  try {
    await client.callTool({
      name: options.tool,
      arguments: options.args ?? {},
      _meta: { [CHECK_META]: check }
    });
  } catch (cause) {
    return { name, status: "fail", detail: `Calling ${options.tool} failed: ${message(cause)}` };
  }
  if (!options.apiKey)
    return {
      name,
      status: "pass",
      detail: `Called ${options.tool}. The console shows what reached Within.`
    };
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const base = (options.withinUrl ?? "https://app.getwith.in").replace(/\/$/, "");
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetchImpl(`${base}/v1/checks/${check}`, {
      headers: { authorization: `Bearer ${options.apiKey}` }
    }).catch(() => null);
    if (response?.ok) {
      const found = await response.json();
      const who = KINDS[found.identity.kind] ?? found.identity.kind;
      const from = found.identity.issuer ? ` from ${found.identity.issuer}` : "";
      const verified = found.identity.loginVerified ? "verified by Within" : "not verified by Within";
      const weak = found.identity.kind === "idOnly" || found.identity.kind === "anonymous";
      return {
        name,
        status: weak ? "warn" : "pass",
        detail: `The call reached Within with ${who}${from}, ${verified}.${weak ? " Name your login provider in the SDK (docs/identity)." : ""}`
      };
    }
    if (response && response.status === 401)
      return { name, status: "fail", detail: "Within refused the API key. Check --api-key." };
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return {
    name,
    status: "fail",
    detail: `${options.tool} ran, but nothing reached Within at ${base}. Check the server's SUPPORTBRIDGE_URL and API key, and that ${options.tool} is registered after install().`
  };
}

export { runDoctor };
