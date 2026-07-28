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
  }
);
