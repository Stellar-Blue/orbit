/**
 * Registers the TypeScript/alias resolve hooks. Pass this to `--import`:
 *
 *   node --import ./scripts/lib/ts-alias-loader.mjs scripts/verify-…mjs
 *
 * Node strips TypeScript types on its own, but it cannot resolve this project's `@/…` alias and
 * needs explicit extensions on relative imports. `ts-alias-hooks.mjs` maps both, which lets a
 * verification script exercise the REAL implementation instead of a mirrored copy that drifts.
 */

import { register } from 'node:module';

register('./ts-alias-hooks.mjs', import.meta.url);
