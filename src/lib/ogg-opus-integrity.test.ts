import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { inspectOggOpus, OggOpusIntegrityError } from "./ogg-opus-integrity";
import { mappedOpusHeaders, oggPage, opusHeaders, opusSilence, patchOggPage, rawOggPage, syntheticOgg, versionedOpusHeaders } from "./ogg-opus-test-fixtures";

test("RFC 7845: rejects 47976 granule for 50 complete 960-sample packets, despite pre-skip 312", () => {
  assert.throws(() => inspectOggOpus(syntheticOgg(312, 47976)), (e: unknown) => e instanceof OggOpusIntegrityError && e.code === "INITIAL_GRANULE");
  const decoded = spawnSync(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-xerror", "-err_detect", "explode", "-f", "ogg", "-i", "pipe:0", "-f", "null", "-"], { input: syntheticOgg(312, 47976), timeout: 15000 });
  assert.equal(decoded.status, 0, "demonstrates why successful FFmpeg decoding alone is insufficient");
  const decodeWithXiph = (bytes: Buffer) => spawnSync(process.env.OPUSDEC_PATH || "opusdec", ["--quiet", "-", "-"], { input: bytes, stdio: ["pipe", "ignore", "pipe"], timeout: 15000 });
  const invalid = decodeWithXiph(syntheticOgg(312, 47976));
  assert.equal(invalid.error, undefined, "independent decoder must actually execute");
  assert.equal(invalid.signal, null, "native crash is not a valid rejection");
  assert.equal(invalid.status, 1, "Xiph must explicitly reject the invalid initial granule");
  assert.equal(decodeWithXiph(syntheticOgg()).status, 0, "valid control must decode with the same independent tool");
});

test("valid pre-skip, zero pre-skip, multi-page streams and final trimming", () => {
  for (const skip of [0, 312, 960]) {
    const result = inspectOggOpus(syntheticOgg(skip), { normalized: true });
    assert.equal(result.preSkip, skip); assert.equal(result.pages, 4); assert.ok(result.duration > 0);
  }
});

test("EOS on the first audio page may trim below packet samples, but not to or below pre-skip", () => {
  const short = (granule: number) => Buffer.concat([...opusHeaders(), oggPage([opusSilence], granule, 2, 4)]);
  assert.ok(inspectOggOpus(short(480)).duration > 0);
  for (const granule of [0, 311, 312]) assert.throws(() => inspectOggOpus(short(granule)));
});

test("valid initial offset is permitted on input but not on normalized output", () => {
  assert.ok(inspectOggOpus(syntheticOgg(312, 49000)).duration > 0);
  assert.throws(() => inspectOggOpus(syntheticOgg(312, 49000), { normalized: true }));
});

test("intermediate pages must add exactly their completed packet samples", () => {
  const bytes = Buffer.concat([...opusHeaders(), oggPage([opusSilence], 960, 2), oggPage([opusSilence], 1920, 3), oggPage([opusSilence], 2400, 4, 4)]);
  assert.ok(inspectOggOpus(bytes).duration > 0);
  for (const delta of [-24, 24]) assert.throws(() => inspectOggOpus(patchOggPage(bytes, 3, p => p.writeBigUInt64LE(BigInt(1920 + delta), 6))));
});

test("rejects invalid EOS, missing EOS, duplicate/chained streams and trailing bytes", () => {
  const bytes = syntheticOgg();
  for (const granule of [47000, 48961]) assert.throws(() => inspectOggOpus(patchOggPage(bytes, 3, p => p.writeBigUInt64LE(BigInt(granule), 6))));
  assert.throws(() => inspectOggOpus(patchOggPage(bytes, 3, p => { p[5] = 0; })));
  assert.throws(() => inspectOggOpus(Buffer.concat([bytes, bytes])));
  assert.throws(() => inspectOggOpus(Buffer.concat([bytes, Buffer.from([0])])));
});

test("CRC, truncation, page sequence, serial, flags and granule range fail closed", () => {
  const bytes = syntheticOgg(); const corrupt = Buffer.from(bytes); corrupt[corrupt.length - 1] ^= 1;
  for (const invalid of [corrupt, bytes.subarray(0, 23), bytes.subarray(0, bytes.length - 1),
    patchOggPage(bytes, 2, p => p.writeUInt32LE(8, 14)), patchOggPage(bytes, 2, p => p.writeUInt32LE(9, 18)),
    patchOggPage(bytes, 2, p => { p[5] = 1; }), patchOggPage(bytes, 2, p => { p[5] = 8; }),
    patchOggPage(bytes, 2, p => p.writeBigUInt64LE(BigInt("18446744073709551615"), 6)),
    patchOggPage(bytes, 2, p => p.writeBigUInt64LE(BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1), 6))]) assert.throws(() => inspectOggOpus(invalid));
});

