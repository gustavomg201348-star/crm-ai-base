import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { audioFormats, createRecordedAudioFile, supportedAudioMime } from "./recorded-audio";
import { mappedOpusHeaders, oggPage, opusHeaders, opusSilence, patchOggPage, rawOggPage, syntheticOgg, versionedOpusHeaders } from "./ogg-opus-test-fixtures";

function fixture(options: { preparationFails?: boolean; uploadFails?: boolean; sendFails?: boolean; missingMessageId?: boolean; realPreparation?: boolean } = {}) {
  const calls: Array<{ operation: string; data: Record<string, unknown> }> = [];
  const file = path.resolve("src/lib/whatsapp-media.service.ts");
  const from = createRequire(file);
  const loaded = { exports: {} as typeof import("./whatsapp-media.service") };
  const code = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText;
  const record = (operation: string, data: Record<string, unknown>) => calls.push({ operation, data });
  new Function("require", "module", "exports", code)((name: string) => {
    if (name === "@/lib/media-conversion") return {
      prepareRecordedAudioForWhatsApp: async (data: Record<string, unknown>) => {
        record("prepare", data);
        if (options.realPreparation) return from("./media-conversion.ts").prepareRecordedAudioForWhatsApp(data);
        if (options.preparationFails) throw new Error("invalid audio");
        if (!data.normalize) return data;
        return { bytes: Buffer.from("validated audio"), fileName: "recording.ogg", mimeType: "audio/ogg" };
      }
    };
    if (name === "@/lib/conversation-message.service") return {
      getConversationIntegration: async (data: Record<string, unknown>) => {
        record("scope", data);
        return { conversation: { contact: { phone: "+5511999990000" } }, channel: { phoneNumberId: "synthetic-channel", accessToken: "synthetic-token" } };
      },
      saveOutboundMessage: async (data: Record<string, unknown>) => { record("save", data); return { id: "synthetic-message" }; }
    };
    if (name === "@/lib/meta-whatsapp") return {
      uploadMetaMedia: async (data: Record<string, unknown>) => {
        record("upload", data);
        if (options.uploadFails) throw new Error("mocked Meta upload failure");
        return { id: "synthetic-media" };
      },
      sendMetaMediaMessage: async (data: Record<string, unknown>) => {
        record("send", data);
        if (options.sendFails) throw new Error("mocked Meta send failure");
        return options.missingMessageId ? {} : { messages: [{ id: "synthetic-wamid" }] };
      },
      readMetaMessageId: (data: { messages?: Array<{ id: string }> }) => data.messages?.[0]?.id ?? null
    };
    return from(name);
  }, loaded, loaded.exports);
  const send = (mimeType = "audio/webm;codecs=opus", bytes = Buffer.from("source"), recordedAudio = false, fileName = "recording.webm") => loaded.exports.sendConversationMedia({
    companyId: "company-a", conversationId: "conversation-a", userId: "user-a",
    mimeType, fileName, bytes, caption: "synthetic caption", recordedAudio
  });
  return { calls, send };
}

for (const mimeType of ["audio/webm;codecs=opus", "audio/ogg; codecs=opus", "audio/mp4;codecs=mp4a.40.2", "audio/aac", "audio/mpeg", "audio/amr"]) {
  test(`uploads only prepared bytes and preserves scope for ${mimeType}`, async () => {
    const f = fixture();
    await f.send(mimeType, Buffer.from("source"), true);
    assert.deepEqual(f.calls.map(call => call.operation), ["prepare", "scope", "upload", "send", "save"]);
    assert.deepEqual(f.calls[1].data, { companyId: "company-a", conversationId: "conversation-a" });
    assert.equal(f.calls[2].data.mimeType, "audio/ogg");
    assert.equal(f.calls[2].data.fileName, "recording.ogg");
    assert.deepEqual(f.calls[2].data.bytes, Buffer.from("validated audio"));
    assert.equal(f.calls[3].data.mediaType, "audio");
    assert.equal(f.calls[3].data.phoneNumberId, "synthetic-channel");
    assert.equal(f.calls[4].data.providerMessageId, "synthetic-wamid");
  });
}

for (const [option, expected] of [
  ["preparationFails", ["prepare"]], ["uploadFails", ["prepare", "scope", "upload"]],
  ["sendFails", ["prepare", "scope", "upload", "send"]], ["missingMessageId", ["prepare", "scope", "upload", "send"]]
] as const) {
  test(`${option} never persists a successful outbound audio`, async () => {
    const f = fixture({ [option]: true });
    await assert.rejects(f.send());
    assert.deepEqual(f.calls.map(call => call.operation), expected);
  });
}

for (const mimeType of ["image/jpeg", "image/png", "video/mp4", "application/pdf", "audio/mpeg", "audio/mp4", "audio/amr", "audio/aac",
  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]) {
  test(`preserves legacy payload and one upload/send for ${mimeType}`, async () => {
    const f = fixture();
    const bytes = Buffer.from("unchanged legacy payload");
    const audioMime = supportedAudioMime(mimeType);
    const fileName = audioMime ? `attachment.${audioFormats[audioMime].extension}` : "attachment.original";
    await f.send(mimeType, bytes, false, fileName);
    const audio = mimeType.startsWith("audio/");
    assert.deepEqual(f.calls.map(call => call.operation), audio ? ["prepare", "scope", "upload", "send", "save"] : ["scope", "upload", "send", "save"]);
    const upload = f.calls.find(call => call.operation === "upload")!;
    assert.equal(upload.data.bytes, bytes);
    assert.equal(upload.data.mimeType, mimeType);
    assert.equal(upload.data.fileName, fileName);
    assert.equal(f.calls.find(call => call.operation === "send")!.data.caption, "synthetic caption");
  });
}

