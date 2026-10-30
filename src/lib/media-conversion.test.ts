import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { AudioPreparationError, prepareRecordedAudioForWhatsApp } from "./media-conversion";
import { supportedAudioMime } from "./recorded-audio";
import { inspectOggOpus } from "./ogg-opus-integrity";
import { fixtureChecksum, oggPage, opusHeaders, opusSilence, rawOggPage, syntheticOgg, versionedOpusHeaders } from "./ogg-opus-test-fixtures";

let directory: string;
const originalTemp = { TMPDIR: process.env.TMPDIR, TEMP: process.env.TEMP, TMP: process.env.TMP };
const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
const ffprobe = process.env.FFPROBE_PATH || "ffprobe";
const samples = new Map<string, Buffer>();

// Independent oracle for this encoder's 20 ms packets; does not call the production parser.
function assertNormalizedTimeline(bytes: Buffer) {
  let offset = 0, packets = 0, total = 0, previous = 0;
  let pieces: Buffer[] = [];
  while (offset < bytes.length) {
    const count = bytes[offset + 26]; let end = offset + 27 + count;
    for (let i = 0; i < count; i++) {
      const size = bytes[offset + 27 + i]; pieces.push(bytes.subarray(end, end + size)); end += size;
      if (size === 255) continue;
      const packet = Buffer.concat(pieces); pieces = [];
      if (++packets > 2) {
        assert.equal(packet[0] & 3, 0);
        assert.ok([1, 5, 9, 13, 15, 19, 23, 27, 31].includes(packet[0] >>> 3));
        total += 960;
      }
    }
    assert.equal(fixtureChecksum(bytes.subarray(offset, end)), bytes.readUInt32LE(offset + 22));
    if (packets > 2) {
      const granule = Number(bytes.readBigUInt64LE(offset + 6));
      if (bytes[offset + 5] & 4) assert.ok(granule >= previous && granule <= total);
      else assert.equal(granule, total);
      previous = granule;
    }
    offset = end;
  }
  assert.equal(pieces.length, 0);
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "qevora-audio-test-"));
  for (const key of ["TMPDIR", "TEMP", "TMP"] as const) process.env[key] = directory;
  for (const [name, channels, codec] of [
    ["mono.webm", 1, "libopus"], ["stereo.webm", 2, "libopus"],
    ["mono.ogg", 1, "libopus"], ["stereo.ogg", 2, "libopus"],
    ["vorbis.ogg", 1, "libvorbis"], ["mono.m4a", 1, "aac"], ["stereo.m4a", 2, "aac"],
    ["mono.aac", 1, "aac"], ["mono.mp3", 1, "libmp3lame"]
  ] as const) {
    const file = join(directory, name);
    execFileSync(ffmpeg, ["-v", "error", "-nostdin", "-y", "-f", "lavfi", "-i",
      "sine=frequency=440:duration=1", "-ac", String(channels), "-c:a", codec, file], { timeout: 15000 });
    samples.set(name, await readFile(file));
  }
  // MediaRecorder WebM often has no seekable duration header.
  const live = join(directory, "live.webm");
  execFileSync(ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=duration=1",
    "-ac", "2", "-c:a", "libopus", "-live", "1", live], { timeout: 15000 });
  samples.set("live.webm", await readFile(live));
  for (const channels of [1, 2, 3, 6, 8]) {
    const name = `mapped-${channels}.ogg`, file = join(directory, name);
    execFileSync(ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=duration=1",
      "-ac", String(channels), "-channel_layout", channels === 3 ? "3.0" : channels === 6 ? "5.1" : channels === 8 ? "7.1" : channels === 2 ? "stereo" : "mono",
      "-c:a", "libopus", "-mapping_family", "1", file], { timeout: 15000 });
    const input = await readFile(file);
    assert.equal(input[28 + 18], 1);
    assert.equal(inspectOggOpus(input).channels, channels);
    const independent = spawnSync(process.env.OPUSDEC_PATH || "opusdec", ["--quiet", file, "-"], { stdio: ["ignore", "ignore", "pipe"], timeout: 15000 });
    assert.equal(independent.error, undefined); assert.equal(independent.signal, null); assert.equal(independent.status, 0);
    samples.set(name, input);
  }
});

