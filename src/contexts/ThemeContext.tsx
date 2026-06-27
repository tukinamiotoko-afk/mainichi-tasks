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

export const LIGHT: ColorSet = {
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

export const DARK: ColorSet = {
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

type ThemeCtx = { dark: boolean; C: ColorSet; setDark: (v: boolean) => Promise<void> };
const ThemeContext = createContext<ThemeCtx>({ dark: false, C: LIGHT, setDark: async () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const db = useSQLiteContext();
  const [dark, setDarkState] = useState(false);

  useEffect(() => {
    getSetting(db, 'dark_mode').then((v) => setDarkState(v === '1'));
  }, [db]);

  const setDark = useCallback(async (v: boolean) => {
    setDarkState(v);
    await setSetting(db, 'dark_mode', v ? '1' : '0');
  }, [db]);

  return (
    <ThemeContext.Provider value={{ dark, C: dark ? DARK : LIGHT, setDark }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
