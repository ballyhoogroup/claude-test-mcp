import { createRemoteJWKSet, jwtVerify } from "jose";

/**
 * OAuth 2.1 resource-server support for this MCP server, using WorkOS AuthKit
 * as the authorization server. See https://workos.com/docs/authkit/mcp
 *
 * Auth is opt-in: it only activates once both AUTHKIT_DOMAIN and
 * MCP_RESOURCE_URL are set (e.g. as Render env vars). With neither set, the
 * server behaves exactly as before (fully open) so existing deployments and
 * local dev aren't broken by this change.
 */

function normalizeIssuer(domain: string): string {
  const withScheme = domain.startsWith("http") ? domain : `https://${domain}`;
  return withScheme.replace(/\/$/, "");
}

const rawAuthkitDomain = process.env.AUTHKIT_DOMAIN;
const resourceUrl = process.env.MCP_RESOURCE_URL?.replace(/\/$/, "");
const issuer = rawAuthkitDomain ? normalizeIssuer(rawAuthkitDomain) : undefined;

export const authEnabled = Boolean(issuer && resourceUrl);

const jwks = issuer ? createRemoteJWKSet(new URL(`${issuer}/oauth2/jwks`)) : undefined;

if (process.env.AUTHKIT_DOMAIN && !process.env.MCP_RESOURCE_URL) {
  console.warn(
    "AUTHKIT_DOMAIN is set but MCP_RESOURCE_URL is not — OAuth stays disabled until both are set.",
  );
}

export function protectedResourceMetadataUrl(): string {
  return `${resourceUrl}/.well-known/oauth-protected-resource`;
}

export function protectedResourceMetadata() {
  return {
    resource: resourceUrl,
    authorization_servers: [issuer],
  };
}

export type TokenCheck = { ok: true } | { ok: false; reason: string };

export async function verifyBearerToken(authorizationHeader: string | undefined): Promise<TokenCheck> {
  if (!authEnabled) {
    return { ok: true };
  }
  if (!authorizationHeader?.startsWith("Bearer ")) {
    return { ok: false, reason: "missing_bearer_token" };
  }

  const token = authorizationHeader.slice("Bearer ".length).trim();
  try {
    await jwtVerify(token, jwks!, { issuer });
    return { ok: true };
  } catch {
    return { ok: false, reason: "invalid_token" };
  }
}
