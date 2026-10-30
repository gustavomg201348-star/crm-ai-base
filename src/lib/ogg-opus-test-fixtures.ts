// Synthetic silence only; no customer recordings belong in fixtures.
export const opusSilence = Buffer.from([0xf8, 0xff, 0xfe]);

export function fixtureChecksum(bytes: Buffer) {
  let crc = 0;
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc ^ ((i >= 22 && i < 26 ? 0 : bytes[i]) << 24)) >>> 0;
    for (let bit = 0; bit < 8; bit++) crc = ((crc << 1) ^ (crc & 0x80000000 ? 0x04c11db7 : 0)) >>> 0;
  }
  return crc;
}

export function oggPage(packets: Buffer[], granule: number | bigint, sequence: number, flags = 0) {
  const lacing: number[] = [];
  for (const packet of packets) {
    let remaining = packet.length;
    while (remaining >= 255) { lacing.push(255); remaining -= 255; }
    lacing.push(remaining);
  }
  return rawOggPage(lacing, Buffer.concat(packets), granule, sequence, flags);
}

export function rawOggPage(lacing: number[], body: Buffer, granule: number | bigint, sequence: number, flags = 0) {
  const bytes = Buffer.alloc(27 + lacing.length + body.length);
  bytes.write("OggS"); bytes[5] = flags; bytes.writeBigUInt64LE(BigInt(granule), 6);
  bytes.writeUInt32LE(7, 14); bytes.writeUInt32LE(sequence, 18); bytes[26] = lacing.length;
  Buffer.from(lacing).copy(bytes, 27); body.copy(bytes, 27 + lacing.length);
  bytes.writeUInt32LE(fixtureChecksum(bytes), 22);
  return bytes;
}

export function opusHeaders(preSkip = 312, channels = 1) {
  const head = Buffer.alloc(19); head.write("OpusHead"); head[8] = 1; head[9] = channels;
  head.writeUInt16LE(preSkip, 10); head.writeUInt32LE(48000, 12);
  const tags = Buffer.alloc(16); tags.write("OpusTags");
  return [oggPage([head], 0, 0, 2), oggPage([tags], 0, 1)];
}

export function mappedOpusHeaders(channels = 1, streams = 1, coupled = 0, mapping = [0]) {
  const head = Buffer.alloc(21 + channels); head.write("OpusHead"); head[8] = 1; head[9] = channels;
  head.writeUInt16LE(312, 10); head.writeUInt32LE(48000, 12);
  head[18] = 1; head[19] = streams; head[20] = coupled;
  Buffer.from(mapping).copy(head, 21);
  return [oggPage([head], 0, 0, 2), opusHeaders()[1]];
}

export function versionedOpusHeaders(version: number, family: 0 | 1 = 0, extra = Buffer.alloc(0)) {
  const headers = family === 1 ? mappedOpusHeaders() : opusHeaders();
  const head = Buffer.concat([headers[0].subarray(28), extra]); head[8] = version;
  return [oggPage([head], 0, 0, 2), headers[1]];
}

export function syntheticOgg(preSkip = 312, firstGranule = 48000) {
  return Buffer.concat([...opusHeaders(preSkip), oggPage(Array.from({ length: 50 }, () => opusSilence), firstGranule, 2), oggPage([opusSilence], firstGranule + 312, 3, 4)]);
}

export function patchOggPage(input: Buffer, sequence: number, change: (page: Buffer) => void) {
  const bytes = Buffer.from(input);
  let offset = 0;
  for (let index = 0; offset < bytes.length; index++) {
    const count = bytes[offset + 26];
    let size = 27 + count;
    for (let i = 0; i < count; i++) size += bytes[offset + 27 + i];
    if (index === sequence) {
      const page = bytes.subarray(offset, offset + size); change(page); page.writeUInt32LE(fixtureChecksum(page), 22);
      return bytes;
    }
    offset += size;
  }
  throw new Error("Synthetic page not found");
}
