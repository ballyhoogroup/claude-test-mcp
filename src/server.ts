import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SERVER_INSTRUCTIONS, SupportBridge } from "../supportbridge/sdk/index.mjs";
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
  support: ReturnType<typeof SupportBridge.install>;
}

export function createServer(): ServerInstallation {
  const businessInstructions =
    "Pitch-Fork provides company discovery and market intelligence from its company catalog.";
  const server = new McpServer(
    {
      name: "Pitch-Fork",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
      instructions: [businessInstructions, SERVER_INSTRUCTIONS].join(" "),
    },
  );

  const support = SupportBridge.install(server, {
    apiKey: process.env.SUPPORTBRIDGE_API_KEY,
    baseUrl: process.env.SUPPORTBRIDGE_URL,
    source: process.env.SUPPORTBRIDGE_SOURCE,
    privacy: { captureArguments: false },
  });

  const registerBusinessTool = (tool: {
    name: string;
    title: string;
    description: string;
    inputSchema: Record<string, z.ZodTypeAny>;
    handler: (args: any, extra: any) => any;
  }) => {
    const wrapped = support.wrapTool(tool);
    server.registerTool(
      wrapped.name,
      {
        title: wrapped.title,
        description: wrapped.description,
        inputSchema: wrapped.inputSchema,
      },
      wrapped.handler,
    );
  };

  // --- ChatGPT Connectors-compatible tools (search + fetch) ---
  // https://platform.openai.com/docs/mcp — connectors expect a `search` tool
  // that returns result ids, and a `fetch` tool that resolves an id to a
  // full document.
  registerBusinessTool({
      name: "search",
      title: "Search companies",
      description: "Search Demo Vendor companies by name, industry, or location.",
      inputSchema: {
        query: z.string().describe("Free-text search query, e.g. 'fintech' or 'Berlin'"),
      },
      handler: async ({ query }: { query: string }) => {
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
      },
    });

  registerBusinessTool({
      name: "fetch",
      title: "Fetch company record",
      description: "Fetch a Demo Vendor company record by ID.",
      inputSchema: {
        id: z.string().describe("Company id, e.g. 'co-001'"),
      },
      handler: async ({ id }: { id: string }) => {
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
      },
    });

  // --- General-purpose tools for Claude Desktop and other MCP clients ---
  registerBusinessTool({
      name: "list_companies",
      title: "List companies",
      description: "List Demo Vendor companies with optional industry, location, and valuation filters.",
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
      handler: async ({ industry, location, minValuationUsd, maxValuationUsd, limit }: {
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
      },
    });

  registerBusinessTool({
      name: "get_company",
      title: "Get company by id",
      description: "Get a Demo Vendor company record by ID.",
      inputSchema: {
        id: z.string(),
      },
      handler: async ({ id }: { id: string }) => {
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
      },
    });

  registerBusinessTool({
      name: "list_industries",
      title: "List industries",
      description: "List Demo Vendor industries and company counts.",
      inputSchema: {},
      handler: async () => {
      const counts = INDUSTRIES.map((industry) => ({
        industry,
        count: companies.filter((c) => c.industry === industry).length,
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(counts, null, 2) }],
      };
      },
    });

  return { server, support };
}
