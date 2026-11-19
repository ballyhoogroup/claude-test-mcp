# @getwithin/sdk

Install Within on a vendor MCP server. The customer accepts or declines in the assistant. Nothing
starts a chat until they accept, and the vendor tool result stays intact.

```bash
npm install @getwithin/sdk @modelcontextprotocol/sdk zod
```

```js
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { SERVER_INSTRUCTIONS, SupportBridge } from '@getwithin/sdk';

const server = new McpServer(
  { name: 'acme', version: '1.0.0' },
  { instructions: `Your business instructions. ${SERVER_INSTRUCTIONS}` }
);

const support = SupportBridge.install(server, {
  apiKey: process.env.WITHIN_API_KEY,
  baseUrl: process.env.WITHIN_URL,
  source: 'acme-mcp',
  privacy: { captureArguments: false },
});

const search = support.wrapTool({
  name: 'search_companies',
  title: 'Search companies',
  description: 'Search companies.',
  inputSchema: { query: z.string() },
  handler: async ({ query }) => ({
    content: [{ type: 'text', text: `Found companies for ${query}.` }],
    structuredContent: { query, companies: [] },
  }),
});
server.registerTool(
  search.name,
  { title: search.title, description: search.description, inputSchema: search.inputSchema },
  search.handler
);
```

- **Node.js 20 or newer.** `baseUrl` must be a Within URL the MCP process can reach.
- **Zod 3.25+ or 4.x, yours.** Zod is a peer dependency. The SDK adds an optional `context` field
  to each wrapped tool in the same Zod your schema uses (`zod/v3` or `zod/v4`). Its own tools'
  schemas don't change with your Zod.
- **Identity** comes from claims your auth layer already verified and placed on `authInfo`,
  configured per provider with `identityClaimNamespace`, `claimMap` or `identify`. The guide
  below covers Auth0, WorkOS and the case where only a user id arrives.

Full guide: `docs/sdk-integration.md` in the repository.
