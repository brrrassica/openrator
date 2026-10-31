/**
 * OpenRator — theme tokens (M2.1). Light/dark via useColorScheme; every
 * screen consumes useTheme() so dark mode lands for free.
 */

import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';

export interface Theme {
  mode: 'light' | 'dark';
  bg: string;
  card: string;
  text: string;
  subtext: string;
  border: string;
  accent: string;
  accentText: string;
  warn: string;
  danger: string;
  ok: string;
  chart: string[];
  radius: number;
  spacing: (n: number) => number;
}

const LIGHT: Omit<Theme, 'mode' | 'spacing' | 'radius'> = {
  bg: '#F5F8FC',
  card: '#FFFFFF',
  text: '#0B1220',
  subtext: '#5B6B7F',
  border: '#DCE5EF',
  accent: '#0369A1',
  accentText: '#FFFFFF',
  warn: '#B45309',
  danger: '#B91C1C',
  ok: '#15803D',
  chart: ['#0A74D8', '#0FB5EF', '#0891B2', '#7C3AED', '#D97706', '#DB2777'],
};

const DARK: Omit<Theme, 'mode' | 'spacing' | 'radius'> = {
  bg: '#0B1220',
  card: '#141C2A',
  text: '#E7EDF5',
  subtext: '#9AA9BC',
  border: '#263244',
  accent: '#38BDF8',
  accentText: '#062033',
  warn: '#FBBF24',
  danger: '#F87171',
  ok: '#4ADE80',
  chart: ['#38BDF8', '#22D3EE', '#A78BFA', '#F472B6', '#FBBF24', '#60A5FA'],
};

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