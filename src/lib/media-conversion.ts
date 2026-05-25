import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ffmpegCommand = process.env.FFMPEG_PATH || "ffmpeg";

export type ConvertedMedia = {
  bytes: Buffer;
  fileName: string;
  mimeType: string;
};

export async function convertWebmAudioToOgg({
  bytes,
  fileName
}: {
  bytes: Buffer;
  fileName: string;
}): Promise<ConvertedMedia> {
  const workdir = await mkdtemp(join(tmpdir(), "crm-audio-"));
  const inputPath = join(workdir, "input.webm");
  const outputPath = join(workdir, "output.ogg");

  try {
    await writeFile(inputPath, bytes);
    await execFileAsync(
      ffmpegCommand,
      [
        "-y",
        "-i",
        inputPath,
        "-vn",
        "-acodec",
        "libopus",
        "-b:a",
        "32k",
        outputPath
      ],
      { timeout: 60000 }
    );

    return {
      bytes: await readFile(outputPath),
      fileName: fileName.replace(/\.[^.]+$/, "") + ".ogg",
      mimeType: "audio/ogg"
    };
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}
