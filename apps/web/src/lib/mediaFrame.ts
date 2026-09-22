// What a post's media will actually look like on each platform, so previews can show it faithfully.
// Pure (no React) so it is unit tested. Mirrors what services/media-service does to uploads
// (see services/media-service/src/videoFilter.ts for videos):
//  - images: instagram / twitter / youtube / pinterest are CROPPED to a fixed ratio (sharp `fit: 'cover'`,
//    centre), every other platform keeps the image's own ratio (threads only caps the width);
//  - videos: scaled to fit a fixed canvas and PADDED with black bars (never cropped): Reels/Shorts 9:16,
//    standard posts the platform's canvas; Threads is the only platform that keeps the video's own ratio.
// If media-service changes, update CROPPED_IMAGE_RATIOS / STANDARD_VIDEO_RATIOS here.

export type FrameRatio = { w: number; h: number };
export type PostContentType = 'post' | 'reel';
export type MediaFrame = {
  /** Fixed frame ratio, or null when the media keeps its own (natural) ratio. */
  ratio: FrameRatio | null;
  /** How media fills a fixed frame: 'cover' = cropped like the real post, 'contain' = fully visible. */
  fit: 'cover' | 'contain';
};

const CROPPED_IMAGE_RATIOS: Record<string, FrameRatio> = {
  instagram: { w: 4, h: 5 }, // 1080x1350
  twitter: { w: 16, h: 9 }, // 1200x675
  youtube: { w: 16, h: 9 }, // 1920x1080
  pinterest: { w: 2, h: 3 }, // 1000x1500
};

// Canvas ratios of standard (non-reel) videos, from media-service's STANDARD_CANVAS / DEFAULT_CANVAS
const STANDARD_VIDEO_RATIOS: Record<string, FrameRatio> = {
  instagram: { w: 4, h: 5 }, // 1080x1350
  facebook: { w: 1920, h: 1006 }, // ~1.91:1
  youtube: { w: 16, h: 9 }, // 1920x1080
  pinterest: { w: 2, h: 3 }, // 1000x1500
};
const DEFAULT_VIDEO_RATIO: FrameRatio = { w: 16, h: 9 }; // twitter, linkedin, ... 1920x1080

const VERTICAL: FrameRatio = { w: 9, h: 16 };

export function getMediaFrame(platform: string | null, isVideo: boolean, contentType: PostContentType = 'post'): MediaFrame {
  if (isVideo) {
    if (platform === 'threads') return { ratio: null, fit: 'contain' }; // the only platform that keeps the video's own ratio
    // Reels / Shorts and TikTok are full-screen vertical surfaces
    if (contentType === 'reel' || platform === 'tiktok') return { ratio: VERTICAL, fit: 'contain' };
    if (!platform) return { ratio: null, fit: 'contain' }; // no platform picked yet: canvas unknown
    return { ratio: STANDARD_VIDEO_RATIOS[platform] ?? DEFAULT_VIDEO_RATIO, fit: 'contain' };
  }
  const cropped = platform ? CROPPED_IMAGE_RATIOS[platform] : undefined;
  return cropped ? { ratio: cropped, fit: 'cover' } : { ratio: null, fit: 'contain' };
}

/**
 * Inline style for a fixed-ratio frame: full width, but never taller than `maxHeightRem`
 * (the width shrinks with it, so the ratio is kept instead of the frame stretching).
 */
export function getFrameStyle(ratio: FrameRatio, maxHeightRem = 28) {
  return {
    aspectRatio: `${ratio.w} / ${ratio.h}`,
    width: '100%',
    maxWidth: `calc(${maxHeightRem}rem * ${ratio.w} / ${ratio.h})`,
  };
}

/** A post counts as a reel when any of its jobs was created as one (content_type lives on publish_jobs). */
export function getPostContentType(post: { publish_jobs?: Array<Record<string, unknown>> }): PostContentType {
  return post.publish_jobs?.some((job) => job.content_type === 'reel') ? 'reel' : 'post';
}

export const REEL_ORIENTATION_WARNING =
  'This video is landscape, so it will sit inside the vertical 9:16 Reels / Shorts frame with black bars above and below. Use a vertical (9:16) video for a full-screen Reel.';

/**
 * True when a reel's video is landscape (wider than tall) and the platform pads it into 9:16.
 * Square and vertical videos don't warn; Threads keeps the video's own ratio, so it never warns.
 */
export function shouldWarnReelOrientation(
  contentType: PostContentType | undefined,
  isVideo: boolean,
  size: { width: number; height: number } | null | undefined,
  platform?: string | null
): boolean {
  if (platform === 'threads') return false;
  if (contentType !== 'reel' || !isVideo || !size) return false;
  if (size.width <= 0 || size.height <= 0) return false;
  return size.width > size.height;
}
