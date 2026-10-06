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
  bg: '#f6f7f9',
  card: '#ffffff',
  text: '#14161a',
  subtext: '#6b7280',
  border: '#e5e7eb',
  accent: '#111827',
  accentText: '#ffffff',
  warn: '#b45309',
  danger: '#b91c1c',
  ok: '#15803d',
  chart: ['#111827', '#2563eb', '#0891b2', '#7c3aed', '#db2777', '#ca8a04'],
};

const DARK: Omit<Theme, 'mode' | 'spacing' | 'radius'> = {
  bg: '#0e1116',
  card: '#1a1f27',
  text: '#e7eaf0',
  subtext: '#9aa3b2',
  border: '#2a313c',
  accent: '#3b82f6',
  accentText: '#ffffff',
  warn: '#f59e0b',
  danger: '#f87171',
  ok: '#4ade80',
  chart: ['#3b82f6', '#22d3ee', '#a78bfa', '#f472b6', '#fbbf24', '#60a5fa'],
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