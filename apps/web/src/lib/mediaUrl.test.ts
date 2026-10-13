import { describe, expect, it } from 'vitest';
import { resolveMediaUrl } from './mediaUrl';

const OLD = 'https://abcxyz.supabase.co/storage/v1/object/public/media/team/file.mp4';

describe('resolveMediaUrl', () => {
  it('rewrites a supabase.co storage URL to the configured proxy base', () => {
    expect(resolveMediaUrl(OLD, 'https://api.socialpush.app')).toBe('https://api.socialpush.app/storage/v1/object/public/media/team/file.mp4');
  });

  it('handles a trailing slash and a path prefix on the base', () => {
    expect(resolveMediaUrl(OLD, 'https://proxy.example.com/supa/')).toBe('https://proxy.example.com/supa/storage/v1/object/public/media/team/file.mp4');
  });

  it('keeps query strings and fragments', () => {
    expect(resolveMediaUrl(`${OLD}?t=1#video`, 'https://p.example.com')).toBe('https://p.example.com/storage/v1/object/public/media/team/file.mp4?t=1#video');
  });

  it('leaves the URL alone when the base is itself a supabase.co URL', () => {
    expect(resolveMediaUrl(OLD, 'https://other.supabase.co')).toBe(OLD);
  });

  it('leaves the URL alone when no base is configured or it is not http(s)', () => {
    expect(resolveMediaUrl(OLD, undefined)).toBe(OLD);
    expect(resolveMediaUrl(OLD, '')).toBe(OLD);
    expect(resolveMediaUrl(OLD, 'not a url')).toBe(OLD);
  });

  it('does not touch non-storage supabase URLs or other hosts', () => {
    expect(resolveMediaUrl('https://abc.supabase.co/rest/v1/posts', 'https://p.example.com')).toBe('https://abc.supabase.co/rest/v1/posts');
    expect(resolveMediaUrl('https://cdn.example.com/storage/x.png', 'https://p.example.com')).toBe('https://cdn.example.com/storage/x.png');
    expect(resolveMediaUrl('https://evil.com/?https://a.supabase.co/storage/x', 'https://p.example.com')).toBe('https://evil.com/?https://a.supabase.co/storage/x');
  });

  it('passes blob: URLs and empty values through', () => {
    expect(resolveMediaUrl('blob:http://localhost/abc#video', 'https://p.example.com')).toBe('blob:http://localhost/abc#video');
    expect(resolveMediaUrl(null, 'https://p.example.com')).toBeNull();
    expect(resolveMediaUrl('', 'https://p.example.com')).toBe('');
  });
});
