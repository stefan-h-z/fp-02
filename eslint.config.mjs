import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/.expo/**"] },
  ...tseslint.configs.recommended,
  {
    // Metro, Babel and Jest each load their config — and Jest its resolver —
    // through CommonJS before any transform is in place, so these cannot be ESM
    // even though the packages holding them are.
    files: [
      "**/metro.config.cjs",
      "**/babel.config.cjs",
      "**/jest.config.cjs",
      "**/render-test/resolve.cjs",
    ],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
      "no-console": ["error", { allow: ["warn", "error"] }]
    }
  },
  {
    // Last, because flat config resolves in order and the block above would
    // otherwise win. The browser harness is a command-line tool whose output
    // *is* its product: which step passed, which backend call the app made,
    // what the screen said when something failed. `console.log` is the
    // interface here, not a leftover debug statement.
    files: ["apps/*/e2e/**/*.mjs"],
    rules: { "no-console": "off" },
  }
);
