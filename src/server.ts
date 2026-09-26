import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SupportBridge } from "../supportbridge/sdk/index.mjs";
import { companies, type Company, type Industry } from "./data.js";

const INDUSTRIES: Industry[] = ["fintech", "agtech", "martech", "femtech"];
const companiesById = new Map(companies.map((c) => [c.id, c]));

function formatValuation(valuationUsd: number): string {
  if (valuationUsd >= 1_000_000_000) {
    return `$${(valuationUsd / 1_000_000_000).toFixed(1)}B`;
  }
  return `$${(valuationUsd / 1_000_000).toFixed(0)}M`;
}

function toRecordText(c: Company): string {
  return [
    `${c.name} (${c.id})`,
    `Industry: ${c.industry}`,
    `Valuation: ${formatValuation(c.valuationUsd)} (${c.valuationUsd.toLocaleString("en-US")} USD)`,
    `Location: ${c.location}`,
  ].join("\n");
}

function matchesQuery(c: Company, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    c.name.toLowerCase().includes(q) ||
    c.industry.toLowerCase().includes(q) ||
    c.location.toLowerCase().includes(q) ||
    c.id.toLowerCase() === q
  );
}

/**
 * Builds a fresh McpServer instance with every tool registered.
 * A new instance is created per request in stateless HTTP mode (see index.ts).
 */
export interface ServerInstallation {
  server: McpServer;
}

function identifyWorkOSUser(context: unknown) {
  const authInfo = (context as {
    authInfo?: { extra?: Record<string, unknown> };
  })?.authInfo;
  const claims = authInfo?.extra;
  return {
    userId: typeof claims?.subject === "string" ? claims.subject : undefined,
    sessionId: typeof claims?.sessionId === "string" ? claims.sessionId : undefined,
    displayName: typeof claims?.name === "string" ? claims.name : undefined,
  };
}

export function createServer(): ServerInstallation {
  const server = new McpServer(
    {
      name: "Pitch-Fork",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
      instructions:
        "Pitch-Fork provides read-only access to company information and market intelligence " +
        "(name, industry, valuation, location) across fintech, agtech, martech, " +
        "and femtech. Use `search` to find companies by keyword, then `fetch` to " +
        "get the full record for a result id. Use `list_companies` for structured " +
        "filtering and `get_company` to look up a company by its id directly.",
    },
  );

  const support = SupportBridge.install(server, {
    apiKey: process.env.SUPPORTBRIDGE_API_KEY,
    baseUrl: process.env.SUPPORTBRIDGE_URL,
    source: "this-mcp",
    identify: identifyWorkOSUser,
  });

  // --- ChatGPT Connectors-compatible tools (search + fetch) ---
  // https://platform.openai.com/docs/mcp — connectors expect a `search` tool
  // that returns result ids, and a `fetch` tool that resolves an id to a
  // full document.
  server.registerTool(
    "search",
    {
      title: "Search companies",
      description: "Search Demo Vendor companies by name, industry, or location.",
      inputSchema: {
        query: z.string().describe("Free-text search query, e.g. 'fintech' or 'Berlin'"),
      },
    },
    support.instrumentTool("search", async ({ query }) => {
      const results = companies
        .filter((c) => matchesQuery(c, query))
        .map((c) => ({
          id: c.id,
          title: `${c.name} — ${c.industry}, ${c.location}`,
          url: `urn:pitch-fork:company:${c.id}`,
        }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ results }),
          },
        ],
      };
    }),
  );

  server.registerTool(
    "fetch",
    {
      title: "Fetch company record",
      description: "Fetch a Demo Vendor company record by ID.",
      inputSchema: {
        id: z.string().describe("Company id, e.g. 'co-001'"),
      },
    },
    support.instrumentTool("fetch", async ({ id }) => {
      const company = companiesById.get(id);
      if (!company) {
        throw new Error(`No company found with id "${id}"`);
      }

      const document = {
        id: company.id,
        title: company.name,
        text: toRecordText(company),
        url: `urn:pitch-fork:company:${company.id}`,
        metadata: {
          name: company.name,
          industry: company.industry,
          valuationUsd: company.valuationUsd,
          location: company.location,
        },
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(document),
          },
        ],
      };
    }),
  );

  // --- General-purpose tools for Claude Desktop and other MCP clients ---
  server.registerTool(
    "list_companies",
    {
      title: "List companies",
      description:
        "List Demo Vendor companies with optional industry, location, and valuation filters.",
      inputSchema: {
        industry: z
          .enum(["fintech", "agtech", "martech", "femtech"])
          .optional()
          .describe("Restrict results to a single industry"),
        location: z
          .string()
          .optional()
          .describe("Case-insensitive substring match against the location field"),
        minValuationUsd: z.number().nonnegative().optional(),
        maxValuationUsd: z.number().nonnegative().optional(),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(25)
          .describe("Maximum number of companies to return (default 25, max 100)"),
      },
    },
    support.instrumentTool("list_companies", async ({ industry, location, minValuationUsd, maxValuationUsd, limit }: {
      industry?: Industry;
      location?: string;
      minValuationUsd?: number;
      maxValuationUsd?: number;
      limit: number;
    }) => {
      let results = companies;

      if (industry) {
        results = results.filter((c) => c.industry === industry);
      }
      if (location) {
        const loc = location.toLowerCase();
        results = results.filter((c) => c.location.toLowerCase().includes(loc));
      }
      if (minValuationUsd !== undefined) {
        results = results.filter((c) => c.valuationUsd >= minValuationUsd);
      }
      if (maxValuationUsd !== undefined) {
        results = results.filter((c) => c.valuationUsd <= maxValuationUsd);
      }

      const truncated = results.slice(0, limit);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                count: truncated.length,
                totalMatches: results.length,
                companies: truncated,
              },
              null,
              2,
            ),
          },
        ],
      };
    }),
  );

  server.registerTool(
    "get_company",
    {
      title: "Get company by id",
      description: "Get a Demo Vendor company record by ID.",
      inputSchema: {
        id: z.string(),
      },
    },
    support.instrumentTool("get_company", async ({ id }) => {
      const company = companiesById.get(id);
      if (!company) {
        return {
          isError: true,
          content: [{ type: "text", text: `No company found with id "${id}"` }],
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(company, null, 2) }],
      };
    }),
  );

  server.registerTool(
    "list_industries",
    {
      title: "List industries",
      description: "List Demo Vendor industries and company counts.",
      inputSchema: {},
    },
    support.instrumentTool("list_industries", async () => {
      const counts = INDUSTRIES.map((industry) => ({
        industry,
        count: companies.filter((c) => c.industry === industry).length,
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(counts, null, 2) }],
      };
    }),
  );

  return { server };
}
