import { PostHog } from "posthog-node";

// One client for the long-lived web process, shared by all stateless MCP instances.
export const posthogClient = process.env.POSTHOG_PROJECT_TOKEN
  ? new PostHog(process.env.POSTHOG_PROJECT_TOKEN, {
      host: process.env.POSTHOG_HOST || "https://us.i.posthog.com",
    })
  : undefined;

export async function shutdownAnalytics(): Promise<void> {
  await posthogClient?.shutdown();
}