after(async () => {
  for (const key of ["TMPDIR", "TEMP", "TMP"] as const) {
    if (originalTemp[key] === undefined) delete process.env[key]; else process.env[key] = originalTemp[key];
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});

for (const name of ["mono.webm", "stereo.webm", "live.webm", "mono.ogg", "stereo.ogg", "vorbis.ogg", "mono.m4a", "stereo.m4a", "mono.aac", "mono.mp3", "mapped-1.ogg", "mapped-2.ogg", "mapped-3.ogg", "mapped-6.ogg", "mapped-8.ogg"]) {
  test(`normalizes and fully decodes ${name} as Ogg/Opus mono`, async () => {
    const input = samples.get(name)!;
    const snapshot = Buffer.from(input);
    const output = await prepareRecordedAudioForWhatsApp({
      bytes: input, fileName: name, mimeType: supportedAudioMime(name.endsWith("m4a") ? "audio/mp4" : name.endsWith("aac") ? "audio/aac" : name.endsWith("mp3") ? "audio/mpeg" : name.endsWith("webm") ? "audio/webm" : "audio/ogg")!, recordedAudio: true
    });
    assert.equal(output.mimeType, "audio/ogg");
    assert.equal(output.fileName, name.replace(/\.[^.]+$/, ".ogg"));
    assert.deepEqual(input, snapshot);
    assert.equal(output.bytes[28 + 18], 0, "output must use family 0 even for mapped input");
    assert.equal(inspectOggOpus(output.bytes, { normalized: true }).channels, 1);
    assertNormalizedTimeline(output.bytes);
    const file = join(directory, "validated-" + name + ".ogg");
    await writeFile(file, output.bytes);
    const info = JSON.parse(execFileSync(ffprobe, ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], { encoding: "utf8" }));
    assert.equal(info.format.format_name, "ogg");
    assert.equal(info.streams.length, 1);
    assert.equal(info.streams[0].codec_name, "opus");
    assert.equal(info.streams[0].channels, 1);
    assert.equal(info.streams[0].sample_rate, "48000");
    assert.ok(Number(info.format.duration) > 0.9 && Number(info.format.duration) < 1.1);
    execFileSync(ffmpeg, ["-v", "error", "-xerror", "-i", file, "-f", "null", "-"], { timeout: 15000 });
    const independent = spawnSync(process.env.OPUSDEC_PATH || "opusdec", ["--quiet", file, "-"], { stdio: ["ignore", "ignore", "pipe"], timeout: 15000 });
    assert.equal(independent.error, undefined);
    assert.equal(independent.status, 0, "normalized output must decode with Xiph, not only FFmpeg");
  });
}

test("rejects empty and oversized recordings before native processes", async () => {
  for (const bytes of [Buffer.alloc(0), Buffer.alloc(16 * 1024 * 1024 + 1)]) {
    await assert.rejects(prepareRecordedAudioForWhatsApp({ bytes, fileName: "invalid.ogg", mimeType: "audio/ogg" }), AudioPreparationError);
  }
});

test("rejects invalid bytes, corrupt Ogg pages and truncated headers", async () => {
  const corrupt = Buffer.from(samples.get("mono.ogg")!);
  corrupt[Math.floor(corrupt.length / 2)] ^= 255;
  for (const bytes of [Buffer.from("not an audio file"), corrupt, samples.get("mono.ogg")!.subarray(0, 24)]) {
    await assert.rejects(prepareRecordedAudioForWhatsApp({ bytes, fileName: "invalid.ogg", mimeType: "audio/ogg" }), AudioPreparationError);
  }
});

