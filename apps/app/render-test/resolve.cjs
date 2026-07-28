/**
 * The same specifier rewrite Metro does (`metro.config.cjs`), for Jest.
 *
 * The workspace packages are ESM and therefore import each other with explicit
 * `.js` extensions, which is correct for Node but points at files that only
 * exist as TypeScript. Rewriting is conditional on the TypeScript file actually
 * being there, so a genuine `.js` file in a dependency still resolves normally.
 */
const fs = require("node:fs");
const path = require("node:path");

module.exports = function resolve(request, options) {
  if (request.startsWith(".") && request.endsWith(".js")) {
    const base = request.slice(0, -3);
    for (const extension of [".ts", ".tsx"]) {
      const candidate = path.resolve(options.basedir, base + extension);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return options.defaultResolver(request, options);
};
