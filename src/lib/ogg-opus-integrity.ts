const maxBytes = 16 * 1024 * 1024;
const maxPacketBytes = 1024 * 1024;
const unsetGranule = BigInt("18446744073709551615");
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let value = (i << 24) >>> 0;
  for (let bit = 0; bit < 8; bit++) value = ((value << 1) ^ (value & 0x80000000 ? 0x04c11db7 : 0)) >>> 0;
  crcTable[i] = value;
}

export class OggOpusIntegrityError extends Error {
  constructor(readonly code: string) { super("Audio Ogg/Opus estruturalmente invalido."); this.name = "OggOpusIntegrityError"; }
}

function requireCondition(value: unknown, code: string): asserts value {
  if (!value) throw new OggOpusIntegrityError(code);
}

function parseOpusPacket(packet: Buffer, selfDelimited: boolean) {
  requireCondition(packet.length > 0, "EMPTY_PACKET");
  const configuration = packet[0] >>> 3;
  const code = packet[0] & 3;
  const frameSamples = configuration >= 16 ? 120 * (1 << (configuration & 3))
    : configuration >= 12 ? 480 * (1 << (configuration & 1)) : [480, 960, 1920, 2880][configuration & 3];
  let cursor = 1;
  let end = packet.length;
  let count = code === 0 ? 1 : 2;
  let variable = code === 2;
  function frameLength() {
    requireCondition(cursor < end, "PACKET_FRAMING");
    const first = packet[cursor++];
    if (first < 252) return first;
    requireCondition(cursor < end, "PACKET_FRAMING");
    return first + 4 * packet[cursor++];
  }
  if (code === 3) {
    requireCondition(cursor < end, "PACKET_FRAMING");
    const flags = packet[cursor++];
    count = flags & 63;
    variable = Boolean(flags & 128);
    if (flags & 64) {
      let padding = 0;
      let byte: number;
      do {
        requireCondition(cursor < end, "PACKET_PADDING");
        byte = packet[cursor++]; padding += byte === 255 ? 254 : byte;
      } while (byte === 255);
      end -= padding;
      requireCondition(end >= cursor, "PACKET_PADDING");
    }
  }
  requireCondition(count > 0 && count <= 48 && count * frameSamples <= 5760, "PACKET_DURATION");
  let payloadBytes: number;
  if (variable) {
    let used = 0;
    for (let i = 1; i < count; i++) { const length = frameLength(); requireCondition(length <= 1275, "FRAME_SIZE"); used += length; }
    const last = selfDelimited ? frameLength() : end - cursor - used;
    requireCondition(last >= 0 && last <= 1275 && used + last <= end - cursor, "FRAME_SIZE");
    payloadBytes = used + last;
  } else {
    const size = selfDelimited ? frameLength() : (end - cursor) / count;
    requireCondition(Number.isInteger(size) && size <= 1275 && size * count <= end - cursor, "FRAME_SIZE");
    payloadBytes = size * count;
  }
  return { samples: count * frameSamples, consumed: cursor + payloadBytes + packet.length - end };
}

function packetSamples(packet: Buffer, streams: number) {
  let cursor = 0, samples = 0;
  // RFC 7845 section 3: N-1 self-delimited packets, then one regular packet.
  for (let stream = 0; stream < streams; stream++) {
    const parsed = parseOpusPacket(packet.subarray(cursor), stream < streams - 1);
    requireCondition(stream === 0 || parsed.samples === samples, "STREAM_DURATION");
    samples = parsed.samples; cursor += parsed.consumed;
  }
  requireCondition(cursor === packet.length, "PACKET_FRAMING");
  return samples;
}

function validateHead(packet: Buffer, normalized: boolean) {
  requireCondition(packet.length >= 19 && packet.toString("latin1", 0, 8) === "OpusHead" && packet[8] <= 15, "HEAD");
  const version = packet[8], channels = packet[9], mappingFamily = packet[18];
  // Compatible future minor versions may append fields, never omit known fields.
  const validLength = (minimum: number) => version > 1 ? packet.length >= minimum : packet.length === minimum;
  let streams = 1;
  if (mappingFamily === 0) {
    requireCondition(validLength(19) && (channels === 1 || channels === 2), "CHANNELS");
  } else {
    requireCondition(mappingFamily === 1 && channels >= 1 && channels <= 8 && validLength(21 + channels), "CHANNEL_MAPPING");
    streams = packet[19];
    const coupled = packet[20];
    requireCondition(streams > 0 && coupled <= streams && streams + coupled <= 255, "CHANNEL_MAPPING");
    for (let channel = 0; channel < channels; channel++) {
      const index = packet[21 + channel];
      requireCondition(index === 255 || index < streams + coupled, "CHANNEL_MAPPING");
    }
  }
  const preSkip = packet.readUInt16LE(10), inputSampleRate = packet.readUInt32LE(12);
  requireCondition(!normalized || (version === 1 && mappingFamily === 0 && channels === 1 && inputSampleRate === 48000), "NORMALIZED_PROFILE");
  return { channels, streams, preSkip, inputSampleRate };
}

function validateTags(packet: Buffer) {
  requireCondition(packet.length >= 16 && packet.toString("latin1", 0, 8) === "OpusTags", "TAGS");
  let cursor = 12 + packet.readUInt32LE(8);
  requireCondition(cursor <= packet.length - 4, "TAGS");
  const count = packet.readUInt32LE(cursor); cursor += 4;
  requireCondition(count <= Math.floor((packet.length - cursor) / 4), "TAGS");
  for (let i = 0; i < count; i++) {
    requireCondition(cursor <= packet.length - 4, "TAGS");
    const length = packet.readUInt32LE(cursor); cursor += 4 + length;
    requireCondition(cursor <= packet.length, "TAGS");
  }
}

