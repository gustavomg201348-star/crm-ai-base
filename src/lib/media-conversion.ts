import { execFile } from "node:child_process";
import { mkdtemp, open, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { audioFormats, supportedAudioMime, type SupportedAudioMime } from "./recorded-audio";
import { inspectOggOpus } from "./ogg-opus-integrity";

const execFileAsync = promisify(execFile);
export const maxAudioBytes = 16 * 1024 * 1024;
// The existing 180-second display can stop on its next interval; allow codec padding too.
export const maxRecordedAudioSeconds = 182;
let activePreparations = 0;

export class AudioPreparationError extends Error {
  constructor() {
    super("Nao foi possivel validar ou converter o audio. Grave novamente e tente enviar.");
    this.name = "AudioPreparationError";
  }
}

export type ConvertedMedia = {
  bytes: Buffer;
  fileName: string;
  mimeType: string;
};

type AudioProbe = {
  streams: Array<{ codec_type?: string; codec_name?: string; channels?: number }>;
  format: { format_name?: string; duration?: string };
};

async function runAudioTool(command: string, args: string[], deadline: number, timeout = 60000) {
  const remaining = deadline - performance.now();
  if (remaining <= 0) throw new AudioPreparationError();
  return execFileAsync(command, args, {
    timeout: Math.max(1, Math.min(timeout, Math.ceil(remaining))), maxBuffer: 1024 * 1024,
    killSignal: "SIGKILL", windowsHide: true
  });
}

async function probeAudio(file: string, deadline: number, format: string): Promise<AudioProbe> {
  const { stdout, stderr } = await runAudioTool(process.env.FFPROBE_PATH || "ffprobe", [
    "-v", "error", "-max_alloc", "67108864", "-protocol_whitelist", "file,pipe",
    "-probesize", "1048576", "-analyzeduration", "5000000", "-f", format,
    "-show_streams", "-show_format", "-of", "json", file
  ], deadline, 15000);
  if (stderr.trim()) throw new AudioPreparationError();
  const probe = JSON.parse(stdout) as AudioProbe;
  if (!Array.isArray(probe.streams) || probe.streams.length !== 1 ||
      probe.streams[0].codec_type !== "audio" || !probe.streams[0].codec_name ||
      !Number.isInteger(probe.streams[0].channels) || probe.streams[0].channels! < 1 ||
      !probe.format?.format_name) {
    throw new AudioPreparationError();
  }
  return probe;
}

async function assertFileSize(file: string) {
  const size = (await stat(file)).size;
  if (!Number.isSafeInteger(size) || size <= 0 || size > maxAudioBytes) throw new AudioPreparationError();
}

async function readBoundedAudio(file: string): Promise<Buffer> {
  await assertFileSize(file);
  const handle = await open(file, "r");
  try {
    const size = (await handle.stat()).size;
    if (!Number.isSafeInteger(size) || size <= 0 || size > maxAudioBytes) throw new AudioPreparationError();
    const bytes = Buffer.alloc(size);
    let offset = 0;
    while (offset < size) {
      const { bytesRead } = await handle.read(bytes, offset, size - offset, offset);
      if (!bytesRead) throw new AudioPreparationError();
      offset += bytesRead;
    }
    const extra = await handle.read(Buffer.alloc(1), 0, 1, size);
    if (extra.bytesRead || (await handle.stat()).size !== size) throw new AudioPreparationError();
    return bytes;
  } finally { await handle.close(); }
}

export async function prepareRecordedAudioForWhatsApp({
  bytes,
  fileName,
  mimeType,
  recordedAudio = false,
  normalize = true
}: {
  bytes: Buffer;
  fileName: string;
  mimeType: SupportedAudioMime;
  recordedAudio?: boolean;
  normalize?: boolean;
}): Promise<ConvertedMedia> {
  if (!Buffer.isBuffer(bytes) || bytes.byteLength === 0 || bytes.byteLength > maxAudioBytes ||
      !supportedAudioMime(mimeType) || activePreparations >= 2) {
    throw new AudioPreparationError();
  }
  normalize = recordedAudio || normalize;
  const expected = audioFormats[mimeType];
  const extension = fileName.split(".").pop()?.toLowerCase() || "";
  if (!normalize && !(expected.extensions as readonly string[]).includes(extension)) throw new AudioPreparationError();
  activePreparations++;
  const deadline = performance.now() + 60000;
  let workdir: string | undefined;

  try {
    workdir = await mkdtemp(join(tmpdir(), "crm-audio-"));
    const inputPath = join(workdir, `input.${expected.extension}`);
    const outputPath = join(workdir, "output.ogg");
    await writeFile(inputPath, bytes);
    const input = await probeAudio(inputPath, deadline, expected.format);
    const formats = input.format.format_name!.split(",");
    const inputDuration = Number(input.format.duration);
    if (expected.format === "ogg" && input.streams[0].codec_name === "opus") inspectOggOpus(bytes);
    if (!formats.includes(expected.format) || !(expected.codecs as readonly string[]).includes(input.streams[0].codec_name!) ||
        (recordedAudio && Number.isFinite(inputDuration) && inputDuration > maxRecordedAudioSeconds)) {
      throw new AudioPreparationError();
    }
    const validatedInput = await runAudioTool(process.env.FFMPEG_PATH || "ffmpeg", [
      "-v", "error", "-nostdin", "-max_alloc", "67108864", "-threads", "1", "-filter_threads", "1",
      "-xerror", "-err_detect", "explode", "-protocol_whitelist", "file,pipe", "-f", expected.format,
      "-i", inputPath, "-map", "0:a:0",
      ...(recordedAudio ? ["-t", String(maxRecordedAudioSeconds + 1)] : []),
      "-progress", "pipe:1", "-f", "null", "-"
    ], deadline);
    const decodedTimes = Array.from(validatedInput.stdout.matchAll(/^out_time_us=(\d+)$/gm), match => Number(match[1]));
    const decodedSeconds = Math.max(0, ...decodedTimes) / 1000000;
    if (validatedInput.stderr.trim() || !Number.isFinite(decodedSeconds) || decodedSeconds <= 0 ||
        (recordedAudio && decodedSeconds > maxRecordedAudioSeconds)) throw new AudioPreparationError();
    if (!normalize) return { bytes, fileName, mimeType };
    const encoded = await runAudioTool(
      process.env.FFMPEG_PATH || "ffmpeg",
      [
        "-v", "error", "-nostdin", "-y", "-max_alloc", "67108864", "-threads", "1", "-filter_threads", "1",
        "-xerror", "-err_detect", "explode", "-protocol_whitelist", "file,pipe", "-f", expected.format, "-i", inputPath,
        "-map", "0:a:0", "-vn", "-map_metadata", "-1",
        "-af", "aresample=48000,asettb=1/48000,asetpts=N/SR/TB",
        "-acodec", "libopus", "-ac", "1", "-ar", "48000", "-b:a", "32k", "-threads", "1",
        // Stop disk growth above the accepted ceiling; never accept this truncated output.
        "-fs", String(maxAudioBytes + 1024 * 1024),
        ...(recordedAudio ? ["-t", String(maxRecordedAudioSeconds + 1)] : []), "-f", "ogg",
        outputPath
      ],
      deadline
    );
    if (encoded.stderr.trim()) throw new AudioPreparationError();

    await assertFileSize(outputPath);
    const output = await probeAudio(outputPath, deadline, "ogg");
    const duration = Number(output.format.duration);
    if (output.format.format_name !== "ogg" || output.streams[0].codec_name !== "opus" ||
        output.streams[0].channels !== 1 || !Number.isFinite(duration) || duration <= 0 ||
        (recordedAudio && duration > maxRecordedAudioSeconds)) {
      throw new AudioPreparationError();
    }
    // Decode the complete output, not just its header, before it can reach Meta.
    const decoded = await runAudioTool(process.env.FFMPEG_PATH || "ffmpeg", [
      "-v", "error", "-nostdin", "-max_alloc", "67108864", "-threads", "1", "-filter_threads", "1",
      "-xerror", "-err_detect", "explode", "-protocol_whitelist", "file,pipe", "-f", "ogg",
      "-i", outputPath, "-map", "0:a:0", "-f", "null", "-"
    ], deadline);
    if (decoded.stderr.trim()) throw new AudioPreparationError();
    const converted = await readBoundedAudio(outputPath);
    inspectOggOpus(converted, { normalized: true });
    if (performance.now() > deadline) throw new AudioPreparationError();
    return {
      bytes: converted,
      fileName: fileName.replace(/\.[^.]+$/, "") + ".ogg",
      mimeType: "audio/ogg"
    };
  } catch {
    // Native errors may contain paths or input metadata; expose only a safe error.
    throw new AudioPreparationError();
  } finally {
    try { if (workdir) await rm(workdir, { recursive: true, force: true }); }
    finally { activePreparations--; }
  }
}
