import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/.expo/**"] },
  ...tseslint.configs.recommended,
  {
    // Metro and Babel load their config through CommonJS before any bundler
    // runs, so these two files cannot be ESM.
    files: ["**/metro.config.cjs", "**/babel.config.cjs"],
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
