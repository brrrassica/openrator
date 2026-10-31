/**
 * OpenRator — colour tokens (M2.1), kept in a pure module so the a11y contrast
 * audit (M5.4) can import them without pulling in React Native.
 */

export interface ThemeTokens {
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
}

export const LIGHT_TOKENS: ThemeTokens = {
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

export const DARK_TOKENS: ThemeTokens = {
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