test("valid stereo is convertible input, not normalized output; invalid headers/tags are rejected", () => {
  const stereo = patchOggPage(syntheticOgg(), 0, p => { p[27 + p[26] + 9] = 2; });
  assert.equal(inspectOggOpus(stereo).channels, 2);
  assert.throws(() => inspectOggOpus(stereo, { normalized: true }));
  for (const invalid of [patchOggPage(stereo, 0, p => { p[27 + p[26] + 9] = 3; }),
    patchOggPage(stereo, 0, p => { p[27 + p[26] + 18] = 1; }),
    patchOggPage(stereo, 1, p => p.writeUInt32LE(1000, 27 + p[26] + 8))]) assert.throws(() => inspectOggOpus(invalid));
});

test("rejects empty, oversized and malformed Opus packets including invalid padding/frame lengths", () => {
  for (const packet of [Buffer.alloc(0), Buffer.from([0xfb, 0]), Buffer.from([0xfb, 63]), Buffer.from([0xfb, 0x41]), Buffer.from([0xfb, 0x41, 255]), Buffer.from([0xfa, 252]), Buffer.from([0xf9, 1]), Buffer.alloc(1277)]) {
    assert.throws(() => inspectOggOpus(Buffer.concat([...opusHeaders(0), oggPage([packet], 960, 2, 4)])));
  }
  assert.throws(() => inspectOggOpus(Buffer.alloc(0)));
  assert.throws(() => inspectOggOpus(Buffer.alloc(16 * 1024 * 1024 + 1)));
});

test("OpusTags and audio packets can continue across pages with correct flags and unset granules", () => {
  const tags = Buffer.alloc(300); tags.write("OpusTags"); tags.writeUInt32LE(284, 8);
  const headers = [opusHeaders()[0], rawOggPage([255], tags.subarray(0, 255), BigInt("18446744073709551615"), 1), rawOggPage([45], tags.subarray(255), 0, 2, 1)];
  const audio = Buffer.alloc(300); audio[0] = 0xf8;
  const bytes = Buffer.concat([...headers, rawOggPage([255], audio.subarray(0, 255), BigInt("18446744073709551615"), 3), rawOggPage([45], audio.subarray(255), 960, 4, 5)]);
  assert.equal(inspectOggOpus(bytes).pages, 5);
  assert.throws(() => inspectOggOpus(patchOggPage(bytes, 3, p => p.writeBigUInt64LE(BigInt(0), 6))));
  assert.throws(() => inspectOggOpus(patchOggPage(bytes, 4, p => { p[5] = 4; })));
});

test("header signature bytes are exact and may not be masked to seven-bit ASCII", () => {
  for (const page of [0, 1, 2]) {
    assert.throws(() => inspectOggOpus(patchOggPage(syntheticOgg(), page, p => { p[0] |= 128; })));
  }
  assert.throws(() => inspectOggOpus(patchOggPage(syntheticOgg(), 0, p => { p[27 + p[26]] |= 128; })));
});

test("packet framing supports valid CBR, VBR, padding and Opus durations without assuming 20 ms", () => {
  for (const [packet, samples] of [[Buffer.from([0xf9, 0, 0]), 1920], [Buffer.from([0xfa, 1, 0, 0]), 1920],
    [Buffer.from([0xfb, 2, 0, 0]), 1920], [Buffer.from([0xfb, 0x82, 1, 0, 0]), 1920],
    [Buffer.from([0xfb, 0x41, 1, 0, 0]), 960], [Buffer.from([0x80]), 120], [Buffer.from([0x88]), 240],
    [Buffer.from([0x90]), 480], [Buffer.from([0x98]), 960], [Buffer.from([0x18]), 2880]] as const) {
    assert.equal(inspectOggOpus(Buffer.concat([...opusHeaders(0), oggPage([packet], samples, 2, 4)])).duration, samples / 48000);
  }
});

