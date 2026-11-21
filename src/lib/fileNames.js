// Human download names: "<what went in> (<what the tool did>).<ext>",
// e.g. "holiday (8 MB).mp4", "Me at the zoo.mp3", "lecture (clean).mp3".

/** A filename that's safe on Windows, macOS and Linux; falls back when nothing's left. */
export const safeName = (name, fallback = "avmg-file") => {
  const cleaned = String(name ?? "")
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 90)
    .trim();
  return cleaned || fallback;
};

const stem = (name) => (name ? String(name).replace(/\.[^.]+$/, "") : "");

/** 83 → "1m23s", 3725 → "1h02m05s" */
export const clockLabel = (sec) => {
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h ? `${h}h${pad(m)}m${pad(r)}s` : m ? `${m}m${pad(r)}s` : `${r}s`;
};

/**
 * Download name for a finished job. `source` is the uploaded file's original
 * name, or the video title for link jobs; `ext` includes the dot (".mp4").
 */
export const downloadName = (jobType, { source, options = {} }, ext) => {
  const base = safeName(stem(source), "avmg");
  const tag = {
    "job-compress": `${options.targetMB} MB`,
    "job-audio-clean": "clean",
    "job-frames": options.mode === "sheet" ? "contact sheet" : `at ${clockLabel(options.at ?? 0)}`,
    "job-edit": "edited",
    "job-subtitles": options.format === "txt" ? "transcript" : "subtitles",
  }[jobType];
  return safeName(tag ? `${base} (${tag})${ext}` : `${base}${ext}`);
};
