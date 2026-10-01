/**
 * Minimal Node resolve hook so `scripts/verify-*.mjs` can import application modules directly.
 *
 * Node strips TypeScript types on its own, but it cannot resolve this project's `@/…` alias and
 * needs explicit extensions on relative imports. This maps both, which lets a verification script
 * exercise the REAL implementation instead of a mirrored copy that silently drifts.
 *
 * Usage: node --import ./scripts/lib/ts-alias-loader.mjs scripts/verify-…mjs
 */

import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import path from 'node:path';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function withExtension(base) {
  if (path.extname(base)) return base;
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (existsSync(candidate)) return candidate;
  }
  return base;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const target = withExtension(path.join(projectRoot, 'src', specifier.slice(2)));
    return nextResolve(pathToFileURL(target).href, context);
  }
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    const parentPath = context.parentURL ? path.dirname(fileURLToPath(context.parentURL)) : projectRoot;
    const resolved = withExtension(path.resolve(parentPath, specifier));
    if (existsSync(resolved)) return nextResolve(pathToFileURL(resolved).href, context);
  }
  return nextResolve(specifier, context);
}
