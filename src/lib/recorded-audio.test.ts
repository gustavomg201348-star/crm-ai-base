import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { audioFormats, createRecordedAudioFile, preferredRecordingMimeTypes } from "./recorded-audio";

test("realistic MediaRecorder fallback without Ogg/WebM selects MP4 and keeps its MIME/extension", () => {
  const isTypeSupported = (mime: string) => mime === "audio/mp4";
  const preferred = preferredRecordingMimeTypes.find(isTypeSupported);
  assert.equal(preferred, "audio/mp4");
  const file = createRecordedAudioFile([new Blob(["synthetic"], { type: "audio/mp4" })], preferred!, "audio-test");
  assert.equal(file.type, "audio/mp4");
  assert.equal(file.name, "audio-test.m4a");
});

test("browser default can be resolved from the actual emitted chunks", () => {
  const file = createRecordedAudioFile([new Blob(["synthetic"], { type: "audio/mp4;codecs=mp4a.40.2" })], "", "audio-test");
  assert.equal(file.type, "audio/mp4;codecs=mp4a.40.2");
  assert.equal(file.name, "audio-test.m4a");
});

for (const [mime, format] of Object.entries(audioFormats)) {
  test(`matching extension for supported recording ${mime}`, () => {
    assert.equal(createRecordedAudioFile([new Blob(["synthetic"], { type: mime })], mime, "audio-test").name, `audio-test.${format.extension}`);
  });
}

test("unknown, missing, empty or contradictory browser types fail instead of pretending WebM", () => {
  for (const [chunks, mime] of [
    [[], "audio/mp4"], [[new Blob([])], "audio/mp4"], [[new Blob(["x"])], ""],
    [[new Blob(["x"], { type: "audio/wav" })], "audio/wav"],
    [[new Blob(["x"], { type: "audio/ogg" })], "audio/mp4"]
  ] as Array<[Blob[], string]>) assert.throws(() => createRecordedAudioFile(chunks, mime, "audio-test"));
});

test("composer marks only its recorded preview; authenticated route forwards no external scope", () => {
  const page = readFileSync("src/app/page.tsx", "utf8");
  assert.ok(page.includes("sendMediaPreview(audioPreview, undefined, true)"));
  assert.ok(page.includes('formData.set("recordedAudio", "true")'));
  assert.ok(page.includes("createRecordedAudioFile(audioChunksRef.current, recorder.mimeType"));
  const route = readFileSync("src/app/api/conversations/[id]/messages/media/route.ts", "utf8");
  assert.ok(route.includes('recordedAudio: formData.get("recordedAudio") === "true"'));
  assert.ok(route.includes("companyId: session.companyId"));
  assert.ok(route.indexOf("await resolveConversationAccess") < route.indexOf("request.formData()"));
});
