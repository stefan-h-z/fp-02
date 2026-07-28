/**
 * The render harness for the screens (docs/status.md).
 *
 * This is a second test runner on purpose. Vitest runs everything else in the
 * repository and cannot render React Native: React Native ships Flow-typed
 * source, which needs Babel with `babel-preset-expo` rather than esbuild, and
 * aliasing to `react-native-web` does not change that. Jest with the Expo preset
 * is the supported way to get that transform, so it owns exactly one directory —
 * `render-test/` — which Vitest's globs, rooted at each package's `test`
 * directory, never reach.
 *
 * Config is CommonJS because Jest loads it before any transform is in place, and
 * this package is `"type": "module"`.
 */
const path = require("node:path");

/**
 * The design system is consumed through a link to a sibling checkout, so its
 * compiled output resolves its own React and React Native from *that* checkout's
 * store. Two copies of React break hooks and two copies of React Native throw
 * `__fbBatchedBridgeConfig is not set` the moment a component touches
 * `Platform`, so every shared runtime is pinned to this app's copy.
 */
const singleton = (name) => path.dirname(require.resolve(name + "/package.json"));

const SHARED_RUNTIME = [
  "react",
  "react-dom",
  "react-native",
  "react-test-renderer",
  "@tamagui/core",
  "react-native-svg",
  "lucide-react-native",
];

const sharedRuntimeMapping = Object.fromEntries(
  SHARED_RUNTIME.flatMap((name) => [
    ["^" + name + "$", singleton(name)],
    ["^" + name + "/(.*)$", singleton(name) + "/$1"],
  ]),
);

module.exports = {
  preset: "jest-expo/ios",
  rootDir: __dirname,
  moduleNameMapper: sharedRuntimeMapping,
  testMatch: ["<rootDir>/render-test/**/*.test.tsx"],
  resolver: "<rootDir>/render-test/resolve.cjs",
  setupFilesAfterEnv: ["<rootDir>/render-test/setup.ts"],
  // pnpm stores every dependency under `node_modules/.pnpm/<name>@<version>/`,
  // so the usual `node_modules/(?!react-native|…)` pattern matches at the store
  // directory and stops before it ever sees the package name. Allowing `.pnpm`
  // through lets the second `node_modules/` in the path decide.
  transformIgnorePatterns: [
    // `uuid` is here for a different reason from the rest: v11 publishes ESM
    // only, so it needs transforming even though it is nobody's UI dependency.
    "node_modules/(?!\\.pnpm|react-native|@react-native|react-native-.*|expo|expo-.*|@expo|@cp|@fam|@tamagui|lucide-react-native|@radix-ui|react-day-picker|@react-navigation|uuid)",
  ],
};
