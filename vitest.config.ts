import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const pkg = (name: string): string =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@fam/domain": pkg("domain"),
      "@fam/storage": pkg("storage"),
      "@fam/sync": pkg("sync"),
      "@fam/api": pkg("api"),
      "@fam/i18n": pkg("i18n"),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts", "e2e/**/*.test.ts"],
    hookTimeout: 30000,
    testTimeout: 60000,
  },
});
