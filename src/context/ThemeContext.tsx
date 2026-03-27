/**
 * THEME CONTEXT - App Styling Configuration
 *
 * Centralized theme management (light/dark/system modes).
 * Provides consistent color palette across all screens.
 *
 * COLOR PALETTE:
 * - Light mode: white base with Alert red accent
 * - Dark mode: modern black (#111111) with restrained dark surfaces
 * - Risk colors: universal across modes (red=danger, yellow=warning, green=safe)
 *
 * MODE LOGIC:
 * - system: Uses device preference (Settings > Display > Dark Mode)
 * - light: Forces light theme (overrides system preference)
 * - dark: Forces dark theme (overrides system preference)
 *
 * PERFORMANCE:
 * - useMemo caching: Recompute only on actual color changes
 * - No re-render overhead: Consumer components use shallow equality
 * - Batch updates: Single setThemeMode() applies to entire app
 *
 * PERSISTENCE:
 * - Stored in AsyncStorage via SettingScreen (not in context)
 * - Restored on app launch via App.tsx initialization
 *
 * ACCESSIBILITY:
 * - Contrast ratio > 4.5:1 (WCAG AA standard)
 * - Primary color: #E61C24 on light/dark
 * - Risk indicators: Color + labels (not color-only)
 */

import React, { createContext, useContext, useState, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { ThemeTokens } from '../constants/ThemeTokens';

const palette = ThemeTokens.colors;

type ThemeMode = 'light' | 'dark' | 'system';
type ThemeColors = Record<keyof typeof palette.light, string>;

interface ThemeContextData {
  isDark: boolean;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  colors: ThemeColors;
}

export const ThemeContext = createContext<ThemeContextData>(
  {} as ThemeContextData,
);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const systemColorScheme = useColorScheme();
  const [themeMode, setThemeMode] = useState<ThemeMode>('system');

  const isDark = useMemo(() => {
    return themeMode === 'system'
      ? systemColorScheme === 'dark'
      : themeMode === 'dark';
  }, [themeMode, systemColorScheme]);

  const colors = useMemo(
    () => (isDark ? palette.dark : palette.light),
    [isDark],
  );

  const value = useMemo(
    () => ({ isDark, themeMode, setThemeMode, colors }),
    [isDark, themeMode, colors],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within a ThemeProvider');
  return context;
};
