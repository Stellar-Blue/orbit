/**
 * Verification — the Microsoft sign-in redirect must follow the origin in use.
 *
 * The bug: the callback was built from `NEXT_PUBLIC_APP_URL`, which points at production. The OAuth
 * state cookie is written on the origin sign-in STARTED from, so anyone on localhost was sent back
 * to the deployed app, which had no state cookie for them — every attempt ended in
 * "Microsoft sign-in failed or was interrupted".
 *
 * Run: node --import ./scripts/lib/ts-alias-loader.mjs scripts/verify-msal-redirect.mjs
 *      (or: npm run test:msal)
 */

import { msalRedirectUri, msalAuthorizeUrl, hasMsalCredentials } from '../src/lib/integrations/msal.ts';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

let passed = 0;
let failed = 0;

function check(condition, testName, details = '') {
  if (condition) {
    console.log(`✅ [PASS] ${testName}`);
    passed++;
  } else {
    console.error(`❌ [FAIL] ${testName}`);
    if (details) console.error(`          └─ ${details}`);
    failed++;
  }
}

// The module reads process.env per call, so dummy credentials are enough to exercise the builder.
process.env.GRAPH_CLIENT_ID = 'test-client-id';
process.env.GRAPH_TENANT_ID = 'test-tenant-id';
process.env.GRAPH_CLIENT_SECRET = 'test-secret';

check(hasMsalCredentials(), 'credentials are recognised when all three variables are set');
check(
  msalRedirectUri('http://localhost:3000') === 'http://localhost:3000/api/msal/callback',
  'the callback follows a localhost origin'
);
check(
  msalRedirectUri('https://app.orbit.stellarblue.eu') === 'https://app.orbit.stellarblue.eu/api/msal/callback',
  'the callback follows the deployed origin'
);
check(
  msalRedirectUri('https://preview-abc.vercel.app/') === 'https://preview-abc.vercel.app/api/msal/callback',
  'a trailing slash does not double up'
);

const localUrl = msalAuthorizeUrl('STATE-123', 'http://localhost:3000');
const params = new URL(localUrl).searchParams;
check(new URL(localUrl).origin === 'https://login.microsoftonline.com', 'authorize URL points at Microsoft');
check(params.get('client_id') === 'test-client-id', 'authorize URL carries the client id');
check(params.get('state') === 'STATE-123', 'authorize URL carries the state back');
check(
  params.get('redirect_uri') === 'http://localhost:3000/api/msal/callback',
  'authorize URL asks Microsoft to return to the origin in use, not production'
);
check(
  (params.get('scope') || '').includes('Calendars.ReadWrite') && (params.get('scope') || '').includes('offline_access'),
  'authorize URL requests calendar write plus offline_access (needed for the refresh token)'
);

// ---------------------------------------------------------------------------
// Contract: the origin cannot drift back to an env variable
// ---------------------------------------------------------------------------
const msal = readFileSync(path.join(here, '../src/lib/integrations/msal.ts'), 'utf8');
check(
  !msal.includes('process.env.NEXT_PUBLIC_APP_URL'),
  'msal.ts never derives the redirect from NEXT_PUBLIC_APP_URL (that is what sent localhost to production)'
);

const connect = readFileSync(path.join(here, '../src/app/api/msal/connect/route.ts'), 'utf8');
check(
  /msalAuthorizeUrl\(stateB64, request\.nextUrl\.origin\)/.test(connect),
  'the connect route passes the request origin'
);

const callback = readFileSync(path.join(here, '../src/app/api/msal/callback/route.ts'), 'utf8');
check(
  /exchangeMsalCode\(code, request\.nextUrl\.origin\)/.test(callback),
  'the callback exchanges the code against the same origin'
);
check(
  /msal=state/.test(callback),
  'a state mismatch is reported as its own reason (it is the origin-mismatch symptom)'
);
check(
  /msal=exchange_failed\$\{errorCode/.test(callback),
  "Microsoft's error code reaches the UI instead of being swallowed"
);

console.log(`\n${failed === 0 ? '🎉' : '⚠️'} ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
