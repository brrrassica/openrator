/**
 * OpenRator — theme tokens (M2.1). Light/dark via useColorScheme; every
 * screen consumes useTheme() so dark mode lands for free.
 */

import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';

import { DARK_TOKENS, LIGHT_TOKENS, ThemeTokens } from './theme-tokens';

export interface Theme extends ThemeTokens {
  mode: 'light' | 'dark';
  radius: number;
  spacing: (n: number) => number;
}

const LIGHT = LIGHT_TOKENS;
const DARK = DARK_TOKENS;

const ThemeCtx = createContext<Theme | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const mode = useColorScheme() === 'dark' ? 'dark' : 'light';
  const theme = useMemo<Theme>(
    () => ({ ...(mode === 'dark' ? DARK : LIGHT), mode, radius: 12, spacing: (n) => n * 4 }),
    [mode],
  );
  return <ThemeCtx.Provider value={theme}>{children}</ThemeCtx.Provider>;
}

export function useTheme(): Theme {
  const t = useContext(ThemeCtx);
  if (!t) throw new Error('useTheme outside ThemeProvider');
  return t;
}