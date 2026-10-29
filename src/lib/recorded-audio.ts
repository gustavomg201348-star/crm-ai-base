export const audioFormats = {
  "audio/webm": { extension: "webm", extensions: ["webm"], format: "webm", codecs: ["opus", "vorbis"] },
  "audio/ogg": { extension: "ogg", extensions: ["ogg", "opus"], format: "ogg", codecs: ["opus", "vorbis"] },
  "audio/mp4": { extension: "m4a", extensions: ["m4a", "mp4"], format: "mp4", codecs: ["aac"] },
  "audio/aac": { extension: "aac", extensions: ["aac"], format: "aac", codecs: ["aac"] },
  "audio/mpeg": { extension: "mp3", extensions: ["mp3"], format: "mp3", codecs: ["mp3"] },
  "audio/amr": { extension: "amr", extensions: ["amr"], format: "amr", codecs: ["amr_nb", "amr_wb"] }
} as const;

export type SupportedAudioMime = keyof typeof audioFormats;

export function supportedAudioMime(value: string): SupportedAudioMime | null {
  const base = value.split(";")[0].trim().toLowerCase();
  return Object.hasOwn(audioFormats, base) ? base as SupportedAudioMime : null;
}

export const preferredRecordingMimeTypes = [
  "audio/ogg;codecs=opus", "audio/webm;codecs=opus", "audio/webm",
  "audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/aac", "audio/mpeg", "audio/amr"
];

export function createRecordedAudioFile(chunks: Blob[], recorderMime: string, name: string): File {
  const nonempty = chunks.filter(chunk => chunk.size > 0);
  const declared = recorderMime || nonempty.find(chunk => chunk.type)?.type || "";
  const mime = supportedAudioMime(declared);
  if (!nonempty.length || !mime || nonempty.some(chunk => chunk.type && supportedAudioMime(chunk.type) !== mime)) {
    throw new Error("Formato de gravacao indisponivel. Grave novamente em um navegador compativel.");
  }
  // These are browser hints only; the server independently inspects the bytes.
  return new File(nonempty, `${name}.${audioFormats[mime].extension}`, { type: declared });
}
