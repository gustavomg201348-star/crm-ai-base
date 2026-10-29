# Recorded WhatsApp audio compatibility

## Evidence and limits

Base: `0213c1a134c101d3f8aeb1e292916736b1e3d109`.

The official Meta audio message documentation, checked on 2026-10-28, requires
Ogg audio to contain Opus and mono input, with a 16 MB limit:
https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/audio-messages.md

Independent synthetic reproduction with FFmpeg/FFprobe 5.1.9:

- The previous converter preserved two channels when given stereo WebM/Opus.
  The resulting Ogg/Opus had two channels, contrary to Meta's requirement.
- The previous service forwarded Ogg/Vorbis, corrupted bytes and empty Ogg input
  without inspecting them. A simulated Meta acceptance then resulted in normal
  success persistence. This proves the validation gap, not actual Meta acceptance
  or a successful/failed playback on a real recipient device.
- The browser requests `audio: true`, without guaranteeing mono, prefers Ogg or
  WebM, and previews the original Blob. Local preview is not a WhatsApp format test.
- The original incident file was unavailable. Its exact cause remains probable,
  not proven; a specifically authorized real-device test is still required.

## Narrow correction

The recorder now tries supported Ogg/WebM/MP4/AAC/MP3/AMR types. If the browser
chooses a default, its actual recorder/chunk MIME determines the extension; MP4
uses `.m4a`, never `.webm`. Empty, unknown and contradictory hints fail closed.
The server independently validates the bytes; browser MIME is not proof.

The composer marks its recording with `recordedAudio=true`. This multipart hint
selects normalization, not authorization or validation. The authenticated route
preserves its existing session/company/conversation ACL and passes only a boolean.
All supported audio is validated even when the marker is absent/false. Recorded
audio is always normalized; valid AAC/MP3/AMR/MP4 attachments keep their bytes.
WebM/Ogg retain mandatory normalization. Non-normalized audio also requires a
matching extension. No database, campaign, financial or transport API changes.

1. Reject empty input or input larger than 16 MB before starting native tools.
2. Force the expected demuxer, probe the actual container and require one audio
   stream with a compatible codec. Reject a MIME/container/codec mismatch.
   Supported inputs: WebM Opus/Vorbis, Ogg Opus/Vorbis, MP4 AAC, AAC, MP3, AMR.
   Decode the input and require positive decoded time, not only a readable header.
3. Transcode to Ogg/Opus, mono, 48 kHz, 32 kbit/s, with strict decode errors.
   A valid Vorbis input is converted, never forwarded unchanged to Meta.
4. Probe the result and require Ogg, Opus, one channel and positive finite duration.
5. Decode the complete result before upload; reject native errors or error output.
6. Check output size before probing/decoding/loading it. Read through a bounded
   file handle, rechecking its size and EOF; upload the resulting `.ogg` file.
7. For audio, require a provider message ID before normal success persistence.

Missing tools and conversion/probe errors fail closed with a sanitized error.
All native stages share a 60-second budget; individual probes are capped at 15 s.
Timeout uses SIGKILL. Stdout/stderr are capped at 1 MB. Two preparations per runtime
are permitted; saturation rejects immediately without an accumulating queue.
The slot is released after cleanup, including errors in temporary-directory setup.
Native stages use one thread/filter thread, a 64 MB per-allocation guard and
bounded probe/analyze buffers. This is NOT a total process-RSS or global limit.
The output file has a 17 MB FFmpeg stop threshold, above the 16 MB accepted ceiling;
it is rejected before reading, never accepted as a silently truncated recording.
Only recordings have a 182 s ceiling (the existing composer's 180 s display, its
last interval and codec/container padding). Streaming inputs with unknown duration
are decoded/encoded at most 183 s and rejected if the decoded/output duration
exceeds 182 s. Audio attachments retain
their existing size limit and share the 60 s native budget, without a new duration
cutoff. The tools cannot fetch network protocols. Cleanup runs in finally.

The Docker image already installs the Debian `ffmpeg` package, including ffprobe.
`FFMPEG_PATH` remains supported; an optional `FFPROBE_PATH` supports custom installs.
No production configuration has been changed.

## Preservation and failure semantics

Images, video, PDF and Word retain their existing payloads and upload/send flow.
Valid AAC/AMR/MP3/MP4 audio attachments retain their bytes after validation;
invalid audio is intentionally no longer accepted. Company/channel ACL, rate limits, upload API,
message API, caption rules and database persistence mechanisms are unchanged.
The existing route returns an error for preparation/upload/send failures, and the
composer retains its preview after an error. Its existing failed-message recording
is preserved. A response from Meta is acceptance, not proof of recipient playback.
No automatic retry is added, including when the external result is uncertain.

## Tests and rollout gate

`media-conversion.test.ts` uses generated tones, including streaming-style WebM
without a seekable duration, stereo WebM/Ogg/MP4, mono MP4/AAC/MP3 and Vorbis. It checks codec,
container, channels, duration and full decoding, plus corruption, empty/oversized
input, MIME mismatch, native failures, sanitization and temporary-file cleanup.
`whatsapp-media-audio.test.ts` covers scope, the exact MP4 audit counterexamples,
real preparation before mocked Meta, marker-independent invalid-file rejection,
failure propagation, missing provider ID and unchanged non-recording media.
`recorded-audio.test.ts` covers realistic MP4 fallback and composer/route wiring.
`media-conversion-resources.test.ts` uses disposable fixtures to check oversize
output before Buffer reads, actual child-process timeout using a controlled clock,
two-slot saturation/recovery, duration rejection and cleanup. Media correctness
uses real FFmpeg/FFprobe; resource-protocol cases use explicit tool doubles.
CI installs FFmpeg and executes all four suites explicitly, without skips/retries.

Before release, obtain separate authorization for a synthetic spoken recording to
an explicitly designated test WhatsApp number. Compare the captured/uploaded bytes
and play the received recording. Do not test with customers. Until then, do not
claim that the original production incident or all recipient devices are resolved.

Residual risks: native-tool availability, per-request CPU/latency, re-encoding
quality and global conversion capacity. Runtime slots multiply across replicas;
hard total RSS/CPU/disk isolation needs OS/container quotas, not `-max_alloc` alone.
Structural decoding cannot detect every semantically truncated but valid recording.
Unsupported browser defaults are rejected, not relabeled or sent unchecked.
Rollback: revert this isolated patch; no schema or data rollback is needed.
