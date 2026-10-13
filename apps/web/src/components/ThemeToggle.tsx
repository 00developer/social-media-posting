'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import {
  DEFAULT_THEME,
  parseThemePreference,
  resolveTheme,
  THEME_CHANGE_EVENT,
  THEME_OPTIONS,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from '@/lib/theme';

const DARK_QUERY = '(prefers-color-scheme: dark)';

function readPreference(): ThemePreference {
  try {
    return parseThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME;
  }
}

function subscribePreference(onChange: () => void) {
  window.addEventListener('storage', onChange);
  window.addEventListener(THEME_CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(THEME_CHANGE_EVENT, onChange);
  };
}

function subscribeSystem(onChange: () => void) {
  const mql = window.matchMedia(DARK_QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

function applyTheme(preference: ThemePreference, systemDark: boolean) {
  const dark = resolveTheme(preference, systemDark) === 'dark';
  const root = document.documentElement;
  root.classList.toggle('dark', dark);
  root.style.colorScheme = dark ? 'dark' : 'light';
}

/** Current preference + setter, synced across components and tabs. */
export function useThemePreference() {
  const preference = useSyncExternalStore(subscribePreference, readPreference, () => DEFAULT_THEME);
  const systemDark = useSyncExternalStore(
    subscribeSystem,
    () => window.matchMedia(DARK_QUERY).matches,
    () => false,
  );

  // Keeps <html> in sync after mount (the inline script in app/layout.tsx handles first paint).
  useEffect(() => {
    applyTheme(preference, systemDark);
  }, [preference, systemDark]);

  const setPreference = (next: ThemePreference) => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage blocked: still switch for this page view.
    }
    applyTheme(next, window.matchMedia(DARK_QUERY).matches);
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  };

  return { preference, setPreference };
}

const ICONS = { light: Sun, dark: Moon, system: Monitor } as const;

/** Segmented Light / Dark / System switch. `size="sm"` is the compact variant used on the login page. */
export function ThemeToggle({ size = 'md', className = '' }: { size?: 'sm' | 'md'; className?: string }) {
  const { preference, setPreference } = useThemePreference();
  const btn = size === 'sm' ? 'h-7 w-7' : 'h-8 w-8';
  const icon = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';

  return (
    <div
      role="group"
      aria-label="Color theme"
      className={`inline-flex items-center gap-0.5 rounded-lg border border-line bg-surface-muted p-0.5 ${className}`}
    >
      {THEME_OPTIONS.map(({ value, label }) => {
        const Icon = ICONS[value];
        const active = preference === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => setPreference(value)}
            aria-pressed={active}
            aria-label={`${label} theme`}
            title={`${label} theme`}
            className={`${btn} inline-flex items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
              active
                ? 'bg-surface text-fg shadow-card ring-1 ring-line'
                : 'text-fg-subtle hover:text-fg hover:bg-surface-hover'
            }`}
          >
            <Icon className={icon} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