test("rejects a MIME/container mismatch instead of trusting the extension", async () => {
  for (const [name, mimeType] of [["mono.webm", "audio/ogg"], ["mono.ogg", "audio/webm"], ["mono.m4a", "audio/webm"], ["mono.webm", "audio/mp4"]] as const) {
    await assert.rejects(prepareRecordedAudioForWhatsApp({ bytes: samples.get(name)!, fileName: "disguised.ogg", mimeType }), AudioPreparationError);
  }
});

test("rejects empty and corrupt MP4, including an unmarked upload", async () => {
  for (const bytes of [Buffer.alloc(0), Buffer.from("not MP4"), samples.get("mono.m4a")!.subarray(0, 20)]) {
    await assert.rejects(prepareRecordedAudioForWhatsApp({ bytes, fileName: "recording.m4a", mimeType: "audio/mp4", normalize: false }), AudioPreparationError);
  }
});

test("valid MP4/AAC/MP3 attachments are decoded and preserved byte for byte", async () => {
  for (const [name, mimeType] of [["stereo.m4a", "audio/mp4"], ["mono.aac", "audio/aac"], ["mono.mp3", "audio/mpeg"]] as const) {
    const bytes = samples.get(name)!;
    const result = await prepareRecordedAudioForWhatsApp({ bytes, fileName: name, mimeType, normalize: false });
    assert.equal(result.bytes, bytes);
    assert.equal(result.mimeType, mimeType);
    assert.equal(result.fileName, name);
  }
});

