import fs from "fs/promises";

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