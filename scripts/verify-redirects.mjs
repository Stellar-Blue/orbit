/**
 * Verification — redirect targets that come from the URL must stay on Orbit, and the MCP OAuth
 * code may only go to Claude's callbacks or a loopback client.
 *
 * Run: node --import ./scripts/lib/ts-alias-loader.mjs scripts/verify-redirects.mjs
 *      (or: npm run test:redirects)
 */

import assert from 'node:assert/strict';
import { safeNextPath, isAllowedMcpRedirectUri } from '../src/lib/redirects.ts';

for (const ok of ['/', '/people', '/invoices?tab=open#x', '/a/b/c']) {
  assert.equal(safeNextPath(ok), ok, `should keep ${ok}`);
}
for (const bad of [null, '', 'https://evil.tld', '//evil.tld', '/\\evil.tld', '/\t/evil.tld', '/\n/evil.tld', 'javascript:alert(1)', '@evil.tld/x', 'evil']) {
  assert.equal(safeNextPath(bad), '/', `should reject ${JSON.stringify(bad)}`);
}

for (const ok of ['https://claude.ai/api/mcp/auth_callback', 'https://claude.com/api/mcp/auth_callback', 'http://localhost:33418/callback', 'http://127.0.0.1:8080/cb']) {
  assert.ok(isAllowedMcpRedirectUri(ok), `should allow ${ok}`);
}
for (const bad of [null, '', 'https://evil.tld/cb', 'javascript:alert(document.cookie)//', 'https://claude.ai.evil.tld/api/mcp/auth_callback', 'https://claude.ai/api/mcp/auth_callback/../x', 'http://localhost.evil.tld/cb', 'http://user:pw@localhost/cb', 'https://localhost/cb', '/relative']) {
  assert.ok(!isAllowedMcpRedirectUri(bad), `should reject ${JSON.stringify(bad)}`);
}

console.log('redirect checks passed');