test("accepts the existing recorder's last interval plus AAC/Opus padding", async () => {
  const file = join(directory, "recorder-boundary.m4a");
  execFileSync(ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=duration=181", "-ac", "1", "-c:a", "aac", file], { timeout: 15000 });
  const output = await prepareRecordedAudioForWhatsApp({ bytes: await readFile(file), fileName: "boundary.m4a", mimeType: "audio/mp4", recordedAudio: true });
  const target = join(directory, "recorder-boundary.ogg");
  await writeFile(target, output.bytes);
  const info = JSON.parse(execFileSync(ffprobe, ["-v", "error", "-show_format", "-of", "json", target], { encoding: "utf8" }));
  assert.ok(Number(info.format.duration) >= 181 && Number(info.format.duration) <= 182);
});

test("browser-style millisecond timestamps reproduce the pre-upload granule defect and are regenerated from samples", async () => {
  for (const expression of ["PTS-8*gt(N,0)", "PTS+mod(N,3)"]) {
    const source = join(directory, "timestamp-input.webm");
    execFileSync(ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=duration=6", "-ac", "2", "-c:a", "libopus", "-bsf:a", `setts=pts='${expression}':dts='${expression}'`, source], { timeout: 15000 });
    const before = join(directory, "timestamp-before.ogg");
    execFileSync(ffmpeg, ["-v", "error", "-y", "-f", "webm", "-i", source, "-map", "0:a:0", "-vn", "-map_metadata", "-1", "-acodec", "libopus", "-ac", "1", "-ar", "48000", "-b:a", "32k", "-threads", "1", before], { timeout: 15000 });
    const beforeBytes = await readFile(before);
    assert.throws(() => inspectOggOpus(beforeBytes));
    const result = await prepareRecordedAudioForWhatsApp({ bytes: await readFile(source), fileName: "recording.webm", mimeType: "audio/webm", recordedAudio: true });
    assertNormalizedTimeline(result.bytes);
    const info = inspectOggOpus(result.bytes, { normalized: true });
    assert.ok(info.duration > 5.8 && info.duration < 6.2);
  }
});

test("FFmpeg/FFprobe failures fail closed, sanitize errors and clean temporary files", async () => {
  const beforeFiles = (await readdir(tmpdir())).filter(name => name.startsWith("crm-audio-")).sort();
  for (const variable of ["FFMPEG_PATH", "FFPROBE_PATH"] as const) {
    const previous = process.env[variable];
    try {
      process.env[variable] = join(directory, "SENSITIVE_SENTINEL_missing_binary");
      await assert.rejects(prepareRecordedAudioForWhatsApp({ bytes: samples.get("mono.webm")!, fileName: "recording.webm", mimeType: "audio/webm" }),
        (error: unknown) => error instanceof AudioPreparationError && !error.message.includes("SENSITIVE_SENTINEL"));
      process.env[variable] = process.execPath;
      await assert.rejects(prepareRecordedAudioForWhatsApp({ bytes: samples.get("mono.webm")!, fileName: "recording.webm", mimeType: "audio/webm" }), AudioPreparationError);
    } finally {
      if (previous === undefined) delete process.env[variable]; else process.env[variable] = previous;
    }
  }
  assert.deepEqual((await readdir(tmpdir())).filter(name => name.startsWith("crm-audio-")).sort(), beforeFiles);
});

test("valid empty-page and compatible-version inputs normalize to the strict v1 output profile", async () => {
  const empty = (sequence: number, flags = 0) => rawOggPage([], Buffer.alloc(0), BigInt("18446744073709551615"), sequence, flags);
  const packets = Array.from({ length: 50 }, () => opusSilence);
  const cases = [
    Buffer.concat([...opusHeaders(), empty(2), oggPage(packets, 48000, 3), oggPage([opusSilence], 48312, 4, 4)]),
    Buffer.concat([...opusHeaders(), oggPage(packets, 48000, 2), empty(3), oggPage([opusSilence], 48312, 4, 4)]),
    Buffer.concat([...opusHeaders(), oggPage(packets, 48000, 2), empty(3, 4)]),
    ...[0, 1].flatMap(family => [2, 15].map(version => Buffer.concat([
      versionedOpusHeaders(version, family as 0 | 1, Buffer.from([5, 4, 3]))[0], syntheticOgg().subarray(opusHeaders()[0].length)
    ])))
  ];
  for (const [index, bytes] of Array.from(cases.entries())) {
    assert.ok(inspectOggOpus(bytes).duration > 0.9);
    const input = join(directory, `compatibility-${index}.ogg`); await writeFile(input, bytes);
    const nativeInput = spawnSync(process.env.OPUSDEC_PATH || "opusdec", ["--quiet", input, "-"], { stdio: ["ignore", "ignore", "pipe"], timeout: 15000 });
    assert.equal(nativeInput.error, undefined); assert.equal(nativeInput.signal, null); assert.equal(nativeInput.status, 0);
    const output = await prepareRecordedAudioForWhatsApp({ bytes, fileName: "compatibility.ogg", mimeType: "audio/ogg", recordedAudio: true });
    assert.equal(inspectOggOpus(output.bytes, { normalized: true }).channels, 1);
    assert.equal(output.bytes[28 + 8], 1); assert.equal(output.bytes[28 + 18], 0);
    assertNormalizedTimeline(output.bytes);
    const target = join(directory, `compatibility-output-${index}.ogg`); await writeFile(target, output.bytes);
    const probe = JSON.parse(execFileSync(ffprobe, ["-v", "error", "-show_streams", "-show_format", "-of", "json", target], { encoding: "utf8" }));
    assert.equal(probe.streams[0].channels, 1); assert.equal(probe.streams[0].sample_rate, "48000"); assert.equal(probe.streams[0].codec_name, "opus");
    assert.ok(Number(probe.format.duration) > 0.9 && Number(probe.format.duration) < 1.1);
    execFileSync(ffmpeg, ["-v", "error", "-xerror", "-i", target, "-f", "null", "-"], { timeout: 15000 });
    const nativeOutput = spawnSync(process.env.OPUSDEC_PATH || "opusdec", ["--quiet", target, "-"], { stdio: ["ignore", "ignore", "pipe"], timeout: 15000 });
    assert.equal(nativeOutput.error, undefined); assert.equal(nativeOutput.signal, null); assert.equal(nativeOutput.status, 0);
  }
});