/** Bounded families 0/1 input; normalized output is strictly family 0 mono. Native decoding remains mandatory. */
export function inspectOggOpus(bytes: Buffer, { normalized = false }: { normalized?: boolean } = {}) {
  requireCondition(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= maxBytes, "SIZE");
  let offset = 0, sequence = 0, serial: number | undefined, packetNumber = 0;
  let pendingBytes = 0, pieces: Buffer[] = [];
  let channels = 0, streams = 0, preSkip = 0, inputSampleRate = 0;
  let previousGranule: number | undefined, initialOffset = 0, eosSeen = false;
  while (offset < bytes.length) {
    requireCondition(!eosSeen && bytes.length - offset >= 27, "PAGE_BOUNDARY");
    requireCondition(bytes.toString("latin1", offset, offset + 4) === "OggS" && bytes[offset + 4] === 0, "PAGE_HEADER");
    const flags = bytes[offset + 5], segments = bytes[offset + 26];
    requireCondition((flags & ~7) === 0 && (!normalized || segments > 0) && offset + 27 + segments <= bytes.length, "PAGE_HEADER");
    const pageSerial = bytes.readUInt32LE(offset + 14);
    requireCondition(bytes.readUInt32LE(offset + 18) === sequence && (serial === undefined || serial === pageSerial), "STREAM_SEQUENCE");
    requireCondition(Boolean(flags & 2) === (sequence === 0) && (segments > 0
      ? Boolean(flags & 1) === (pendingBytes > 0) : !(flags & 1) || pendingBytes > 0), "PAGE_FLAGS");
    serial = pageSerial;
    let end = offset + 27 + segments;
    for (let i = 0; i < segments; i++) end += bytes[offset + 27 + i];
    requireCondition(end <= bytes.length, "TRUNCATED_PAGE");
    let crc = 0;
    for (let i = offset; i < end; i++) {
      const byte = i >= offset + 22 && i < offset + 26 ? 0 : bytes[i];
      crc = ((crc << 8) ^ crcTable[((crc >>> 24) ^ byte) & 255]) >>> 0;
    }
    requireCondition(crc === bytes.readUInt32LE(offset + 22), "CRC");
    const encodedGranule = bytes.readBigUInt64LE(offset + 6);
    requireCondition(encodedGranule === unsetGranule || encodedGranule <= BigInt(Number.MAX_SAFE_INTEGER), "GRANULE_RANGE");
    const granule = encodedGranule === unsetGranule ? -1 : Number(encodedGranule);
    if (segments === 0) {
      requireCondition(packetNumber > 0 && (granule === -1 || Boolean(flags & 4) && granule === previousGranule), "EMPTY_PAGE");
      // No packet or sample completes here. Preserve pending data and the last audio granule.
      if (flags & 4) {
        requireCondition(pendingBytes === 0 && previousGranule !== undefined && end === bytes.length && previousGranule - initialOffset > preSkip, "EOS");
        eosSeen = true;
      }
      offset = end; sequence++;
      continue;
    }
    let cursor = offset + 27 + segments, completed = 0, audioPackets = 0, pageSamples = 0;
    for (let i = 0; i < segments; i++) {
      const size = bytes[offset + 27 + i];
      pendingBytes += size;
      requireCondition(pendingBytes <= maxPacketBytes, "PACKET_SIZE");
      pieces.push(bytes.subarray(cursor, cursor + size)); cursor += size;
      if (size === 255) continue;
      const packet = pieces.length === 1 ? pieces[0] : Buffer.concat(pieces, pendingBytes);
      pieces = []; pendingBytes = 0; completed++;
      if (packetNumber === 0) {
        requireCondition(sequence === 0 && i === segments - 1, "HEAD");
        ({ channels, streams, preSkip, inputSampleRate } = validateHead(packet, normalized));
      } else if (packetNumber === 1) {
        validateTags(packet);
        requireCondition(i === segments - 1, "HEADER_PAGE");
      } else { pageSamples += packetSamples(packet, streams); audioPackets++; }
      packetNumber++;
    }
    if (audioPackets) {
      requireCondition(granule >= 0, "AUDIO_GRANULE");
      if (previousGranule === undefined) {
        requireCondition(Boolean(flags & 4) || granule >= pageSamples, "INITIAL_GRANULE");
        initialOffset = Math.max(0, granule - pageSamples);
        requireCondition(!normalized || initialOffset === 0, "NORMALIZED_TIMELINE");
      } else {
        const expected = previousGranule + pageSamples;
        requireCondition(Number.isSafeInteger(expected) && (flags & 4 ? granule >= previousGranule && granule <= expected : granule === expected), "PAGE_GRANULE");
      }
      previousGranule = granule;
    } else requireCondition(granule === (completed ? 0 : -1), "HEADER_GRANULE");
    if (flags & 4) {
      requireCondition(audioPackets > 0 && pendingBytes === 0 && end === bytes.length && granule - initialOffset > preSkip, "EOS");
      eosSeen = true;
    }
    offset = end; sequence++;
  }
  requireCondition(eosSeen && packetNumber >= 3 && pendingBytes === 0 && previousGranule !== undefined, "INCOMPLETE_STREAM");
  return { channels, preSkip, inputSampleRate, pages: sequence, duration: (previousGranule - initialOffset - preSkip) / 48000 };
}
