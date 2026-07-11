import youtubedl from "youtube-dl-exec";

// Best-effort size probe for guest URL downloads: ask yt-dlp for metadata only
// (no download) and estimate the byte size. Returns bytes, or null if unknown.
export const probeRemoteSize = async (videoUrl) => {
  const opts = {
    dumpSingleJson: true,
    skipDownload: true,
    noWarnings: true,
    noPlaylist: true,
  };
  if (process.env.YTDLP_COOKIES) opts.cookies = process.env.YTDLP_COOKIES;

  const info = await youtubedl(videoUrl, opts);

  const direct = info.filesize ?? info.filesize_approx ?? null;
  if (direct) return direct;

  // Merged formats (video+audio) report their sizes separately.
  const formats = info.requested_formats || [];
  const sum = formats.reduce((s, f) => s + (f.filesize ?? f.filesize_approx ?? 0), 0);
  return sum || null;
};