test("pre-skip can legitimately span an entire non-final page", () => {
  const packets = Array.from({ length: 50 }, () => opusSilence);
  const bytes = Buffer.concat([...opusHeaders(60000), oggPage(packets, 48000, 2), oggPage(packets, 96000, 3, 4)]);
  assert.equal(inspectOggOpus(bytes).duration, 0.75);
});

test("continued packets and tag counts are bounded before allocation or unbounded iteration", () => {
  const pages = [opusHeaders()[0]];
  const body = Buffer.alloc(255 * 255);
  for (let i = 0; i < 17; i++) pages.push(rawOggPage(Array.from({ length: 255 }, () => 255), body, BigInt("18446744073709551615"), i + 1, i ? 1 : 0));
  assert.throws(() => inspectOggOpus(Buffer.concat(pages)), (e: unknown) => e instanceof OggOpusIntegrityError && e.code === "PACKET_SIZE");
  const invalidTags = patchOggPage(syntheticOgg(), 1, p => p.writeUInt32LE(0xffffffff, 27 + p[26] + 12));
  assert.throws(() => inspectOggOpus(invalidTags), (e: unknown) => e instanceof OggOpusIntegrityError && e.code === "TAGS");
});

test("family 1 mono is valid input, never the normalized output profile", () => {
  const bytes = Buffer.concat([...mappedOpusHeaders(), oggPage([opusSilence], 960, 2, 4)]);
  assert.equal(inspectOggOpus(bytes).channels, 1);
  assert.throws(() => inspectOggOpus(bytes, { normalized: true }), (e: unknown) => e instanceof OggOpusIntegrityError && e.code === "NORMALIZED_PROFILE");
  const independent = spawnSync(process.env.OPUSDEC_PATH || "opusdec", ["--quiet", "-", "-"], { input: bytes, stdio: ["pipe", "ignore", "pipe"], timeout: 15000 });
  assert.equal(independent.error, undefined); assert.equal(independent.signal, null); assert.equal(independent.status, 0);
});

test("family 1 validates counts, complete mapping table and every index, including silence and duplicates", () => {
  const stream = (headers: Buffer[]) => Buffer.concat([...headers, oggPage([opusSilence], 960, 2, 4)]);
  for (const mapping of [[0, 0], [0, 255]]) assert.equal(inspectOggOpus(stream(mappedOpusHeaders(2, 1, 0, mapping))).channels, 2);
  for (const headers of [mappedOpusHeaders(0), mappedOpusHeaders(9), mappedOpusHeaders(1, 0),
    mappedOpusHeaders(1, 1, 2), mappedOpusHeaders(1, 255, 1), mappedOpusHeaders(1, 1, 0, [1])]) {
    assert.throws(() => inspectOggOpus(stream(headers)));
  }
  const head = Buffer.alloc(22); head.write("OpusHead"); head[8] = 1; head[9] = 1; head[18] = 1; head[19] = 1;
  for (const length of [19, 20, 21]) assert.throws(() => inspectOggOpus(stream([oggPage([head.subarray(0, length)], 0, 0, 2), opusHeaders()[1]])));
});

