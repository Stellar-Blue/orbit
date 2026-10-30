// Redirect-target validation shared by server routes and client pages (no server-only imports).

// A same-origin path for `?next=` style params. Rejects `//host`, `/\host` and anything with
// whitespace or control characters, which browsers strip or reinterpret into a protocol-relative URL.
export function safeNextPath(next: string | null | undefined): string {
  return next && /^\/(?![/\\])[^\\\s\x00-\x1f]*$/.test(next) ? next : '/';
}

// Where the MCP OAuth flow may send an authorization code: Claude's connector callbacks, or a
// loopback address (RFC 8252) for local clients such as Claude Code / Desktop.
const MCP_REDIRECT_URIS = new Set([
  'https://claude.ai/api/mcp/auth_callback',
  'https://claude.com/api/mcp/auth_callback',
  'https://claude.ai/api/mcp/callback',
]);

export function isAllowedMcpRedirectUri(uri: string | null | undefined): boolean {
  if (!uri) return false;
  if (MCP_REDIRECT_URIS.has(uri)) return true;
  try {
    const u = new URL(uri);
    return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1') && !u.username && !u.password;
  } catch {
    return false;
  }
}
