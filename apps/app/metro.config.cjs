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
 * The workspace packages are ESM and therefore import each other with explicit
 * `.js` extensions, which is correct for Node but points at files that only
 * exist as TypeScript. Rewrite those specifiers when the TypeScript source is
 * actually there, and leave every other request to the default resolver.
 */
const defaultResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
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