test("multistream framing counts duration once and handles self-delimited CBR, VBR and padding", () => {
  const stream = (packet: Buffer, samples: number) => Buffer.concat([...mappedOpusHeaders(2, 2, 0, [0, 1]), oggPage([packet], samples, 2, 4)]);
  const cases = [
    [Buffer.from([0xf8, 2, 0xff, 0xfe]), opusSilence, 960],
    [Buffer.from([0xf9, 1, 0, 0]), Buffer.from([0xf9, 0, 0]), 1920],
    [Buffer.from([0xfa, 1, 1, 0, 0]), Buffer.from([0xfa, 1, 0, 0]), 1920],
    [Buffer.from([0xfb, 2, 1, 0, 0]), Buffer.from([0xfb, 2, 0, 0]), 1920],
    [Buffer.from([0xfb, 0x82, 1, 1, 0, 0]), Buffer.from([0xfb, 0x82, 1, 0, 0]), 1920],
    [Buffer.from([0xfb, 0x41, 1, 1, 0, 0]), opusSilence, 960],
    [Buffer.from([0x80, 0]), Buffer.from([0x80]), 120]
  ] as const;
  for (const [first, last, samples] of cases) {
    // Use zero pre-skip for the 2.5 ms packet.
    const bytes = patchOggPage(stream(Buffer.concat([first, last]), samples), 0, p => p.writeUInt16LE(0, 27 + p[26] + 10));
    assert.equal(inspectOggOpus(bytes).duration, samples / 48000);
  }
  for (const packet of [Buffer.from([0xf8, 252]), Buffer.from([0xf8, 255, 255]),
    Buffer.concat([Buffer.from([0xf8, 2, 0xff, 0xfe]), Buffer.from([0x80])]),
    Buffer.from([0xfb, 0x41, 255]), Buffer.from([0xfa, 2, 2, 0])]) {
    assert.throws(() => inspectOggOpus(stream(packet, 960)));
  }
  const valid = stream(Buffer.concat([Buffer.from([0xf8, 2, 0xff, 0xfe]), opusSilence]), 960);
  const independent = spawnSync(process.env.OPUSDEC_PATH || "opusdec", ["--quiet", "-", "-"], { input: valid, stdio: ["pipe", "ignore", "pipe"], timeout: 15000 });
  assert.equal(independent.error, undefined); assert.equal(independent.signal, null); assert.equal(independent.status, 0);
});

const unset = BigInt("18446744073709551615");
const emptyPage = (sequence: number, flags = 0) => rawOggPage([], Buffer.alloc(0), unset, sequence, flags);

