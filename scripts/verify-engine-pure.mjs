#!/usr/bin/env node
/**
 * Second lock on CLAUDE.md golden rule 1, independent of ESLint.
 *
 * The boundaries rule catches an import statement. This catches the manifest:
 * packages/engine must declare no runtime dependencies of any kind, so that the
 * engine stays installable and runnable with nothing but a JavaScript runtime.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(root, "packages", "engine", "package.json");

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const forbidden = ["dependencies", "peerDependencies", "optionalDependencies"];
const violations = [];

for (const field of forbidden) {
  const entries = Object.keys(manifest[field] ?? {});
  if (entries.length > 0) {
    violations.push(`  ${field}: ${entries.join(", ")}`);
  }
}

if (violations.length > 0) {
  console.error(
    "packages/engine must have zero runtime dependencies (CLAUDE.md golden rule 1).",
  );
  console.error("Found:");
  console.error(violations.join("\n"));
  process.exit(1);
}

console.log("engine purity: no runtime dependencies declared.");
