"use strict";
// Which ffmpeg video filter each platform / content type gets. Pure so it can be checked on its own.
//
// Videos are scaled to fit a fixed canvas and padded with black bars (never cropped or stretched):
//  - Reels / Shorts (contentType 'reel'): 1080x1920 (9:16). This is what makes YouTube classify the upload
//    as a Short (it must be vertical or square) and lets Instagram / Facebook accept it as a Reel.
//  - Standard posts: the platform's own canvas (see STANDARD_CANVAS).
//  - Threads is the only exception: it keeps the source aspect ratio (only the width is capped at 1920).
// The preview frames in apps/web/src/lib/mediaFrame.ts mirror these canvases; change both together.
Object.defineProperty(exports, "__esModule", { value: true });
exports.STANDARD_CANVAS = exports.DEFAULT_CANVAS = exports.REEL_CANVAS = void 0;
exports.getVideoCanvas = getVideoCanvas;
exports.getVideoFilter = getVideoFilter;
exports.REEL_CANVAS = '1080:1920';
exports.DEFAULT_CANVAS = '1920:1080';
exports.STANDARD_CANVAS = {
    instagram: '1080:1350',
    facebook: '1920:1006', // ~1.91:1; the committed 1920:1005 has an odd height, which makes ffmpeg fail (yuv420p needs even sizes)
    youtube: '1920:1080',
    pinterest: '1000:1500',
};
/** "W:H" of the canvas the video is fitted onto, or null when the video keeps its own aspect ratio (Threads). */
function getVideoCanvas(platform, contentType = 'post') {
    if (platform === 'threads')
        return null;
    if (contentType === 'reel')
        return exports.REEL_CANVAS;
    return exports.STANDARD_CANVAS[platform] ?? exports.DEFAULT_CANVAS;
}
/** The value for ffmpeg's -vf option. */
function getVideoFilter(platform, contentType = 'post') {
    const canvas = getVideoCanvas(platform, contentType);
    if (!canvas)
        return "scale='trunc(min(1920,iw)/2)*2':-2";
    return `scale=${canvas}:force_original_aspect_ratio=decrease,pad=${canvas}:(ow-iw)/2:(oh-ih)/2`;
}
