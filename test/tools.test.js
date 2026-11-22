// Run: pnpm test  (node's built-in test runner; no ffmpeg or database needed)
import { test } from "node:test";
import assert from "node:assert/strict";
import { videoKbpsFor, maxHeightFor, atempoChain, audioFilters, editFilters, mediaSummary } from "../src/services/tools.js";
import { ffmpegThreads } from "../src/services/ffmpegCpu.js";
import { safeName, clockLabel, downloadName } from "../src/lib/fileNames.js";
import { parseTimestamp, compressOptions, audioOptions, frameOptions, editOptions, subtitleOptions } from "../src/lib/toolOptions.js";

test("videoKbpsFor fits the target size", () => {
  // 25 MB over 60 s: 25*1048576*8*0.96/1000/60 ≈ 3355 kbps total, minus 96 audio
  assert.equal(videoKbpsFor(25 * 1048576, 60), 3259);
  assert.equal(videoKbpsFor(1 * 1048576, 600), null); // 1 MB for 10 minutes can't be watchable
  assert.equal(videoKbpsFor(25 * 1048576, 0), null);
  assert.equal(videoKbpsFor(25 * 1048576, 60, 0), 3355); // no audio track
});

test("maxHeightFor scales down low bitrates", () => {
  assert.equal(maxHeightFor(400), 360);
  assert.equal(maxHeightFor(900), 480);
  assert.equal(maxHeightFor(2000), 720);
  assert.equal(maxHeightFor(5000), null);
});

test("atempoChain keeps each filter inside 0.5–2.0", () => {
  assert.deepEqual(atempoChain(1.5), ["atempo=1.5"]);
  assert.deepEqual(atempoChain(4), ["atempo=2.0", "atempo=2"]);
  assert.deepEqual(atempoChain(0.25), ["atempo=0.5", "atempo=0.5"]);
});

test("audioFilters orders silence → speed → loudness", () => {
  const f = audioFilters({ normalize: true, removeSilence: true, speed: 1.25 });
  assert.equal(f.length, 3);
  assert.match(f[0], /^silenceremove/);
  assert.equal(f[1], "atempo=1.25");
  assert.match(f[2], /^loudnorm/);
  assert.deepEqual(audioFilters({ normalize: false, removeSilence: false, speed: 1 }), []);
});

test("editFilters builds rotate/flip/speed", () => {
  assert.deepEqual(editFilters({ rotate: 90, flip: "h", speed: 1 }), { video: ["transpose=1", "hflip"], audio: [] });
  assert.deepEqual(editFilters({ rotate: 180, flip: "none", speed: 2 }), {
    video: ["transpose=1", "transpose=1", "setpts=0.5*PTS"],
    audio: ["atempo=2"],
  });
});

test("parseTimestamp", () => {
  assert.equal(parseTimestamp("83"), 83);
  assert.equal(parseTimestamp("1:23"), 83);
  assert.equal(parseTimestamp("0:01:23.5"), 83.5);
  assert.equal(parseTimestamp("1:75"), null);
  assert.equal(parseTimestamp("abc"), null);
  assert.equal(parseTimestamp("1;rm -rf /"), null);
  assert.equal(parseTimestamp(""), null);
});

test("option validators reject bad input and accept good input", () => {
  assert.equal(typeof compressOptions({ targetMB: "0" }), "string");
  assert.equal(typeof compressOptions({ targetMB: "9999" }), "string");
  assert.deepEqual(compressOptions({ targetMB: "25" }), { targetMB: 25, outputFormat: "mp4" });

  assert.equal(typeof audioOptions({}), "string"); // nothing picked
  assert.equal(typeof audioOptions({ speed: "3" }), "string");
  assert.equal(audioOptions({ normalize: "true", format: "flac" }).format, "mp3");

  assert.equal(frameOptions({ at: "1:05" }).at, 65);
  assert.equal(typeof frameOptions({ at: "1:99" }), "string");
  assert.equal(typeof frameOptions({ mode: "sheet", cols: "9" }), "string");
  assert.deepEqual(frameOptions({ mode: "sheet", cols: "3", rows: "2", format: "png" }), {
    mode: "sheet", cols: 3, rows: 2, format: "png", outputFormat: "png",
  });

  assert.equal(typeof editOptions({}), "string"); // nothing picked
  assert.equal(typeof editOptions({ rotate: "45" }), "string");
  assert.equal(editOptions({ flip: "x", mute: "true" }).flip, "none");

  assert.equal(typeof subtitleOptions({ format: "exe" }), "string");
  assert.equal(subtitleOptions({ format: "srt" }).format, "srt");
});

test("mediaSummary pulls codec, size and fps out of ffprobe output", () => {
  const s = mediaSummary({
    format: { format_long_name: "QuickTime / MOV", duration: "12.345", size: "1000", bit_rate: "648000" },
    streams: [
      { codec_type: "video", codec_name: "h264", width: 1920, height: 1080, avg_frame_rate: "30000/1001" },
      { codec_type: "audio", codec_name: "aac", sample_rate: "48000", channels: 2 },
    ],
  });
  assert.deepEqual(s, {
    container: "QuickTime / MOV", durationSec: 12.35, sizeBytes: 1000, bitrateKbps: 648,
    video: { codec: "h264", width: 1920, height: 1080, fps: 29.97 },
    audio: { codec: "aac", sampleRate: 48000, channels: 2 },
  });
});

test("download names are friendly and filesystem-safe", () => {
  assert.equal(safeName('my:video/"final"?.mp4'), "my video final .mp4");
  assert.equal(safeName("../../etc/passwd"), "etc passwd");
  assert.equal(safeName("   "), "avmg-file");
  assert.equal(safeName("a".repeat(200)).length, 90);
  assert.equal(clockLabel(83), "1m23s");
  assert.equal(clockLabel(3725), "1h02m05s");
  assert.equal(clockLabel(7), "7s");
  assert.equal(downloadName("job-compress", { source: "holiday.MOV", options: { targetMB: 8 } }, ".mp4"), "holiday (8 MB).mp4");
  assert.equal(downloadName("job-audio-clean", { source: "lecture 3.m4a", options: {} }, ".mp3"), "lecture 3 (clean).mp3");
  assert.equal(downloadName("job-frames", { source: "talk.mp4", options: { mode: "single", at: 83 } }, ".jpg"), "talk (at 1m23s).jpg");
  assert.equal(downloadName("job-frames", { source: "talk.mp4", options: { mode: "sheet" } }, ".png"), "talk (contact sheet).png");
  assert.equal(downloadName("job-subtitles", { source: "Me at the zoo", options: { format: "txt" } }, ".txt"), "Me at the zoo (transcript).txt");
  assert.equal(downloadName("job-download", { source: "Me at the zoo" }, ".mp4"), "Me at the zoo.mp4");
  assert.equal(downloadName("job-convert", { source: null }, ".mp3"), "avmg.mp3");
});
test("ffmpeg thread cap defaults to 2 and accepts an override", () => {
  const prev = process.env.FFMPEG_THREADS;
  delete process.env.FFMPEG_THREADS;
  assert.equal(ffmpegThreads(), 2);
  process.env.FFMPEG_THREADS = "4";
  assert.equal(ffmpegThreads(), 4);
  process.env.FFMPEG_THREADS = "junk";
  assert.equal(ffmpegThreads(), 2);
  if (prev === undefined) delete process.env.FFMPEG_THREADS; else process.env.FFMPEG_THREADS = prev;
});
