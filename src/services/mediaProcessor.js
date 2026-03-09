import ffmpeg from "fluent-ffmpeg";
import fs from "fs/promises";
import path from "path";

export const convertMedia = (
  inputPath,
  targetFormat,
  startTime,
  duration,
  watermarkPath, // 👈 ADDED!
  quality = "best", // 👈 ADDED!
) => {
  return new Promise((resolve, reject) => {
    const parsedPath = path.parse(inputPath);
    const outputPath = path.join(
      parsedPath.dir,
      // 👇 Just add "-forged" before the extension!
      `${parsedPath.name}-forged.${targetFormat}`,
    );

    console.log(`🎬 Starting Forge Engine: ${inputPath} -> ${outputPath}`);

    let command = ffmpeg(inputPath);

    // 🎛️ THE QUALITY DIAL
    console.log(`🎛️ Setting Quality Dial to: ${quality}`);
    if (targetFormat === "mp3" || targetFormat === "wav") {
      if (quality === "best") command.audioBitrate("320k");
      else if (quality === "good") command.audioBitrate("192k");
      else if (quality === "draft") command.audioBitrate("128k");
    } else if (targetFormat === "mp4") {
      // 'best' leaves the video at its original uploaded resolution
      if (quality === "good")
        command.size("1280x720"); // Force 720p HD
      else if (quality === "draft") command.size("854x480"); // Force 480p SD
    }

    // ✂️ TIME TRAVEL (Fast Seek)
    if (startTime) {
      console.log(`⏱️ Fast-seeking to start time: ${startTime}`);
      command.seekInput(startTime);
    }
    if (duration) {
      console.log(`⏱️ Trimming to duration: ${duration}s`);
      command.duration(duration);
    }

    // 💧 THE WATERMARK INJECTION
    if (watermarkPath) {
      console.log(`💧 Injecting Watermark: ${watermarkPath}`);
      command.input(watermarkPath);
      command.complexFilter(["overlay=W-w-10:H-h-10"]);
    }

    // 🎨 THE GIF ENGINE (Complex Filter)
    if (targetFormat === "gif" && !watermarkPath) {
      console.log(`🎨 Initializing GIF Palette Generator...`);
      command.complexFilter([
        "fps=15,scale=480:-1:flags=lanczos,split[s0][s1]",
        "[s0]palettegen[p]",
        "[s1][p]paletteuse",
      ]);
    }

    // 📸 THE THUMBNAIL SNAPSHOT
    if (targetFormat === "jpg" || targetFormat === "png") {
      console.log(`📸 Snapping 1-frame thumbnail...`);
      command.outputOptions(["-vframes 1"]);
    }

    command
      .toFormat(targetFormat)
      .on("progress", (progress) => {
        console.log(
          `⏳ Processing: ${Math.round(progress.percent || 0)}% done`,
        );
      })
      .on("end", async () => {
        try {
          await fs.unlink(inputPath);
          console.log(`🗑️ Deleted original payload`);
        } catch (err) {
          console.error("Cleanup failed", err);
        }
        resolve(outputPath);
      })
      .on("error", async (err) => {
        try {
          await fs.unlink(inputPath);
        } catch (e) {}
        reject(err);
      })
      .save(outputPath);
  });
};
