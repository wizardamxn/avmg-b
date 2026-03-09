import youtubedl from "youtube-dl-exec";
import path from "path";
import fs from "fs/promises";

export const downloadVideo = async (videoUrl, targetFormat = "mp4", quality = "best") => {
  const uniqueId = Date.now() + "-" + Math.round(Math.random() * 1e9);
  const outputPath = path.resolve(`uploads/${uniqueId}-download.mp4`);

  console.log(`📥 Starting network pull: ${videoUrl}`);

  // 👻 GHOST MODE CHECK
  const isTranscriptOnly = targetFormat === "txt";

  let ytdlpFormat = "bestvideo+bestaudio/best"; 
  if (quality === "good") ytdlpFormat = "bestvideo[height<=720]+bestaudio/best"; 
  else if (quality === "draft") ytdlpFormat = "bestvideo[height<=480]+bestaudio/worst"; 

  // 1. Base Configuration (Clean, fast, NO subtitles)
  const dlOptions = {
    output: outputPath,
    format: ytdlpFormat,
    mergeOutputFormat: "mp4", 
    noWarnings: true,         
    noPlaylist: true,
  };

  // 2. 👻 The Ghost Protocol Override
  if (isTranscriptOnly) {
    dlOptions.skipDownload = true; // Ignore the massive video
    dlOptions.writeSubs = true;    // Grab the text
    dlOptions.writeAutoSubs = true;
    dlOptions.subLangs = "en";
  }

  // 3. Fire the engine
  await youtubedl(videoUrl, dlOptions);

  // 4. Check for subtitles ONLY if we were looking for them
  let validSubPath = null;
  if (isTranscriptOnly) {
    const possibleSubPath = outputPath.replace('.mp4', '.en.vtt');
    try {
      await fs.access(possibleSubPath);
      console.log(`📜 Raw Subtitles extracted: ${possibleSubPath}`);
      validSubPath = possibleSubPath;
    } catch (e) {
      console.log(`⚠️ No subtitles found for this source.`);
    }
  }

  return { videoPath: isTranscriptOnly ? null : outputPath, subPath: validSubPath }; 
};