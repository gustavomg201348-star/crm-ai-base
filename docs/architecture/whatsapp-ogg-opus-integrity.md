# Ogg/Opus integrity after PR 151

Base: `60b8fd0babcddd73659bf6466298a2bc8d68bb57`.

## Evidence and independent standards review

The real asset recovered read-only from Meta was mono Opus, 48 kHz, 24036 bytes,
about 5.886 seconds. CRCs and strict FFmpeg decoding passed. Its first audio page
completed 50 packets of 960 samples, but advertised granule 47976 rather than at
least 48000, without EOS. No customer audio, identifiers or credentials are fixtures.

RFC 7845 sections 4, 4.3, 4.4 and 4.5 establish separate rules for the initial
granule, pre-skip, subsequent pages and final trimming. Pre-skip is not subtracted
from completed packet durations when checking the initial granule. An initial
non-EOS granule smaller than completed samples is invalid. Intermediate pages add
their completed packet samples exactly. EOS permits final trimming, not extra
samples or a position before the prior completed page. A first audio page that is
also EOS has its own trimming exception but still must cover pre-skip.

References:
- https://www.rfc-editor.org/rfc/rfc7845.html
- https://www.rfc-editor.org/rfc/rfc6716.html (Opus packet framing and durations)
- https://www.rfc-editor.org/rfc/rfc3533.html (Ogg pages, lacing and CRC)

## Confirmed pre-upload reproduction

FFmpeg 5.1.9's Ogg muxer computes Opus granules from packet PTS, packet duration
and encoder padding, not solely from the count of encoded samples:
https://github.com/FFmpeg/FFmpeg/blob/n5.1.9/libavformat/oggenc.c

Synthetic tones encoded as WebM with a small 8 ms timestamp discontinuity produce,
under the previous CRM encoding arguments, a first page with granule 48936 but
48960 packet samples: the same 24-sample deficit. A separate 1 ms jitter sequence
produces a 96-sample intermediate-page discrepancy. These failures occur locally,
before any upload, and demonstrate a timestamp-derived integrity defect.

The exact original browser input and pre-upload hash were not retained. Therefore
this reproduction establishes the failure mechanism and prevention, not the exact
browser's timestamp history or a byte-for-byte CRM-to-Meta comparison. A strict
WhatsApp parser rejecting the real malformed asset remains probable, not verified
by inspecting that client's internal error path.
An independent forensic-only `opusdec` invocation also rejected the recovered
real asset (exit 1, no signal). That file was not a regression fixture or repository
artifact; only synthetic silence and generated tones are used in automated tests.

## Narrow correction

Before encoding, `aresample=48000,asettb=1/48000,asetpts=N/SR/TB` expresses the
decoded audio on a 48 kHz sample clock and derives PTS from sample count. Encoder
lookahead/pre-skip remains the encoder's responsibility. No manual granule patch,
CRC repair, packet insertion or post-hoc concealment is performed. MIME, bitrate,
channel count, Meta payload and transport remain unchanged.

`inspectOggOpus` independently checks bounded Ogg pages and Opus framing: exact
headers, CRC, serial/sequence, continuation, lacing, header pages, packet sizes,
TOC durations, initial/intermediate granules, pre-skip/EOS and complete termination.
Input accepts a single logical stream with compatible OpusHead major version 0
(version octets 0..15, RFC 7845 section 5.1) and mapping families 0 or 1.
Known mandatory fields and mapping tables must remain complete. Versions 0/1
retain exact known header sizes; versions 2..15 may append unknown fields but may
not omit known fields. Versions >=16 are rejected, not guessed compatible.
Family 0 requires its implicit mono/stereo mapping; family 1 requires 1..8 output
channels, a complete table, positive stream count, coupled count <= stream count,
at most 255 decoded channels and valid indices (including 255 for silence).
Output and decoded channel counts need not match; duplicate indices are valid.
For multistream input, the first N-1 packets use RFC 6716 Appendix B self-delimited
framing and the last packet uses regular framing. All streams must have the same
duration, counted once for granules, not multiplied by stream count. Frame sizes,
padding, consumed boundaries and the 120 ms maximum remain checked.
Convertible input may have valid initial offsets. Normalized output still must
use OpusHead v1 without extensions, family 0, mono, identify 48 kHz and start at sample zero; family 1 is never
accepted as the final upload profile, even for mono.
Chaining, multiplexing, missing EOS and larger unsupported metadata are rejected.
This is not a replacement for native decoding of compressed frame contents.

An input page with zero segments is not an empty Opus packet. After the mandatory
first identification page, empty pages are permitted before/between audio pages
(also between headers), with granule -1, correct CRC, serial, flags and contiguous
page sequence. They do not complete packets, add samples, reset the last audio
granule, or discard the packet being assembled. A continuation bit on an empty
page requires a pending packet; the next nonempty page must still carry the
correct continuation bit. A zero-size completed audio packet remains invalid.

An empty final EOS page is accepted only after complete, nonempty audio, with no
pending packet and at physical EOF. It can advertise -1 (no completed packet),
or repeat the last audio granule as its position marker; it cannot move that
position or introduce end trimming. Ordinary empty pages require -1. An empty
BOS, truncated/missing EOS, data after EOS, or an empty EOS without prior audio
is rejected. Native acceptance alone is not authoritative: FFmpeg/Xiph tolerate
some malformed EOF/flags too, while the structural guard enforces these checks.
The final CRM-produced output profile remains stricter and excludes empty pages.

