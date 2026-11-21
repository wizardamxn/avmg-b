// Validation for the tool routes. Every option that ends up in an ffmpeg
// command comes from a whitelist or a range check here — never raw user text.
// Each validator returns the clean options object, or a string error message.

export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const speedOf = (v) => (v === undefined || v === "" ? 1 : Number(v));

/** "83", "83.5", "1:23" or "0:01:23" → seconds; null if it isn't a timestamp. */
export const parseTimestamp = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const s = String(value).trim();
  if (!/^\d+(?::\d{1,2}){0,2}(?:\.\d+)?$/.test(s)) return null;
  const parts = s.split(":").map(Number);
  if (parts.slice(1).some((p) => p >= 60)) return null;
  return parts.reduce((total, p) => total * 60 + p, 0);
};

export const compressOptions = (body) => {
  const targetMB = Number(body.targetMB);
  if (!Number.isFinite(targetMB) || targetMB < 1 || targetMB > 500)
    return "Target size must be between 1 and 500 MB.";
  return { targetMB, outputFormat: "mp4" };
};

export const audioOptions = (body) => {
  const speed = speedOf(body.speed);
  if (!SPEEDS.includes(speed)) return "Speed must be 0.5, 0.75, 1, 1.25, 1.5 or 2.";
  const normalize = body.normalize === "true";
  const removeSilence = body.removeSilence === "true";
  if (!normalize && !removeSilence && speed === 1)
    return "Pick at least one: even out volume, cut silences, or a speed.";
  const format = body.format === "wav" ? "wav" : "mp3";
  return { normalize, removeSilence, speed, format, outputFormat: format };
};

export const frameOptions = (body) => {
  const format = body.format === "png" ? "png" : "jpg";
  if (body.mode === "sheet") {
    const cols = Number(body.cols ?? 4);
    const rows = Number(body.rows ?? 4);
    if (![cols, rows].every((n) => Number.isInteger(n) && n >= 2 && n <= 6))
      return "The grid must be 2 to 6 frames on each side.";
    return { mode: "sheet", cols, rows, format, outputFormat: format };
  }
  const at = parseTimestamp(body.at ?? "0");
  if (at === null) return "Timestamp must look like 83, 1:23 or 0:01:23.";
  return { mode: "single", at, format, outputFormat: format };
};

export const editOptions = (body) => {
  const rotate = Number(body.rotate ?? 0);
  if (![0, 90, 180, 270].includes(rotate)) return "Rotate must be 0, 90, 180 or 270.";
  const flip = ["h", "v"].includes(body.flip) ? body.flip : "none";
  const speed = speedOf(body.speed);
  if (!SPEEDS.includes(speed)) return "Speed must be 0.5, 0.75, 1, 1.25, 1.5 or 2.";
  const mute = body.mute === "true";
  if (!rotate && flip === "none" && speed === 1 && !mute) return "Pick at least one edit.";
  return { rotate, flip, speed, mute, outputFormat: "mp4" };
};

export const subtitleOptions = (body) => {
  const format = ["srt", "vtt", "txt"].includes(body.format) ? body.format : null;
  return format ? { format, outputFormat: format } : "Format must be srt, vtt or txt.";
};