test("independent MP4 counterexamples: legacy mislabeled file and empty MP4 never reach Meta", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "qevora-mp4-route-"));
  try {
    const file = path.join(directory, "stereo.m4a");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=duration=1", "-ac", "2", "-c:a", "aac", file]);
    const bytes = await readFile(file);
    for (const invalid of [bytes, Buffer.alloc(0), Buffer.from("corrupt MP4")]) {
      const f = fixture({ realPreparation: true });
      await assert.rejects(f.send("audio/mp4", invalid, false, "audio-synthetic.webm"));
      assert.deepEqual(f.calls.map(call => call.operation), ["prepare"]);
    }
    for (const recorded of [true, false]) {
      for (const invalid of [Buffer.alloc(0), Buffer.from("corrupt MP4"), Buffer.alloc(16 * 1024 * 1024 + 1)]) {
        const invalidFixture = fixture({ realPreparation: true });
        await assert.rejects(invalidFixture.send("audio/mp4", invalid, recorded, "audio-test.m4a"));
        assert.deepEqual(invalidFixture.calls.map(call => call.operation), ["prepare"]);
      }
    }
    const recording = createRecordedAudioFile([new Blob([new Uint8Array(bytes)], { type: "audio/mp4" })], "audio/mp4", "audio-test");
    const f = fixture({ realPreparation: true });
    await f.send(recording.type, Buffer.from(await recording.arrayBuffer()), true, recording.name);
    const upload = f.calls.find(call => call.operation === "upload")!;
    assert.equal(upload.data.mimeType, "audio/ogg");
    assert.equal(upload.data.fileName, "audio-test.ogg");
    const output = path.join(directory, "output.ogg");
    await writeFile(output, upload.data.bytes as Buffer);
    const info = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-of", "json", output], { encoding: "utf8" }));
    assert.equal(info.streams[0].codec_name, "opus");
    assert.equal(info.streams[0].channels, 1);
    assert.deepEqual(f.calls.map(call => call.operation), ["prepare", "scope", "upload", "send", "save"]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("structurally invalid Ogg/Opus never uploads, sends or persists successful audio", async () => {
  const valid = syntheticOgg();
  for (const bytes of [syntheticOgg(312, 47976), patchOggPage(valid, 3, p => p.writeBigUInt64LE(BigInt(49000), 6)), valid.subarray(0, valid.length - 1)]) {
    const f = fixture({ realPreparation: true });
    await assert.rejects(f.send("audio/ogg", bytes, true, "recording.ogg"));
    assert.deepEqual(f.calls.map(call => call.operation), ["prepare"]);
  }
});

test("family 1 mono is normalized before upload; invalid mapping never reaches Meta or success persistence", async () => {
  const bytes = Buffer.concat([...mappedOpusHeaders(), oggPage([opusSilence], 960, 2, 4)]);
  const valid = fixture({ realPreparation: true });
  await valid.send("audio/ogg", bytes, true, "mapped.ogg");
  assert.deepEqual(valid.calls.map(call => call.operation), ["prepare", "scope", "upload", "send", "save"]);
  const uploaded = valid.calls.find(call => call.operation === "upload")!.data.bytes as Buffer;
  assert.equal(uploaded[28 + 18], 0); assert.equal(uploaded[28 + 9], 1);
  for (const invalid of [patchOggPage(bytes, 0, p => { p[28 + 21] = 1; }),
    patchOggPage(bytes, 0, p => { p[28 + 19] = 0; }), bytes.subarray(0, bytes.length - 1)]) {
    const f = fixture({ realPreparation: true });
    await assert.rejects(f.send("audio/ogg", invalid, true, "invalid.ogg"));
    assert.deepEqual(f.calls.map(call => call.operation), ["prepare"]);
  }
});

test("empty pages and compatible headers reach mocked Meta only after normalization; malformed variants never do", async () => {
  const empty = rawOggPage([], Buffer.alloc(0), BigInt("18446744073709551615"), 2);
  const withEmpty = Buffer.concat([...opusHeaders(), empty, oggPage([opusSilence], 960, 3, 4)]);
  const v2 = Buffer.concat([...versionedOpusHeaders(2, 1, Buffer.from([9, 8])), oggPage([opusSilence], 960, 2, 4)]);
  for (const bytes of [withEmpty, v2]) {
    const f = fixture({ realPreparation: true });
    await f.send("audio/ogg", bytes, true, "input.ogg");
    assert.deepEqual(f.calls.map(call => call.operation), ["prepare", "scope", "upload", "send", "save"]);
    const output = f.calls.find(call => call.operation === "upload")!.data.bytes as Buffer;
    assert.equal(output[28 + 8], 1); assert.equal(output[28 + 9], 1); assert.equal(output[28 + 18], 0);
  }
  for (const bytes of [
    patchOggPage(withEmpty, 2, p => p.writeBigUInt64LE(BigInt(0), 6)),
    patchOggPage(withEmpty, 2, p => { p[5] = 1; }),
    patchOggPage(v2, 0, p => { p[28 + 8] = 16; }),
    patchOggPage(v2, 0, p => { p[28 + 19] = 0; }),
    Buffer.concat([...opusHeaders(), empty, oggPage([Buffer.alloc(0)], 960, 3, 4)])
  ]) {
    const f = fixture({ realPreparation: true });
    await assert.rejects(f.send("audio/ogg", bytes, true, "invalid.ogg"));
    assert.deepEqual(f.calls.map(call => call.operation), ["prepare"]);
  }
});
