// ffmpeg (libx264 especially) uses every CPU core by default, so one big
// re-encode could freeze the whole machine — the phone server most of all.
// Cap the threads and lower the priority: big jobs take longer, but the box
// stays responsive. FFMPEG_THREADS overrides the cap (default 2).
export const ffmpegThreads = () => Math.max(1, Math.floor(Number(process.env.FFMPEG_THREADS)) || 2);

// renice is Linux/macOS only; on Windows fluent-ffmpeg just logs a warning and carries on.
export const limitCpu = (command) => command.outputOptions(["-threads", String(ffmpegThreads())]).renice(10);
