import fs from "fs/promises";

// Cue timestamp line: "00:00:01.000 --> ..." (VTT) or "00:00:01,000 --> ..." (SRT)
const CUE_TS = /(\d{2}):(\d{2}):(\d{2})[.,]\d{3}\s*-->/;

// Parse .vtt / .srt / .txt subtitles into { plainText, timestampedText }.
// plainText is the clean, deduped transcript; timestampedText prefixes each
// cue with a [mm:ss] (or [h:mm:ss]) marker so the AI can cite timestamps.
export const parseSubtitles = async (filePath) => {
  const raw = await fs.readFile(filePath, "utf-8");

  // Plain text file: nothing to strip, just normalise whitespace.
  if (/\.txt$/i.test(filePath)) {
    const plain = raw.replace(/\s+/g, " ").trim();
    return { plainText: plain, timestampedText: plain };
  }

  const blocks = raw.replace(/\r/g, "").split(/\n\n+/);
  const plainLines = [];
  const stampedLines = [];
  let last = "";

  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    if (/^(WEBVTT|Kind:|Language:)/i.test(lines[0])) continue;

    let stamp = null;
    const textLines = [];
    for (const line of lines) {
      const m = line.match(CUE_TS);
      if (m) {
        const [, hh, mm, ss] = m;
        stamp = Number(hh) > 0 ? `${Number(hh)}:${mm}:${ss}` : `${mm}:${ss}`;
        continue;
      }
      if (/^\d+$/.test(line)) continue; // SRT numeric cue index
      const cleaned = line
        .replace(/<\d{2}:\d{2}:\d{2}\.\d{3}>/g, "") // inline karaoke timestamps
        .replace(/align:start position:\d+%/g, "")
        .replace(/\[.*?\]/g, "") // [Music] etc.
        .replace(/<[^>]+>/g, "") // stray tags
        .trim();
      if (cleaned) textLines.push(cleaned);
    }

    const text = textLines.join(" ").replace(/\s+/g, " ").trim();
    if (!text || text === last) continue; // skip empties and stutter-dupes
    last = text;
    plainLines.push(text);
    stampedLines.push(stamp ? `[${stamp}] ${text}` : text);
  }

  return {
    plainText: plainLines.join(" "),
    timestampedText: stampedLines.join("\n"),
  };
};

export const cleanTranscript = async (vttPath) => {
  try {
    const rawContent = await fs.readFile(vttPath, "utf-8");
    
    // 1. THE CHAINSAW: Strip all Matrix code
    let cleanText = rawContent
      .replace(/WEBVTT.*/g, "")
      .replace(/Kind:.*/g, "")
      .replace(/Language:.*/g, "")
      .replace(/\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}.*/g, "") // Standard timestamps
      .replace(/<\d{2}:\d{2}:\d{2}\.\d{3}>/g, "") // Inline karaoke timestamps (<00:00:29.119>)
      .replace(/align:start position:\d+%/g, "") // Alignment junk
      .replace(/\[.*?\]/g, "") // Sound effects like [Music]
      .replace(/<[^>]+>/g, ""); // Stray HTML formatting tags

    // 2. THE STUTTER FIX: Remove consecutive duplicate lines
    const lines = cleanText.split('\n').map(line => line.trim()).filter(line => line !== "");
    const uniqueLines = [];
    let lastLine = "";
    
    for (const line of lines) {
      if (line !== lastLine) {
        uniqueLines.push(line);
        lastLine = line;
      }
    }

    // 3. THE POLISH: Stitch it together and fix weird spacing
    cleanText = uniqueLines.join(" ").replace(/\s+/g, " ").trim();
    
    const txtPath = vttPath.replace('.en.vtt', '-transcript.txt');
    await fs.writeFile(txtPath, cleanText, "utf-8");
    
    console.log(`📝 Clean transcript forged: ${txtPath}`);
    await fs.unlink(vttPath); // Delete the raw VTT

    return txtPath; 
  } catch (error) {
    console.error("Transcript cleaning failed:", error);
    return null;
  }
};