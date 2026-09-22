// Which ffmpeg video filter each platform / content type gets. Pure so it can be checked on its own.
//
// Videos are scaled to fit a fixed canvas and padded with black bars (never cropped or stretched):
//  - Reels / Shorts (contentType 'reel'): 1080x1920 (9:16). This is what makes YouTube classify the upload
//    as a Short (it must be vertical or square) and lets Instagram / Facebook accept it as a Reel.
//  - Standard posts: the platform's own canvas (see STANDARD_CANVAS).
//  - Threads is the only exception: it keeps the source aspect ratio (only the width is capped at 1920).
// The preview frames in apps/web/src/lib/mediaFrame.ts mirror these canvases; change both together.

export const REEL_CANVAS = '1080:1920';
export const DEFAULT_CANVAS = '1920:1080';
export const STANDARD_CANVAS: Record<string, string> = {
  instagram: '1080:1350',
  facebook: '1920:1006', // ~1.91:1; the committed 1920:1005 has an odd height, which makes ffmpeg fail (yuv420p needs even sizes)
  youtube: '1920:1080',
  pinterest: '1000:1500',
};

/** "W:H" of the canvas the video is fitted onto, or null when the video keeps its own aspect ratio (Threads). */
export function getVideoCanvas(platform: string, contentType: string = 'post'): string | null {
  if (platform === 'threads') return null;
  if (contentType === 'reel') return REEL_CANVAS;
  return STANDARD_CANVAS[platform] ?? DEFAULT_CANVAS;
}

/** The value for ffmpeg's -vf option. */
export function getVideoFilter(platform: string, contentType: string = 'post'): string {
  const canvas = getVideoCanvas(platform, contentType);
  if (!canvas) return "scale='trunc(min(1920,iw)/2)*2':-2";
  return `scale=${canvas}:force_original_aspect_ratio=decrease,pad=${canvas}:(ow-iw)/2:(oh-ih)/2`;
}
