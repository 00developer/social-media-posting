// Theme preference helpers shared by the pre-paint inline script (app/layout.tsx) and the
// ThemeToggle component. Pure functions only, so they are trivially testable.

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'socialpush-theme';
/** Fired on window when the preference changes in this tab (the `storage` event covers other tabs). */
export const THEME_CHANGE_EVENT = 'socialpush-theme-change';
/** Owner's default: light content with the dark sidebar. */
export const DEFAULT_THEME: ThemePreference = 'light';

export const THEME_OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string }> = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

/** Turns whatever is stored (or nothing) into a valid preference. */
export function parseThemePreference(raw: unknown): ThemePreference {
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : DEFAULT_THEME;
}

/** The theme that is actually painted for a preference. */
export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (preference === 'system') return systemPrefersDark ? 'dark' : 'light';
  return preference;
}

/**
 * Runs synchronously in <head> before first paint: reads the stored preference, resolves "system"
 * through matchMedia and sets `class="dark"` + color-scheme on <html>. Mirrors parseThemePreference/resolveTheme.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var p=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(p!=="light"&&p!=="dark"&&p!=="system")p=${JSON.stringify(DEFAULT_THEME)};var d=p==="dark"||(p==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.classList.toggle("dark",d);r.style.colorScheme=d?"dark":"light";}catch(e){}})();`;
