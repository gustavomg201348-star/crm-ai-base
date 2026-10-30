import assert from "node:assert/strict";
import { execFile, type ExecFileOptions } from "node:child_process";
import { readFileSync } from "node:fs";
import * as fs from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import ts from "typescript";
import { syntheticOgg } from "./ogg-opus-test-fixtures";

const nativeExec = promisify(execFile);
type ToolResult = { stdout: string; stderr: string };
type Tool = (command: string, args: string[], options: ExecFileOptions) => Promise<ToolResult>;
const probe = (format: string, duration = "1") => ({ stdout: JSON.stringify({
  streams: [{ codec_type: "audio", codec_name: "opus", channels: 1 }], format: { format_name: format, duration }
}), stderr: "" });
const progress = { stdout: "out_time_us=1000000\nprogress=end\n", stderr: "" };

function load(root: string, tool: Tool, now = () => performance.now(), filesystem: Partial<typeof fs> = {}) {
  const file = path.resolve("src/lib/media-conversion.ts");
  const from = createRequire(file);
  const stub = Object.assign(() => {}, { [promisify.custom]: tool });
  const loaded = { exports: {} as typeof import("./media-conversion") };
  const compiled = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText;
  new Function("require", "module", "exports", "performance", compiled)((name: string) => {
    if (name === "node:child_process") return { execFile: stub };
    if (name === "node:fs/promises") return { ...fs, ...filesystem };
    if (name === "node:os") return { tmpdir: () => root };
    return from(name);
  }, loaded, loaded.exports, { now });
  return loaded.exports;
}

const input = { bytes: Buffer.from("controlled fixture"), mimeType: "audio/webm" as const, fileName: "input.webm", recordedAudio: true };

test("oversized native output is rejected before output probe, decode or Buffer read", async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), "qevora-resource-"));
  let opens = 0;
  let probes = 0;
  try {
    const converter = load(root, async (_command, args) => {
      if (args.includes("-show_streams")) { probes++; return probe("webm"); }
      if (!args.includes("libopus")) return progress;
      const cap = Number(args[args.indexOf("-fs") + 1]);
      assert.equal(cap, 17 * 1024 * 1024);
      assert.ok(args.includes("-threads"));
      const output = args[args.length - 1];
      await fs.writeFile(output, "");
      await fs.truncate(output, cap);
      return { stdout: "", stderr: "" };
    }, undefined, { open: async (...args: Parameters<typeof fs.open>) => { opens++; return fs.open(...args); } });
    await assert.rejects(converter.prepareRecordedAudioForWhatsApp(input), converter.AudioPreparationError);
    assert.equal(opens, 0);
    assert.equal(probes, 1);
    assert.deepEqual(await fs.readdir(root), []);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("remaining 60-second budget kills an actually pending child and cleans/relinquishes capacity", async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), "qevora-timeout-"));
  let clock = 0;
  let timedOut = false;
  let hang = true;
  try {
    const converter = load(root, async (_command, args, options) => {
      if (args.includes("-show_streams")) {
        if (hang) clock = 59980;
        return probe(args[args.indexOf("-f") + 1]);
      }
      if (hang) {
        assert.equal(options.killSignal, "SIGKILL");
        assert.ok(Number(options.timeout) > 0 && Number(options.timeout) <= 20);
        try { await nativeExec(process.execPath, ["-e", "setInterval(() => {}, 1000)"], options); }
        catch (error) { timedOut = Boolean((error as { killed?: boolean }).killed); throw error; }
      }
      if (args.includes("libopus")) await fs.writeFile(args[args.length - 1], syntheticOgg());
      return progress;
    }, () => clock);
    await assert.rejects(converter.prepareRecordedAudioForWhatsApp(input), converter.AudioPreparationError);
    assert.equal(timedOut, true);
    assert.deepEqual(await fs.readdir(root), []);
    hang = false;
    clock = 0;
    await converter.prepareRecordedAudioForWhatsApp(input);
    assert.deepEqual(await fs.readdir(root), []);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("at most two preparations run per runtime, without queue, with recovery after completion", async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), "qevora-capacity-"));
  const releases: Array<() => void> = [];
  let ready!: () => void;
  const bothReady = new Promise<void>(resolve => { ready = resolve; });
  let block = true;
  try {
    const converter = load(root, async (_command, args) => {
      if (args.includes("-show_streams")) {
        const result = probe(args[args.indexOf("-f") + 1]);
        if (block) return new Promise<ToolResult>(resolve => {
          releases.push(() => resolve(result));
          if (releases.length === 2) ready();
        });
        return result;
      }
      if (args.includes("libopus")) await fs.writeFile(args[args.length - 1], syntheticOgg());
      return progress;
    });
    const first = converter.prepareRecordedAudioForWhatsApp(input);
    const second = converter.prepareRecordedAudioForWhatsApp(input);
    await bothReady;
    await assert.rejects(converter.prepareRecordedAudioForWhatsApp(input), converter.AudioPreparationError);
    assert.equal(releases.length, 2);
    block = false;
    releases.forEach(release => release());
    await Promise.all([first, second]);
    await converter.prepareRecordedAudioForWhatsApp(input);
    assert.deepEqual(await fs.readdir(root), []);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("recorded duration above the composer ceiling and zero decoded frames fail closed", async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), "qevora-duration-"));
  try {
    for (const duration of ["183", "N/A"]) {
      const converter = load(root, async (_command, args) => args.includes("-show_streams") ? probe("webm", duration) : { stdout: "out_time_us=0\n", stderr: "" });
      await assert.rejects(converter.prepareRecordedAudioForWhatsApp(input), converter.AudioPreparationError);
      assert.deepEqual(await fs.readdir(root), []);
    }
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
