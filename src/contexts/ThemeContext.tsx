import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useSQLiteContext } from 'expo-sqlite';
import { getSetting, setSetting } from '../db/database';

export type ColorSet = {
  body: string;
  card: string;
  border: string;
  primary: string;
  onPrimary: string;
  onDark: string;
  muted: string;
  stone: string;
  error: string;
  success: string;
  successBg: string;
  danger: string;
  warning: string;
  // schedule
  grid: string;
  headerCell: string;
  primarySoft: string;
  ink: string;
  line: string;
  termBg: string;
  termBorder: string;
  termText: string;
  procText: string;
  diaBg: string;
  diaBorder: string;
  diaText: string;
  doneBg: string;
  doneBorder: string;
  // stats
  cellEmpty: string;
  // home sheets/modals
  sheetBg: string;
  sheetBorder: string;
  freqCardBg: string;
  freqCardBorder: string;
  scheduleCardBg: string;
  iconChipActiveBg: string;
};

// Non-accent base palettes (accent fields will be overridden per theme)
const BASE_LIGHT: ColorSet = {
  body: '#ffffff',
  card: '#ffffff',
  border: '#dbeafe',
  primary: '#2563eb',
  onPrimary: '#ffffff',
  onDark: '#2d3748',
  muted: '#111827',
  stone: '#111827',
  error: '#e52020',
  success: '#16a34a',
  successBg: '#dcfce7',
  danger: '#dc2626',
  warning: '#df6500',
  grid: '#d1d5db',
  headerCell: '#f1f5f9',
  primarySoft: '#dbeafe',
  ink: '#111827',
  line: '#64748b',
  termBg: '#dbeafe',
  termBorder: '#2563eb',
  termText: '#1e3a8a',
  procText: '#1e3a8a',
  diaBg: '#bbf7d0',
  diaBorder: '#16a34a',
  diaText: '#14532d',
  doneBg: '#16a34a',
  doneBorder: '#15803d',
  cellEmpty: '#eef4ff',
  sheetBg: '#eff4ff',
  sheetBorder: '#93b4f5',
  freqCardBg: '#e8f0fe',
  freqCardBorder: '#93b4f5',
  scheduleCardBg: '#eff6ff',
  iconChipActiveBg: '#eff6ff',
};

const BASE_DARK: ColorSet = {
  body: '#0f172a',
  card: '#1e293b',
  border: '#334155',
  primary: '#60a5fa',
  onPrimary: '#ffffff',
  onDark: '#e2e8f0',
  muted: '#94a3b8',
  stone: '#cbd5e1',
  error: '#f87171',
  success: '#4ade80',
  successBg: '#14532d',
  danger: '#f87171',
  warning: '#fbbf24',
  grid: '#334155',
  headerCell: '#1a2536',
  primarySoft: '#1e3a5f',
  ink: '#e2e8f0',
  line: '#475569',
  termBg: '#1e3a5f',
  termBorder: '#60a5fa',
  termText: '#93c5fd',
  procText: '#93c5fd',
  diaBg: '#14532d',
  diaBorder: '#4ade80',
  diaText: '#a7f3d0',
  doneBg: '#15803d',
  doneBorder: '#16a34a',
  cellEmpty: '#1e293b',
  sheetBg: '#1a2744',
  sheetBorder: '#3b4f7a',
  freqCardBg: '#1a2744',
  freqCardBorder: '#3b4f7a',
  scheduleCardBg: '#1e293b',
  iconChipActiveBg: '#1e3a5f',
};

// Keep exports for backwards compat
export const LIGHT = BASE_LIGHT;
export const DARK = BASE_DARK;

export type AccentKey = 'blue' | 'green' | 'purple' | 'orange' | 'pink';

type AccentDef = {
  label: string;
  swatch: string;
  light: Partial<ColorSet>;
  dark: Partial<ColorSet>;
  grad: readonly [string, string];
};

