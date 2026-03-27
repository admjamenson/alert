import React from 'react';
import {
  Text,
  type StyleProp,
  type TextProps,
  type TextStyle,
} from 'react-native';

import { useTheme } from '../../context/ThemeContext';
import {
  getTypographyMaxFontSizeMultiplier,
  getTypographyStyle,
  type AppTextVariant,
  type AppTextWeight,
} from '../../theme/typography';

type AppTextTone =
  | 'default'
  | 'secondary'
  | 'muted'
  | 'primary'
  | 'danger'
  | 'inverse'
  | 'inverseSecondary'
  | 'success';

type AppTextProps = TextProps & {
  variant?: AppTextVariant;
  tone?: AppTextTone;
  weight?: AppTextWeight;
  style?: StyleProp<TextStyle>;
};

const getToneColor = (
  tone: AppTextTone,
  colors: ReturnType<typeof useTheme>['colors'],
): string => {
  switch (tone) {
    case 'secondary':
    case 'muted':
      return colors.textSecondary;
    case 'primary':
      return colors.primary;
    case 'danger':
      return colors.alert;
    case 'inverse':
      return '#FFFFFF';
    case 'inverseSecondary':
      return 'rgba(255,255,255,0.78)';
    case 'success':
      return colors.safe;
    case 'default':
    default:
      return colors.text;
  }
};

const AppText: React.FC<AppTextProps> = ({
  variant = 'body',
  tone = 'default',
  weight,
  style,
  allowFontScaling = true,
  maxFontSizeMultiplier,
  ...rest
}) => {
  const { colors } = useTheme();

  return (
    <Text
      allowFontScaling={allowFontScaling}
      maxFontSizeMultiplier={
        maxFontSizeMultiplier ?? getTypographyMaxFontSizeMultiplier(variant)
      }
      style={[
        getTypographyStyle(variant, {
          color: getToneColor(tone, colors),
          weight,
        }),
        style,
      ]}
      {...rest}
    />
  );
};

export default AppText;
