import { build } from "esbuild";

// A server-only artifact: runtime environment is never inlined into this bundle.
await build({
  entryPoints: ["src/lib/opencredit-materialization-worker.ts"],
  outfile: ".next/opencredit-worker.cjs",
  bundle: true, platform: "node", target: "node20", format: "cjs",
  packages: "external", jsx: "automatic", sourcemap: false,
  plugins: [{ name: "server-only-marker", setup(build) {
    // Like Next's server compiler, consume the marker only in this explicit Node artifact.
    build.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "server-marker" }));
    build.onLoad({ filter: /.*/, namespace: "server-marker" }, () => ({ contents: "", loader: "js" }));
  } }],
});
