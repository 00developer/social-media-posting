import { describe, expect, it } from 'vitest';
import { getAccountLabel } from './accountLabel';

describe('getAccountLabel', () => {
  it('returns null when nothing is stored yet', () => {
    expect(getAccountLabel({ platform: 'facebook' })).toBeNull();
    expect(getAccountLabel({ platform: 'youtube', handle: null, channel_title: null })).toBeNull();
    expect(getAccountLabel({ platform: 'linkedin', handle: '   ' })).toBeNull();
  });

  it('shows the display name as-is for Facebook Pages, LinkedIn and Pinterest', () => {
    expect(getAccountLabel({ platform: 'facebook', handle: 'Code Labs' })).toBe('Code Labs');
    expect(getAccountLabel({ platform: 'linkedin', handle: 'Shivam .' })).toBe('Shivam .');
    expect(getAccountLabel({ platform: 'pinterest', handle: 'askanything46' })).toBe('askanything46');
  });

  it('prefixes @ for Instagram and Threads usernames, without doubling it', () => {
    expect(getAccountLabel({ platform: 'instagram', handle: 'codelabs' })).toBe('@codelabs');
    expect(getAccountLabel({ platform: 'threads', handle: '@codelabs' })).toBe('@codelabs');
  });

  it('does not put @ in front of a name that has spaces', () => {
    expect(getAccountLabel({ platform: 'threads', handle: 'Code Labs' })).toBe('Code Labs');
  });

  it('falls back to channel_title for YouTube', () => {
    expect(getAccountLabel({ platform: 'youtube', channel_title: 'My Channel' })).toBe('My Channel');
    expect(getAccountLabel({ platform: 'youtube', handle: '@mychannel', channel_title: 'My Channel' })).toBe('@mychannel');
  });
});
