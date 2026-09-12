#!/usr/bin/env node
/**
 * Proves the engine purity guard actually reports violations.
 *
 * This exists because of a real bug caught during M0. The policies had been
 * written with a `from.file.categories.noneOf: ["test"]` selector to exempt test
 * files. That selector does not match files which have no category at all, so
 * every policy silently stopped applying and `pnpm lint` passed on an engine
 * file importing node:fs and zod. A guard nobody has watched fail is not a guard.
 *
 * Writes temporary fixtures under packages/engine/src, lints them, asserts the
 * expected rules fire, and removes them again.
 */
import { ESLint } from "eslint";
import { writeFileSync, rmSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const probeDir = join(root, "packages", "engine", "src", "__boundary_probe__");

/** Each fixture: a filename, its contents, and the rules that must report. */
const FIXTURES = [
  {
    file: "core-import.ts",
    code: `import { readFileSync } from "node:fs";\nexport const x = readFileSync;\n`,
    expect: [{ ruleId: "boundaries/dependencies", match: /Node built-ins/ }],
  },
  {
    file: "external-import.ts",
    code: `import { z } from "zod";\nexport const x = z;\n`,
    expect: [{ ruleId: "boundaries/dependencies", match: /zero runtime dependencies/ }],
  },
  {
    // By package name. pnpm symlinks workspace packages into node_modules, so
    // this resolves as an external module and the external policy catches it.
    file: "workspace-import.ts",
    code: `import { loadScenario } from "@hexport/scenarios";\nexport const x = loadScenario;\n`,
    expect: [
      {
        ruleId: "boundaries/dependencies",
        match: /zero runtime dependencies|leaf/,
      },
    ],
  },
  {
    // By relative path, which resolves as a local module and so needs the
    // separate element-to-element policy. This is the case that would otherwise
    // slip past the external check.
    file: "relative-workspace-import.ts",
    code: `import { parseScenario } from "../../../scenarios/src/schema.js";\nexport const x = parseScenario;\n`,
    expect: [{ ruleId: "boundaries/dependencies", match: /leaf/ }],
  },
  {
    file: "ambient-randomness.ts",
    code: `export const roll = Math.floor(Math.random() * 6) + 1;\n`,
    expect: [{ ruleId: "no-restricted-syntax", match: /seeded PRNG/ }],
  },
  {
    file: "ambient-clock.ts",
    code: `export const a = Date.now();\nexport const b = new Date();\n`,
    expect: [{ ruleId: "no-restricted-syntax", match: /no clock/ }],
  },
];

/** A test file may import vitest; the policies must not fire here. */
const ALLOWED_FIXTURE = {
  file: "allowed.test.ts",
  code: `import { it, expect } from "vitest";\nit("runs", () => { expect(1).toBe(1); });\n`,
};

const failures = [];

async function main() {
  mkdirSync(probeDir, { recursive: true });

  const eslint = new ESLint({ cwd: root });

  for (const fixture of [...FIXTURES, ALLOWED_FIXTURE]) {
    writeFileSync(join(probeDir, fixture.file), fixture.code);
  }

  try {
    const results = await eslint.lintFiles([join(probeDir, "*.ts")]);
    const byFile = new Map(
      results.map((r) => [r.filePath.split("/").pop(), r.messages]),
    );

    for (const fixture of FIXTURES) {
      const messages = byFile.get(fixture.file) ?? [];
      for (const expected of fixture.expect) {
        const hit = messages.some(
          (m) => m.ruleId === expected.ruleId && expected.match.test(m.message),
        );
        if (!hit) {
          failures.push(
            `${fixture.file}: expected ${expected.ruleId} matching ${String(expected.match)}, got: ` +
              (messages.map((m) => `${m.ruleId ?? "?"}: ${m.message}`).join(" | ") ||
                "no messages"),
          );
        }
      }
    }

    const allowedMessages = byFile.get(ALLOWED_FIXTURE.file) ?? [];
    const wrongly = allowedMessages.filter(
      (m) => m.ruleId === "boundaries/dependencies",
    );
    if (wrongly.length > 0) {
      failures.push(
        `${ALLOWED_FIXTURE.file}: test files must be exempt from import policies, but got: ` +
          wrongly.map((m) => m.message).join(" | "),
      );
    }
  } finally {
    rmSync(probeDir, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    console.error("Engine purity guard is not working:");
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }

  console.log(
    `engine purity guard: ${String(FIXTURES.length)} violation types reported, test files exempt.`,
  );
}

await main();
