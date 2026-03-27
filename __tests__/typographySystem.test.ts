import { ThemeTokens } from '../src/constants/ThemeTokens';
import {
  getTypographyMaxFontSizeMultiplier,
  getTypographyStyle,
  typographyVariants,
} from '../src/theme/typography';

describe('typography system', () => {
  it('keeps modal hierarchy clearer than body copy', () => {
    expect(typographyVariants.modalTitle.fontSize).toBeGreaterThan(
      typographyVariants.modalBody.fontSize,
    );
    expect(typographyVariants.modalTitle.lineHeight).toBeGreaterThan(
      typographyVariants.modalBody.lineHeight,
    );
  });

  it('returns centralized text metrics with explicit font family', () => {
    const style = getTypographyStyle('body', { color: '#111111' });

    expect(style.fontFamily).toBeTruthy();
    expect(style.fontSize).toBe(typographyVariants.body.fontSize);
    expect(style.lineHeight).toBe(typographyVariants.body.lineHeight);
    expect(style.color).toBe('#111111');
  });

  it('supports weight overrides for action text without local hardcoding', () => {
    const style = getTypographyStyle('modalAction', { weight: 'bold' });

    expect(style.fontWeight).toBe(ThemeTokens.typography.weights.bold);
    expect(getTypographyMaxFontSizeMultiplier('modalAction')).toBeGreaterThan(
      1.3,
    );
  });
});
