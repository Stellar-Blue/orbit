import { NextResponse } from 'next/server';

/**
 * RFC 8414 / MCP OAuth 2.0 Authorization Server Metadata Discovery
 * Allows Claude (Anthropic Custom Connectors) to automatically discover Orbit's OAuth authorization and token exchange endpoints.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;

  return NextResponse.json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/oauth/mcp/authorize`,
    token_endpoint: `${baseUrl}/api/v1/mcp/oauth/token`,
    scopes_supported: [
      "invoices.admin",
      "openid",
      "profile",
      "email"
    ],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic", "none"],
    code_challenge_methods_supported: ["S256", "plain"],
    service_documentation: `${baseUrl}/invoices`,
    ui_locales_supported: ["en", "el"]
  }, {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=3600"
    }
  });
}
