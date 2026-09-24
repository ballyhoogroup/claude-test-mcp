import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

interface SupportIdentity {
  userId?: string;
  sessionId?: string;
  displayName?: string;
}

interface SupportBridgeInstallation {
  instructions: string;
  instrumentTool<TArguments, TResult>(
    toolName: string,
    handler: (args: TArguments, extra: unknown) => TResult | Promise<TResult>,
  ): (args: TArguments, extra: unknown) => Promise<TResult>;
}

export const SupportBridge: {
  install(
    server: McpServer,
    options: {
      apiKey: string | undefined;
      baseUrl?: string;
      source: string;
      identify: (context: unknown) => SupportIdentity;
    },
  ): SupportBridgeInstallation;
};
