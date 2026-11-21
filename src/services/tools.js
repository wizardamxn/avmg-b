import ffmpeg from "fluent-ffmpeg";
import path from "path";
import { cleanTranscript } from "./transcriptCleaner.js";

// ffmpeg recipes for the newer tools. Options arrive already validated
// (src/lib/toolOptions.js); the pure helpers below are unit-tested.

// ── pure helpers ─────────────────────────────────────────────────────────

export const AUDIO_KBPS = 96;

/**
 * Video bitrate (kbps) that lands a `seconds`-long file near `targetBytes`,
 * keeping ~4% for container overhead. null when it can't fit watchably.
 */
export const videoKbpsFor = (targetBytes, seconds, audioKbps = AUDIO_KBPS) => {
  if (!(seconds > 0) || !(targetBytes > 0)) return null;
  const totalKbps = (targetBytes * 8 * 0.96) / 1000 / seconds;
  const kbps = Math.floor(totalKbps - audioKbps);
  return kbps >= 100 ? kbps : null;
};

/** Cap the height for low bitrates so a small file isn't a smeared 1080p. */
export const maxHeightFor = (kbps) => (kbps < 600 ? 360 : kbps < 1200 ? 480 : kbps < 2500 ? 720 : null);

/** ffmpeg's atempo only accepts 0.5–2.0 per filter, so chain it for anything outside. */
export const atempoChain = (speed) => {
  const parts = [];
  let s = speed;
  while (s > 2) {
    parts.push("atempo=2.0");
    s /= 2;
  }
  while (s < 0.5) {
    parts.push("atempo=0.5");
    s /= 0.5;
  }
  parts.push(`atempo=${+s.toFixed(4)}`);
  return parts;
};

export const audioFilters = ({ normalize, removeSilence, speed }) => {
  const f = [];
  // Cut pauses longer than 0.7s quieter than -45 dB (lectures, podcasts).
  if (removeSilence) f.push("silenceremove=stop_periods=-1:stop_duration=0.7:stop_threshold=-45dB");
  if (speed && speed !== 1) f.push(...atempoChain(speed));
  // EBU R128 loudness: evens out quiet and loud parts; last so it sees the final audio.
  if (normalize) f.push("loudnorm=I=-16:TP=-1.5:LRA=11");
  return f;
};

export const editFilters = ({ rotate, flip, speed }) => {
  const video = [];
  const audio = [];
  if (rotate === 90) video.push("transpose=1");
  else if (rotate === 180) video.push("transpose=1", "transpose=1");
  else if (rotate === 270) video.push("transpose=2");
  if (flip === "h") video.push("hflip");
  else if (flip === "v") video.push("vflip");
  if (speed && speed !== 1) {
    video.push(`setpts=${+(1 / speed).toFixed(4)}*PTS`);
    audio.push(...atempoChain(speed));
  }
  return { video, audio };
};

/** The useful bits of an ffprobe result, for the media inspector. */
export const mediaSummary = (data) => {
  const v = data.streams.find((s) => s.codec_type === "video");
  const a = data.streams.find((s) => s.codec_type === "audio");
  let fps = null;
  if (v?.avg_frame_rate && v.avg_frame_rate !== "0/0") {
    const [n, d] = v.avg_frame_rate.split("/").map(Number);
    if (d) fps = Math.round((n / d) * 100) / 100;
  }
  return {
    container: data.format.format_long_name || data.format.format_name,
    durationSec: Math.round(Number(data.format.duration || 0) * 100) / 100,
    sizeBytes: Number(data.format.size) || null,
    bitrateKbps: data.format.bit_rate ? Math.round(Number(data.format.bit_rate) / 1000) : null,
    video: v ? { codec: v.codec_name, width: v.width, height: v.height, fps } : null,
    audio: a ? { codec: a.codec_name, sampleRate: Number(a.sample_rate) || null, channels: a.channels ?? null } : null,
  };
};

// ── ffmpeg runners ───────────────────────────────────────────────────────

const outPath = (input, suffix, ext) => {
  const p = path.parse(input);
  return path.join(p.dir, `${p.name}-${suffix}.${ext}`);
};

const run = (command, output) =>
  new Promise((resolve, reject) => {
    command.on("error", reject).on("end", () => resolve(output)).save(output);
  });

