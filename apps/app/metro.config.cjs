// Metro must reach out of the app directory: the domain packages live in the
// workspace root, and the design system lives in a sibling checkout until it is
// published (see docs/status.md).
const fs = require("node:fs");
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");
const designSystemRoot = path.resolve(workspaceRoot, "../cp-testt1-09");

const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot, designSystemRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
  path.resolve(designSystemRoot, "node_modules"),
];
// Hierarchical lookup stays ON: pnpm puts a package's own dependencies inside
// its store directory, and disabling the walk hides them from Metro.

// The design-system packages declare `exports` and no `main`, so Metro has to
// read the exports map to find them at all.
config.resolver.unstable_enablePackageExports = true;

/**
 * Exactly one copy of every runtime that keeps state.
 *
 * The design system is consumed through a link into a sibling checkout, so
 * Metro resolves *its* `react` by walking up from that checkout and finds the
 * copy in its pnpm store — a second React, with its own hook dispatcher. The
 * build succeeds and the page then dies on first paint with
 * `Cannot read properties of null (reading 'useRef')`, thrown from whichever
 * component happens to render first.
 *
 * Only a real browser catches this: the render tests pin the same singletons
 * through Jest's `moduleNameMapper` (jest.config.cjs), so they are immune to
 * the very thing that breaks the shipped bundle. That is why `e2e/` exists.
 *
 * React and React Native are here because they hold state. `@tamagui/core`
 * is here because its theme lives in a module-level context, and a second copy
 * means `useTheme` reads a context nobody provided.
 */
const SHARED_RUNTIME = [
  "react",
  "react-dom",
  "react-native",
  "react-native-web",
  "react-native-svg",
  "@tamagui/core",
];

const singletons = new Map(
  SHARED_RUNTIME.map((name) => [
    name,
    path.dirname(require.resolve(`${name}/package.json`, { paths: [projectRoot] })),
  ]),
);

/**
 * The workspace packages are ESM and therefore import each other with explicit
 * `.js` extensions, which is correct for Node but points at files that only
 * exist as TypeScript. Rewrite those specifiers when the TypeScript source is
 * actually there, and leave every other request to the default resolver.
 */
const defaultResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  for (const [name, root] of singletons) {
    if (moduleName !== name && !moduleName.startsWith(`${name}/`)) continue;
    // Re-resolve from the app rather than from whoever asked, so every importer
    // — including the linked design system — lands on the same instance.
    return context.resolveRequest(
      { ...context, originModulePath: path.join(root, "package.json") },
      moduleName,
      platform,
    );
  }

  if (moduleName.startsWith(".") && moduleName.endsWith(".js")) {
    const base = moduleName.slice(0, -3);
    const from = path.dirname(context.originModulePath);
    for (const extension of [".ts", ".tsx"]) {
      if (fs.existsSync(path.resolve(from, base + extension))) {
        return context.resolveRequest(context, base + extension, platform);
      }
    }
  }
  return (defaultResolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
