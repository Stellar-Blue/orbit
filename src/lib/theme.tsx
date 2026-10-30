"use client";

// Light/dark theme control for Orbit.
//
// The palette itself lives in globals.css: every colour class is driven by a custom property, so
// switching the `data-theme` attribute on <html> re-skins the whole app without re-rendering the
// page tree. This module owns the *preference* and exposes the resolved theme to the few places
// that need it in JavaScript (AG Grid), which paint outside the CSS cascade.
//
// The rule is: the visitor's system setting decides, on every visit. A manual switch from the
// header applies to the current visit only (sessionStorage), so someone who prefers light on a dark
// desktop does not pin every future visitor of that browser — and someone who changes their OS
// setting is followed on the next visit, and live within this one.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/components/ui/primitives";

export type Theme = "light" | "dark";
export type ThemePreference = Theme | "system";

const STORAGE_KEY = "orbit-theme";
const PREFERENCE_EVENT = "orbit-theme-change";
const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Runs before first paint so a dark-mode visitor never sees a white flash. Mirrors `applyTheme`. */
export const themeInitScript = `(function(){try{var p=sessionStorage.getItem("${STORAGE_KEY}")||"system";var d=p==="dark"||(p!=="light"&&window.matchMedia("${DARK_QUERY}").matches);var r=document.documentElement;r.dataset.theme=d?"dark":"light";r.style.colorScheme=d?"dark":"light";}catch(e){}})();`;

function readPreference(): ThemePreference {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

function subscribePreference(onChange: () => void) {
  // sessionStorage is per-tab and fires no event, so the only source of change is this tab's switch.
  window.addEventListener(PREFERENCE_EVENT, onChange);
  return () => window.removeEventListener(PREFERENCE_EVENT, onChange);
}

function subscribeSystemTheme(onChange: () => void) {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function readSystemTheme(): Theme {
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

interface ThemeContextValue {
  /** Resolved theme — never "system". */
  theme: Theme;
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Both facts live outside React (the visit's override and the OS media query), so they are read
  // as external stores: no state mirrored through an effect, and every consumer sees the same value.
  const preference = useSyncExternalStore(subscribePreference, readPreference, () => "system" as const);
  const systemTheme = useSyncExternalStore(subscribeSystemTheme, readSystemTheme, () => "light" as const);
  const theme: Theme = preference === "system" ? systemTheme : preference;

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setPreference = useCallback((next: ThemePreference) => {
    try {
      if (next === "system") sessionStorage.removeItem(STORAGE_KEY);
      else sessionStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private mode: the theme still applies for this page.
    }
    // sessionStorage fires no event, so notify the subscribers in this tab.
    window.dispatchEvent(new Event(PREFERENCE_EVENT));
  }, []);

  const value = useMemo<ThemeContextValue>(() => ({
    theme,
    preference,
    setPreference,
    toggleTheme: () => setPreference(theme === "dark" ? "light" : "dark"),
  }), [theme, preference, setPreference]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

/**
 * Resolved theme. Safe outside a provider (defaults to light) so isolated screens can render
 * without wiring the provider.
 */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  return context ?? {
    theme: "light",
    preference: "system",
    setPreference: () => {},
    toggleTheme: () => {},
  };
}

/**
 * Header switch. Both icons are always in the DOM and swapped by CSS on `data-theme`, so the
 * server and client markup match and there is no hydration flicker.
 */
export const ThemeToggle: React.FC<{ className?: string }> = ({ className }) => {
  const { theme, preference, toggleTheme } = useTheme();
  const next = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={preference === "system"
        ? `Following your system setting (${theme}) — click for ${next}`
        : `Theme: ${theme} for this visit — click for ${next}`}
      aria-label="Toggle light or dark mode"
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-control)] border border-[var(--line-strong)] bg-[var(--surface)] text-[var(--ink-3)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--ink)] cursor-pointer shrink-0",
        className
      )}
    >
      <Sun className="h-3.5 w-3.5 dark:hidden" aria-hidden />
      <Moon className="hidden h-3.5 w-3.5 dark:block" aria-hidden />
    </button>
  );
};
