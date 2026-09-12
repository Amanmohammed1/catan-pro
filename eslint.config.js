import js from "@eslint/js";
import tseslint from "typescript-eslint";
import boundaries from "eslint-plugin-boundaries";

/**
 * Architecture enforcement for CLAUDE.md golden rules 1 and 4.
 *
 * Golden rule 1 — "The engine is pure": packages/engine may import nothing.
 *   Not a Node built-in, not an npm package, not another workspace package.
 * Golden rule 4 — "Determinism": no ambient randomness or clock inside the engine.
 *
 * Do not disable these. If the engine needs something it cannot import, the
 * dependency belongs on the other side of the boundary.
 */
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/.turbo/**",
      "**/*.d.ts",
    ],
  },

  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // TypeScript already resolves identifiers; no-undef only produces
      // false positives on type-only and DOM globals.
      "no-undef": "off",
    },
  },

  // Config and script files are plain JS and are not part of any TS project.
  {
    files: ["**/*.{js,mjs,cjs}"],
    extends: [tseslint.configs.disableTypeChecked],
  },

  // ---------------------------------------------------------------------------
  // Architectural boundaries
  // ---------------------------------------------------------------------------
  {
    // Test files are exempt from the import policies: importing vitest is fine,
    // it never ships. The exemption lives here as an `ignores` rather than as a
    // file-category selector inside the policies, because a `categories.noneOf`
    // selector does not match files that have no category at all — which
    // silently disabled every policy below. See scripts/verify-boundary-fires.mjs,
    // which fails the build if these policies ever stop reporting.
    ignores: ["**/*.{test,spec}.{ts,tsx}"],
    plugins: { boundaries },
    settings: {
      "boundaries/root-path": import.meta.dirname,
      "boundaries/elements": [
        {
          type: "engine",
          pattern: "packages/engine/src/**",
          partialMatch: false,
        },
        {
          type: "scenarios",
          pattern: "packages/scenarios/src/**",
          partialMatch: false,
        },
        { type: "web", pattern: "apps/web/src/**", partialMatch: false },
      ],
      "import/resolver": {
        typescript: {
          project: ["packages/*/tsconfig.json", "apps/*/tsconfig.json"],
          // Each package deliberately owns its own tsconfig, so that the engine
          // can drop the DOM and Node libs entirely. Multiple projects is the
          // intended setup here, not something to warn about on every run.
          noWarnOnMultipleProjects: true,
        },
      },
    },
    rules: {
      "boundaries/dependencies": [
        "error",
        {
          default: "allow",
          checkAllOrigins: true,
          policies: [
            {
              from: { element: { type: "engine" } },
              disallow: { to: { module: { origin: "core" } } },
              message:
                "packages/engine is pure: no Node built-ins (CLAUDE.md golden rule 1).",
            },
            {
              from: { element: { type: "engine" } },
              disallow: { to: { module: { origin: "external" } } },
              message:
                "packages/engine is pure: zero runtime dependencies (CLAUDE.md golden rule 1).",
            },
            {
              from: { element: { type: "engine" } },
              disallow: {
                to: { element: { types: { anyOf: ["scenarios", "web"] } } },
              },
              message: "packages/engine is a leaf: it depends on no workspace package.",
            },
            {
              from: { element: { type: "scenarios" } },
              disallow: { to: { element: { type: "web" } } },
              message: "Scenario data must not depend on the client.",
            },
          ],
        },
      ],
    },
  },

  // ---------------------------------------------------------------------------
  // Determinism rules an import graph cannot see (golden rule 4).
  // ---------------------------------------------------------------------------
  {
    files: ["packages/engine/src/**/*.ts"],
    ignores: ["packages/engine/src/**/*.test.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.object.name='Math'][callee.property.name='random']",
          message:
            "Determinism: use the seeded PRNG in engine/rng (CLAUDE.md golden rule 4).",
        },
        {
          selector:
            "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: "Determinism: the engine has no clock (CLAUDE.md golden rule 4).",
        },
        {
          selector: "NewExpression[callee.name='Date']",
          message: "Determinism: the engine has no clock (CLAUDE.md golden rule 4).",
        },
        {
          selector: "MemberExpression[object.name='performance']",
          message: "Determinism: the engine has no clock (CLAUDE.md golden rule 4).",
        },
      ],
    },
  },

  // Tests may be loose about a few things production code may not.
  {
    files: ["**/*.{test,spec}.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
);