function assertNativeAcceptance(bytes: Buffer) {
  for (const [tool, args] of [[process.env.OPUSDEC_PATH || "opusdec", ["--quiet", "-", "-"]],
    [process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-xerror", "-f", "ogg", "-i", "pipe:0", "-f", "null", "-"]]] as const) {
    const result = spawnSync(tool, Array.from(args), { input: bytes, stdio: ["pipe", "ignore", "pipe"], timeout: 15000 });
    assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 0);
    assert.equal(result.stderr.toString().trim(), "");
  }
}

test("empty pages before and between data, and an empty EOS after data, preserve samples", () => {
  const headers = opusHeaders();
  const cases = [
    Buffer.concat([...headers, emptyPage(2), oggPage([opusSilence], 960, 3, 4)]),
    Buffer.concat([...headers, oggPage([opusSilence], 960, 2), emptyPage(3), oggPage([opusSilence], 1600, 4, 4)]),
    Buffer.concat([...headers, oggPage([opusSilence], 960, 2), emptyPage(3), emptyPage(4, 4)]),
    Buffer.concat([headers[0], emptyPage(1), oggPage([Buffer.concat([Buffer.from("OpusTags"), Buffer.alloc(8)])], 0, 2), oggPage([opusSilence], 960, 3, 4)]),
    Buffer.concat([...headers, oggPage([opusSilence], 960, 2), rawOggPage([], Buffer.alloc(0), 960, 3, 4)])
  ];
  for (const [index, bytes] of Array.from(cases.entries())) {
    assert.equal(inspectOggOpus(bytes).duration, ((index === 1 ? 1600 : 960) - 312) / 48000);
    assert.throws(() => inspectOggOpus(bytes, { normalized: true }));
    assertNativeAcceptance(bytes);
  }
});

test("empty page cannot bypass BOS, CRC, serial, sequence, granule, flags, EOS or EOF", () => {
  const headers = opusHeaders(), good = Buffer.concat([...headers, emptyPage(2), oggPage([opusSilence], 960, 3, 4)]);
  const corrupt = Buffer.from(good); corrupt[headers[0].length + headers[1].length + 22] ^= 1;
  for (const invalid of [corrupt,
    patchOggPage(good, 2, p => p.writeBigUInt64LE(BigInt(0), 6)),
    patchOggPage(good, 2, p => { p[5] = 1; }), patchOggPage(good, 2, p => { p[5] = 2; }),
    patchOggPage(good, 2, p => { p[5] = 8; }), patchOggPage(good, 2, p => p.writeUInt32LE(9, 18)),
    patchOggPage(good, 2, p => p.writeUInt32LE(9, 14)), patchOggPage(good, 2, p => { p[26] = 1; }),
    Buffer.concat([emptyPage(0, 2), ...headers]),
    Buffer.concat([...headers, emptyPage(2, 4)]),
    Buffer.concat([...headers, oggPage([opusSilence], 960, 2), rawOggPage([], Buffer.alloc(0), 959, 3, 4)]),
    Buffer.concat([...headers, oggPage([opusSilence], 960, 2), rawOggPage([], Buffer.alloc(0), 961, 3, 4)]),
    Buffer.concat([...headers, oggPage([opusSilence], 960, 2), emptyPage(3)]),
    Buffer.concat([...headers, oggPage([opusSilence], 960, 2, 4), emptyPage(3)]),
    Buffer.concat([...headers, emptyPage(2), oggPage([Buffer.alloc(0)], 960, 3, 4)])]) {
    assert.throws(() => inspectOggOpus(invalid));
  }
});

test("empty pages do not terminate or discard a continued packet", () => {
  const packet = Buffer.concat([Buffer.from([0xfb, 0x41, 255, 44, 255, 254]), Buffer.alloc(298)]);
  for (const flags of [0, 1]) {
    const bytes = Buffer.concat([...opusHeaders(), rawOggPage([255], packet.subarray(0, 255), unset, 2),
      emptyPage(3, flags), rawOggPage([packet.length - 255], packet.subarray(255), 960, 4, 5)]);
    assert.equal(inspectOggOpus(bytes).duration, (960 - 312) / 48000); assertNativeAcceptance(bytes);
    assert.throws(() => inspectOggOpus(patchOggPage(bytes, 4, p => { p[5] = 4; })));
    assert.throws(() => inspectOggOpus(Buffer.concat([...opusHeaders(), rawOggPage([255], packet.subarray(0, 255), unset, 2), emptyPage(3, 4)])));
  }
});

test("compatible OpusHead minor versions and future extensions are input only", () => {
  for (const family of [0, 1] as const) {
    for (const version of [0, 1, 2, 15]) {
      for (const extra of version > 1 ? [Buffer.alloc(0), Buffer.from([9, 8, 7])] : [Buffer.alloc(0)]) {
        const bytes = Buffer.concat([...versionedOpusHeaders(version, family, extra), oggPage([opusSilence], 960, 2, 4)]);
        assert.equal(inspectOggOpus(bytes).channels, 1); assertNativeAcceptance(bytes);
        if (version !== 1 || family !== 0) assert.throws(() => inspectOggOpus(bytes, { normalized: true }));
      }
    }
  }
});

test("incompatible major, truncated headers, invalid mandatory fields and v1 extensions fail closed", () => {
  const finish = (headers: Buffer[]) => Buffer.concat([...headers, oggPage([opusSilence], 960, 2, 4)]);
  for (const version of [16, 17, 31, 255]) assert.throws(() => inspectOggOpus(finish(versionedOpusHeaders(version))));
  for (const family of [0, 1] as const) {
    assert.throws(() => inspectOggOpus(finish(versionedOpusHeaders(1, family, Buffer.from([0])))));
    const headers = versionedOpusHeaders(2, family), head = headers[0].subarray(28);
    for (const length of [0, 8, 18, head.length - 1]) {
      assert.throws(() => inspectOggOpus(finish([oggPage([head.subarray(0, length)], 0, 0, 2), headers[1]])));
    }
    const bytes = finish(headers);
    for (const [position, value] of [[9, 0], [18, 2], ...(family ? [[19, 0], [20, 2], [21, 1]] : [[9, 3]])]) {
      assert.throws(() => inspectOggOpus(patchOggPage(bytes, 0, p => { p[28 + position] = value; })));
    }
  }
});
