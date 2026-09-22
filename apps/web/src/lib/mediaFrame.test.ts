import { describe, it, expect } from 'vitest';
import { getFrameStyle, getMediaFrame, getPostContentType, REEL_ORIENTATION_WARNING, shouldWarnReelOrientation } from './mediaFrame';

describe('getMediaFrame — images', () => {
  it.each([
    ['instagram', { w: 4, h: 5 }],
    ['twitter', { w: 16, h: 9 }],
    ['youtube', { w: 16, h: 9 }],
    ['pinterest', { w: 2, h: 3 }],
  ])('%s is cropped to a fixed ratio (object-cover)', (platform, ratio) => {
    expect(getMediaFrame(platform, false)).toEqual({ ratio, fit: 'cover' });
  });

  it.each(['facebook', 'linkedin', 'threads', 'tiktok'])('%s keeps the image natural ratio', (platform) => {
    expect(getMediaFrame(platform, false)).toEqual({ ratio: null, fit: 'contain' });
  });

  it('keeps the natural ratio when no platform is selected', () => {
    expect(getMediaFrame(null, false)).toEqual({ ratio: null, fit: 'contain' });
  });

  it('ignores reel mode for images (media-service treats them the same)', () => {
    expect(getMediaFrame('instagram', false, 'reel')).toEqual({ ratio: { w: 4, h: 5 }, fit: 'cover' });
    expect(getMediaFrame('facebook', false, 'reel')).toEqual({ ratio: null, fit: 'contain' });
  });
});

describe('getMediaFrame — videos (mirrors services/media-service/src/videoFilter.ts)', () => {
  it('uses a 9:16 frame for reels on every platform except Threads', () => {
    for (const platform of ['instagram', 'facebook', 'youtube', 'twitter', 'linkedin', 'pinterest', null]) {
      expect(getMediaFrame(platform, true, 'reel'), String(platform)).toEqual({ ratio: { w: 9, h: 16 }, fit: 'contain' });
    }
  });

  it("lets Threads keep the video's own ratio, for reels and normal posts alike", () => {
    expect(getMediaFrame('threads', true, 'reel')).toEqual({ ratio: null, fit: 'contain' });
    expect(getMediaFrame('threads', true, 'post')).toEqual({ ratio: null, fit: 'contain' });
  });

  it.each([
    ['instagram', { w: 4, h: 5 }],
    ['facebook', { w: 1920, h: 1006 }],
    ['youtube', { w: 16, h: 9 }],
    ['pinterest', { w: 2, h: 3 }],
    ['twitter', { w: 16, h: 9 }],
    ['linkedin', { w: 16, h: 9 }],
  ])('puts a normal %s video on its platform canvas', (platform, ratio) => {
    expect(getMediaFrame(platform, true, 'post')).toEqual({ ratio, fit: 'contain' });
  });

  it('shows the whole video (contain), never a crop, in every video frame', () => {
    for (const platform of ['instagram', 'facebook', 'youtube', 'pinterest', 'twitter', 'tiktok']) {
      for (const type of ['post', 'reel'] as const) expect(getMediaFrame(platform, true, type).fit).toBe('contain');
    }
  });

  it('always uses 9:16 for TikTok video (phone-shaped preview)', () => {
    expect(getMediaFrame('tiktok', true, 'post')).toEqual({ ratio: { w: 9, h: 16 }, fit: 'contain' });
  });

  it('has no fixed canvas for a normal video before a platform is picked', () => {
    expect(getMediaFrame(null, true)).toEqual({ ratio: null, fit: 'contain' });
    expect(getMediaFrame('facebook', true)).toEqual({ ratio: { w: 1920, h: 1006 }, fit: 'contain' }); // defaults to a normal post
  });
});

describe('getFrameStyle', () => {
  it('builds a full-width frame capped by max height, keeping the ratio', () => {
    expect(getFrameStyle({ w: 4, h: 5 })).toEqual({ aspectRatio: '4 / 5', width: '100%', maxWidth: 'calc(28rem * 4 / 5)' });
    expect(getFrameStyle({ w: 9, h: 16 }, 20)).toEqual({ aspectRatio: '9 / 16', width: '100%', maxWidth: 'calc(20rem * 9 / 16)' });
  });
});

describe('getPostContentType', () => {
  it('is reel when any job is a reel', () => {
    expect(getPostContentType({ publish_jobs: [{ content_type: 'post' }, { content_type: 'reel' }] })).toBe('reel');
  });

  it('is post otherwise, including when jobs are missing or unknown', () => {
    expect(getPostContentType({ publish_jobs: [{ content_type: 'post' }] })).toBe('post');
    expect(getPostContentType({ publish_jobs: [{}] })).toBe('post');
    expect(getPostContentType({ publish_jobs: [] })).toBe('post');
    expect(getPostContentType({})).toBe('post');
  });
});

describe('shouldWarnReelOrientation', () => {
  const landscape = { width: 1920, height: 1080 };
  const vertical = { width: 1080, height: 1920 };
  const square = { width: 1080, height: 1080 };

  it('warns for a landscape reel video', () => {
    expect(shouldWarnReelOrientation('reel', true, landscape)).toBe(true);
    expect(shouldWarnReelOrientation('reel', true, landscape, 'youtube')).toBe(true);
    expect(shouldWarnReelOrientation('reel', true, landscape, 'instagram')).toBe(true);
  });

  it("never warns for Threads, which keeps the video's own ratio", () => {
    expect(shouldWarnReelOrientation('reel', true, landscape, 'threads')).toBe(false);
  });

  it('explains the black bars', () => {
    expect(REEL_ORIENTATION_WARNING).toMatch(/black bars/);
    expect(REEL_ORIENTATION_WARNING).toMatch(/9:16/);
  });

  it('does not warn for vertical or square reel videos', () => {
    expect(shouldWarnReelOrientation('reel', true, vertical)).toBe(false);
    expect(shouldWarnReelOrientation('reel', true, square)).toBe(false);
  });

  it('never warns for normal posts, images, or before the size is known', () => {
    expect(shouldWarnReelOrientation('post', true, landscape)).toBe(false);
    expect(shouldWarnReelOrientation(undefined, true, landscape)).toBe(false);
    expect(shouldWarnReelOrientation('reel', false, landscape)).toBe(false);
    expect(shouldWarnReelOrientation('reel', true, null)).toBe(false);
    expect(shouldWarnReelOrientation('reel', true, undefined)).toBe(false);
  });

  it('ignores an invalid 0x0 size (metadata not decoded)', () => {
    expect(shouldWarnReelOrientation('reel', true, { width: 0, height: 0 })).toBe(false);
  });
});
