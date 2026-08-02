import { NextResponse } from 'next/server';

/**
 * OpenID Connect Discovery Metadata Endpoint
 * Alias for OAuth discovery to ensure full compatibility with Claude Custom Connectors automated OAuth probing.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;

  return NextResponse.json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/oauth/mcp/authorize`,
    token_endpoint: `${baseUrl}/api/v1/mcp/oauth/token`,
    userinfo_endpoint: `${baseUrl}/api/v1/mcp/oauth/userinfo`,
    scopes_supported: [
      "invoices.admin",
      "openid",
      "profile",
      "email"
    ],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256", "HS256"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic", "none"],
    code_challenge_methods_supported: ["S256", "plain"]
  }, {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=3600"
    }
  });
}
