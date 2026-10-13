import { describe, it, expect } from 'vitest';
import { DEFAULT_THEME, parseThemePreference, resolveTheme, THEME_INIT_SCRIPT, THEME_STORAGE_KEY } from './theme';

describe('parseThemePreference', () => {
  it('accepts the three valid preferences', () => {
    expect(parseThemePreference('light')).toBe('light');
    expect(parseThemePreference('dark')).toBe('dark');
    expect(parseThemePreference('system')).toBe('system');
  });

  it('falls back to the light default for missing or junk values', () => {
    expect(DEFAULT_THEME).toBe('light');
    expect(parseThemePreference(null)).toBe('light');
    expect(parseThemePreference(undefined)).toBe('light');
    expect(parseThemePreference('')).toBe('light');
    expect(parseThemePreference('DARK')).toBe('light');
    expect(parseThemePreference(42)).toBe('light');
  });
});

describe('resolveTheme', () => {
  it('uses explicit choices regardless of the OS setting', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('follows the OS setting for "system"', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
});

describe('THEME_INIT_SCRIPT', () => {
  type FakeRoot = { classList: { toggle: (c: string, on: boolean) => void }; style: { colorScheme: string } };

  function run(stored: string | null, systemDark: boolean, throwOnStorage = false) {
    const classes = new Set<string>(['dark']);
    const root: FakeRoot = {
      classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) },
      style: { colorScheme: '' },
    };
    const localStorage = {
      getItem: (k: string) => {
        if (throwOnStorage) throw new Error('blocked');
        return k === THEME_STORAGE_KEY ? stored : null;
      },
    };
    const window = { matchMedia: () => ({ matches: systemDark }) };
    const document = { documentElement: root };
    new Function('localStorage', 'window', 'document', THEME_INIT_SCRIPT)(localStorage, window, document);
    return { dark: classes.has('dark'), scheme: root.style.colorScheme };
  }

  it('applies the stored preference before paint', () => {
    expect(run('dark', false)).toEqual({ dark: true, scheme: 'dark' });
    expect(run('light', true)).toEqual({ dark: false, scheme: 'light' });
    expect(run('system', true)).toEqual({ dark: true, scheme: 'dark' });
    expect(run('system', false)).toEqual({ dark: false, scheme: 'light' });
  });

  it('defaults to light when nothing (or junk) is stored', () => {
    expect(run(null, true)).toEqual({ dark: false, scheme: 'light' });
    expect(run('purple', true)).toEqual({ dark: false, scheme: 'light' });
  });

  it('never throws when storage is unavailable', () => {
    expect(() => run(null, false, true)).not.toThrow();
  });
});