const ACCENT_DEFS: Record<AccentKey, AccentDef> = {
  blue: {
    label: 'ブルー',
    swatch: '#2563eb',
    light: {
      primary: '#2563eb', border: '#dbeafe', primarySoft: '#dbeafe',
      sheetBg: '#eff4ff', sheetBorder: '#93b4f5',
      freqCardBg: '#e8f0fe', freqCardBorder: '#93b4f5',
      scheduleCardBg: '#eff6ff', iconChipActiveBg: '#eff6ff',
      cellEmpty: '#eef4ff',
      termBg: '#dbeafe', termBorder: '#2563eb', termText: '#1e3a8a', procText: '#1e3a8a',
    },
    dark: {
      primary: '#60a5fa', primarySoft: '#1e3a5f',
      sheetBg: '#1a2744', sheetBorder: '#3b4f7a',
      freqCardBg: '#1a2744', freqCardBorder: '#3b4f7a',
      iconChipActiveBg: '#1e3a5f',
      termBg: '#1e3a5f', termBorder: '#60a5fa', termText: '#93c5fd', procText: '#93c5fd',
    },
    grad: ['#60a5fa', '#2563eb'],
  },
  green: {
    label: 'グリーン',
    swatch: '#16a34a',
    light: {
      primary: '#16a34a', border: '#dcfce7', primarySoft: '#dcfce7',
      sheetBg: '#f0fdf4', sheetBorder: '#86efac',
      freqCardBg: '#dcfce7', freqCardBorder: '#86efac',
      scheduleCardBg: '#f0fdf4', iconChipActiveBg: '#f0fdf4',
      cellEmpty: '#f0fdf4',
      termBg: '#dcfce7', termBorder: '#16a34a', termText: '#14532d', procText: '#14532d',
    },
    dark: {
      primary: '#4ade80', primarySoft: '#14532d',
      sheetBg: '#0d2819', sheetBorder: '#166534',
      freqCardBg: '#0d2819', freqCardBorder: '#166534',
      iconChipActiveBg: '#14532d',
      termBg: '#14532d', termBorder: '#4ade80', termText: '#86efac', procText: '#86efac',
    },
    grad: ['#4ade80', '#16a34a'],
  },
  purple: {
    label: 'パープル',
    swatch: '#7c3aed',
    light: {
      primary: '#7c3aed', border: '#ede9fe', primarySoft: '#ede9fe',
      sheetBg: '#f5f3ff', sheetBorder: '#c4b5fd',
      freqCardBg: '#ede9fe', freqCardBorder: '#c4b5fd',
      scheduleCardBg: '#f5f3ff', iconChipActiveBg: '#f5f3ff',
      cellEmpty: '#f5f3ff',
      termBg: '#ede9fe', termBorder: '#7c3aed', termText: '#4c1d95', procText: '#4c1d95',
    },
    dark: {
      primary: '#a78bfa', primarySoft: '#2e1065',
      sheetBg: '#1c1535', sheetBorder: '#4c1d95',
      freqCardBg: '#1c1535', freqCardBorder: '#4c1d95',
      iconChipActiveBg: '#2e1065',
      termBg: '#2e1065', termBorder: '#a78bfa', termText: '#c4b5fd', procText: '#c4b5fd',
    },
    grad: ['#a78bfa', '#7c3aed'],
  },
  orange: {
    label: 'オレンジ',
    swatch: '#ea580c',
    light: {
      primary: '#ea580c', border: '#ffedd5', primarySoft: '#ffedd5',
      sheetBg: '#fff7ed', sheetBorder: '#fdba74',
      freqCardBg: '#ffedd5', freqCardBorder: '#fdba74',
      scheduleCardBg: '#fff7ed', iconChipActiveBg: '#fff7ed',
      cellEmpty: '#fff7ed',
      termBg: '#ffedd5', termBorder: '#ea580c', termText: '#7c2d12', procText: '#7c2d12',
    },
    dark: {
      primary: '#fb923c', primarySoft: '#431407',
      sheetBg: '#271305', sheetBorder: '#7c2d12',
      freqCardBg: '#271305', freqCardBorder: '#7c2d12',
      iconChipActiveBg: '#431407',
      termBg: '#431407', termBorder: '#fb923c', termText: '#fdba74', procText: '#fdba74',
    },
    grad: ['#fb923c', '#ea580c'],
  },
  pink: {
    label: 'ピンク',
    swatch: '#db2777',
    light: {
      primary: '#db2777', border: '#fce7f3', primarySoft: '#fce7f3',
      sheetBg: '#fdf2f8', sheetBorder: '#f9a8d4',
      freqCardBg: '#fce7f3', freqCardBorder: '#f9a8d4',
      scheduleCardBg: '#fdf2f8', iconChipActiveBg: '#fdf2f8',
      cellEmpty: '#fdf2f8',
      termBg: '#fce7f3', termBorder: '#db2777', termText: '#831843', procText: '#831843',
    },
    dark: {
      primary: '#f472b6', primarySoft: '#500724',
      sheetBg: '#280d1c', sheetBorder: '#831843',
      freqCardBg: '#280d1c', freqCardBorder: '#831843',
      iconChipActiveBg: '#500724',
      termBg: '#500724', termBorder: '#f472b6', termText: '#f9a8d4', procText: '#f9a8d4',
    },
    grad: ['#f472b6', '#db2777'],
  },
};

export const ACCENT_LIST: { key: AccentKey; label: string; swatch: string }[] =
  (Object.keys(ACCENT_DEFS) as AccentKey[]).map((k) => ({
    key: k,
    label: ACCENT_DEFS[k].label,
    swatch: ACCENT_DEFS[k].swatch,
  }));

type GradSet = { header: readonly [string, string]; brand: readonly [string, string] };

type ThemeCtx = {
  dark: boolean;
  C: ColorSet;
  setDark: (v: boolean) => Promise<void>;
  accent: AccentKey;
  setAccent: (a: AccentKey) => Promise<void>;
  grad: GradSet;
};

const DEFAULT_GRAD: GradSet = { header: ['#60a5fa', '#2563eb'], brand: ['#60a5fa', '#2563eb'] };

const ThemeContext = createContext<ThemeCtx>({
  dark: false,
  C: BASE_LIGHT,
  setDark: async () => {},
  accent: 'blue',
  setAccent: async () => {},
  grad: DEFAULT_GRAD,
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const db = useSQLiteContext();
  const [dark, setDarkState] = useState(false);
  const [accent, setAccentState] = useState<AccentKey>('blue');

  useEffect(() => {
    Promise.all([
      getSetting(db, 'dark_mode'),
      getSetting(db, 'accent_theme'),
    ]).then(([dm, ac]) => {
      setDarkState(dm === '1');
      if (ac && ac in ACCENT_DEFS) setAccentState(ac as AccentKey);
    });
  }, [db]);

  const setDark = useCallback(async (v: boolean) => {
    setDarkState(v);
    await setSetting(db, 'dark_mode', v ? '1' : '0');
  }, [db]);

  const setAccent = useCallback(async (a: AccentKey) => {
    setAccentState(a);
    await setSetting(db, 'accent_theme', a);
  }, [db]);

  const def = ACCENT_DEFS[accent];
  const base = dark ? BASE_DARK : BASE_LIGHT;
  const C: ColorSet = { ...base, ...(dark ? def.dark : def.light) };
  const grad: GradSet = { header: def.grad, brand: def.grad };

  return (
    <ThemeContext.Provider value={{ dark, C, setDark, accent, setAccent, grad }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
