import fs from "node:fs";
import Module, { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const originalResolveFilename = Module._resolveFilename;

Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
  const resolvedRequest = request.startsWith("@/")
    ? path.join(process.cwd(), "src", request.slice(2))
    : request;
  return originalResolveFilename.call(this, resolvedRequest, parent, isMain, options);
};

require.extensions[".ts"] = function transpileTypeScript(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      esModuleInterop: true
    }
  });
  module._compile(compiled.outputText, filename);
};

export function isDirectRun(entrypoint = process.argv[1], moduleUrl = import.meta.url) {
  return Boolean(entrypoint && moduleUrl === pathToFileURL(entrypoint).href);
}

const { runCltBackfillCli, sanitizeCltBackfillCliError } = require("./backfill-clt-secrets.ts");

if (isDirectRun()) {
  runCltBackfillCli().catch((error) => {
    console.error(JSON.stringify({ ok: false, code: sanitizeCltBackfillCliError(error) }));
    process.exitCode = 1;
  });
}