Opus-in-Ogg input is checked before decoding/conversion, so malformed input is
rejected, not silently repaired. Vorbis-in-Ogg retains its existing conversion.
All normalized output is independently checked before it can return to the Meta
uploader. Size checks and bounded reading still precede allocation of output.

The existing 16 MiB input/output ceiling, 60-second shared native budget, probe
timeouts, two-slot fail-fast concurrency, protocol/thread/allocation controls and
temporary-file cleanup remain. Structural parsing is bounded by 16 MiB total and
1 MiB per assembled packet, including comments, with no unbounded packet queue.
Only the active packet is assembled; granule arithmetic must remain safe-integer.
These are per-runtime controls, not total OS RSS/CPU quotas across replicas.

## Tests and release gate

Synthetic fixtures use an independent bitwise CRC implementation. The exact
47976/48000 counterexample decodes with FFmpeg but fails the new structural guard.
Tests cover pre-skip, valid first-page EOS trimming, positive input offsets,
intermediate gaps, CRC/sequence/continuation, frame sizes, truncation and EOS.
Real FFmpeg tones cover WebM, Ogg and MP4, mono/stereo, millisecond timestamp
discontinuities/jitter and the recorder duration boundary. Output assertions use
an independent 20 ms packet timeline oracle rather than the production parser.
Invalid structural input must cause zero Meta upload/send and zero success save.
The Xiph `opusdec` tool independently rejects the exact malformed fixture and
accepts its valid control and generated WebM/Ogg/MP4 conversions. CI installs
`opus-tools` alongside FFmpeg, without changing the production image or application
dependencies. Local developers need `opusdec` on PATH or `OPUSDEC_PATH` configured.
Existing timeout, output-size, concurrency and cleanup assertions are preserved;
resource tool doubles now emit structurally valid synthetic silence containers.

The independent audit's valid family-1 mono counterexample is covered explicitly.
Synthetic headers exercise malformed counts/tables, silence/duplicate mappings,
self-delimited CBR/VBR/padding, truncation and conflicting stream durations.
FFmpeg-generated family-1 mono, stereo, 3-, 6- and 8-channel inputs must pass Xiph
decoding, normalize to the strict output profile, and pass Xiph again. Invalid
mapping input must never reach mocked Meta or successful Message persistence.

No schema, database, webhook, commercial/financial rule or Meta request changes.
No production access, real sends, deployment or publication is part of this patch.
Obtain an independent audit and a separately authorized real-device homologation.
Do not claim WhatsApp playback is proven by local decoding or conformance alone.
Rollback is a revert of this isolated change; no database rollback is required.

## Local validation record

The first regression run overlapped the Next build: 42/43 stages passed. The
unchanged OpenCredit test `total deadline covers slow reads, empty chunks and
stream failure` failed its 1800 ms elapsed-time assertion. No assertion or timeout
was changed. A clean-main control passed 127/127 tests; test and handler bytes
matched the feature. The controlled run without concurrent build passed all
43 stages. Preserve both results: the isolated timing failure is a residual test
stability observation, not evidence of a demonstrated financial-code regression.

During validation, remote main advanced to
`36ef3959447658f557d4aef5bd92a78e60fdf070` (PR 152, four OpenCredit-only files).
No audio, CI, dependency or schema files overlap. This patch remains on the
requested base; no merge/rebase or modification of that parallel work occurred.

## Mapping-family audit correction validation

The input guard previously applied the final family-0 profile to every input.
The independently generated family-1 mono counterexample now passes the parser,
native decoding and normalization, without relaxing the final upload profile.
The initial expanded fixture run failed during generation: FFmpeg chose 2.1 for
three channels, which is not a family-1 layout. The fixture explicitly requests
3.0; no assertion, timeout or production behavior was weakened.

On Linux/Node 20.20.2, FFmpeg 5.1.9 and Xiph opus-tools 0.2, the final audio suite
passed 77/77, followed by three planned repetitions of 77/77. All 43 local
non-PostgreSQL regression stages passed, including OpenCredit, inbound, chatbot,
campaigns, media, templates and text shadow. Typecheck, lint, verify, build and
both Prisma schema validations passed. The final checks used a disposable source
snapshot combining this patch with main 36ef395, without a Git merge. PostgreSQL
integration was not rerun: this correction changes no database model, query or
transaction. No migration or real provider call was performed.

## Empty-page and compatible-header corrections

The second independent audit reproduced two input regressions: a valid v1 stream
with a zero-segment page, and a compatible v2 identification header. Both were
accepted by the base normalizer/Xiph but rejected by the new structural guard.
The input-only handling above addresses these without removing CRC, granule,
pre-skip, mapping, size or native-decoding checks. Encoding and resource controls
are unchanged. The existing sample-count PTS filter and 47976/48000 rejection
remain required regressions. Permanent tests cover page positions, empty EOS,
continuation across empty pages, version 0/1/2/15, incompatible major versions,
future extensions, truncated mandatory tables and rejection before mocked Meta.

This correction passed 22/22 structural tests, 84/84 audio tests and three planned
repetitions of 84/84. All 43 local regression stages passed (4750 test executions,
zero failures/skips/native crashes). The 32 independent cases passed again; both
previous blocking counterexamples now report parser acceptance and successful
real preparation, matching the base and Xiph. Verify (SQLite Prisma validation,
typecheck, lint), PostgreSQL schema validation, build and diff-check passed.
The tested source hashes match the worktree. Main remained 36ef395 after fetch;
the four parallel OpenCredit files were not incorporated into the Git package.
No production database, migration, real Meta send or remote CI was exercised.
Real-device WhatsApp homologation still requires separate authorization.
