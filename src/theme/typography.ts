import { Platform, type TextStyle } from 'react-native';

import { ThemeTokens } from '../constants/ThemeTokens';

export type AppTextVariant =
  | 'display'
  | 'hero'
  | 'largeTitle'
  | 'title1'
  | 'title2'
  | 'title3'
  | 'headline'
  | 'body'
  | 'callout'
  | 'subhead'
  | 'footnote'
  | 'caption1'
  | 'caption2'
  | 'button'
  | 'label'
  | 'input'
  | 'modalTitle'
  | 'modalBody'
  | 'modalAction'
  | 'chip';

export type AppTextWeight = 'regular' | 'medium' | 'semibold' | 'bold';

type TypographyVariant = Readonly<{
  fontSize: number;
  lineHeight: number;
  fontWeight: TextStyle['fontWeight'];
  letterSpacing: number;
  maxFontSizeMultiplier: number;
}>;

const fontFamily =
  Platform.OS === 'ios'
    ? ThemeTokens.typography.families.ios
    : ThemeTokens.typography.families.android;

const weights = ThemeTokens.typography.weights;

export const typographyVariants: Record<AppTextVariant, TypographyVariant> = {
  display: {
    fontSize: 40,
    lineHeight: 46,
    fontWeight: weights.bold,
    letterSpacing: -0.8,
    maxFontSizeMultiplier: 1.35,
  },
  hero: {
    fontSize: 34,
    lineHeight: 40,
    fontWeight: weights.bold,
    letterSpacing: -0.62,
    maxFontSizeMultiplier: 1.45,
  },
  largeTitle: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: weights.bold,
    letterSpacing: -0.48,
    maxFontSizeMultiplier: 1.5,
  },
  title1: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: weights.bold,
    letterSpacing: -0.34,
    maxFontSizeMultiplier: 1.45,
  },
  title2: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: weights.bold,
    letterSpacing: -0.22,
    maxFontSizeMultiplier: 1.4,
  },
  title3: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: weights.semibold,
    letterSpacing: -0.14,
    maxFontSizeMultiplier: 1.4,
  },
  headline: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: weights.semibold,
    letterSpacing: -0.08,
    maxFontSizeMultiplier: 1.55,
  },
  body: {
    fontSize: 17,
    lineHeight: 24,
    fontWeight: weights.regular,
    letterSpacing: -0.08,
    maxFontSizeMultiplier: 2,
  },
  callout: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: weights.regular,
    letterSpacing: -0.06,
    maxFontSizeMultiplier: 1.9,
  },
  subhead: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: weights.regular,
    letterSpacing: -0.04,
    maxFontSizeMultiplier: 1.85,
  },
  footnote: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: weights.regular,
    letterSpacing: -0.02,
    maxFontSizeMultiplier: 1.75,
  },
  caption1: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: weights.medium,
    letterSpacing: 0,
    maxFontSizeMultiplier: 1.7,
  },
  caption2: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: weights.medium,
    letterSpacing: 0.02,
    maxFontSizeMultiplier: 1.65,
  },
  button: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: weights.semibold,
    letterSpacing: -0.08,
    maxFontSizeMultiplier: 1.45,
  },
  label: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: weights.semibold,
    letterSpacing: 0.01,
    maxFontSizeMultiplier: 1.55,
  },
  input: {
    fontSize: 17,
    lineHeight: 24,
    fontWeight: weights.medium,
    letterSpacing: -0.08,
    maxFontSizeMultiplier: 1.8,
  },
  modalTitle: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: weights.bold,
    letterSpacing: -0.28,
    maxFontSizeMultiplier: 1.4,
  },
  modalBody: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: weights.regular,
    letterSpacing: -0.04,
    maxFontSizeMultiplier: 1.9,
  },
  modalAction: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: weights.semibold,
    letterSpacing: -0.08,
    maxFontSizeMultiplier: 1.35,
  },
  chip: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: weights.semibold,
    letterSpacing: 0.04,
    maxFontSizeMultiplier: 1.35,
  },
};

export const getTypographyStyle = (
  variant: AppTextVariant,
  options?: {
    weight?: AppTextWeight;
    color?: string;
    textAlign?: TextStyle['textAlign'];
  },
): TextStyle => {
  const definition = typographyVariants[variant];

  return {
    fontFamily,
    fontSize: definition.fontSize,
    lineHeight: definition.lineHeight,
    fontWeight: options?.weight ? weights[options.weight] : definition.fontWeight,
    letterSpacing: definition.letterSpacing,
    color: options?.color,
    textAlign: options?.textAlign,
    includeFontPadding: false,
  };
};

export const getTypographyMaxFontSizeMultiplier = (
  variant: AppTextVariant,
): number => typographyVariants[variant].maxFontSizeMultiplier;

export const appFontFamily = fontFamily;