export const probe = (file) =>
  new Promise((resolve, reject) => ffmpeg.ffprobe(file, (err, data) => (err ? reject(err) : resolve(data))));

const streams = (info) => ({
  hasVideo: info.streams.some((s) => s.codec_type === "video"),
  hasAudio: info.streams.some((s) => s.codec_type === "audio"),
  seconds: Number(info.format.duration) || 0,
});

export const compressToSize = async (input, targetMB) => {
  const { hasVideo, hasAudio, seconds } = streams(await probe(input));
  if (!hasVideo) throw new Error("Compress to size works on video files.");
  const kbps = videoKbpsFor(targetMB * 1024 * 1024, seconds, hasAudio ? AUDIO_KBPS : 0);
  if (!kbps) throw new Error(`${targetMB} MB is too small for a ${Math.round(seconds)}s video. Pick a bigger size or trim it first.`);

  // Single pass with a capped rate: two-pass would double the CPU time on the phone server.
  const cmd = ffmpeg(input)
    .videoCodec("libx264")
    .outputOptions(["-preset veryfast", `-b:v ${kbps}k`, `-maxrate ${kbps}k`, `-bufsize ${kbps * 2}k`, "-movflags +faststart"]);
  const h = maxHeightFor(kbps);
  if (h) cmd.videoFilters(`scale=-2:'min(${h},ih)'`);
  if (hasAudio) cmd.audioCodec("aac").audioBitrate(`${AUDIO_KBPS}k`);
  else cmd.noAudio();
  return run(cmd, outPath(input, `${targetMB}mb`, "mp4"));
};

export const cleanAudio = async (input, opts) => {
  const { hasAudio } = streams(await probe(input));
  if (!hasAudio) throw new Error("This file has no audio.");
  const cmd = ffmpeg(input).noVideo().audioFilters(audioFilters(opts));
  if (opts.format === "mp3") cmd.audioCodec("libmp3lame").audioBitrate("192k");
  return run(cmd, outPath(input, "clean", opts.format));
};

export const grabFrames = async (input, { mode, at, cols, rows, format }) => {
  const { hasVideo, seconds } = streams(await probe(input));
  if (!hasVideo) throw new Error("Frame grabs need a video file.");
  const imageOpts = ["-frames:v 1", "-update 1", ...(format === "jpg" ? ["-q:v 2"] : [])];

  if (mode === "sheet") {
    // Spread cols*rows frames evenly over the whole video, then tile them into one image.
    const count = cols * rows;
    const cmd = ffmpeg(input)
      .videoFilters([`fps=${(count / Math.max(seconds, 1)).toFixed(6)}`, "scale=320:-2", `tile=${cols}x${rows}`])
      .outputOptions(imageOpts);
    return run(cmd, outPath(input, "sheet", format));
  }

  if (seconds && at >= seconds) throw new Error(`The video is only ${Math.floor(seconds)}s long.`);
  return run(ffmpeg(input).seekInput(at).outputOptions(imageOpts), outPath(input, "frame", format));
};

export const quickEdit = async (input, opts) => {
  const { hasVideo, hasAudio } = streams(await probe(input));
  if (!hasVideo) throw new Error("Quick edits work on video files.");
  const { video, audio } = editFilters(opts);
  const cmd = ffmpeg(input).videoCodec("libx264").outputOptions(["-preset veryfast", "-crf 23", "-movflags +faststart"]);
  if (video.length) cmd.videoFilters(video);
  if (opts.mute || !hasAudio) cmd.noAudio();
  else {
    cmd.audioCodec("aac").audioBitrate("128k");
    if (audio.length) cmd.audioFilters(audio);
  }
  return run(cmd, outPath(input, "edit", "mp4"));
};

/** Turn yt-dlp's .vtt into the requested subtitle/transcript file. */
export const subtitlesAs = async (vttPath, format) => {
  if (format === "vtt") return vttPath;
  if (format === "txt") {
    const txt = await cleanTranscript(vttPath);
    if (!txt) throw new Error("Could not read the subtitles.");
    return txt;
  }
  return run(ffmpeg(vttPath), outPath(vttPath, "subs", "srt"));
};
