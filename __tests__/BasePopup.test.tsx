import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import renderer, { act } from 'react-test-renderer';

import BasePopup from '../src/components/ui/BasePopup';

jest.mock('../src/context/ThemeContext', () => ({
  useTheme: () => ({
    isDark: false,
    colors: {
      card: '#FFFFFF',
      primary: '#D32F2F',
      text: '#111111',
      textSecondary: '#666666',
      border: '#E6E6E6',
    },
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

describe('BasePopup', () => {
  it('dismisses from the backdrop without leaking through content presses', () => {
    const onClose = jest.fn();
    const insidePress = jest.fn();
    let tree: renderer.ReactTestRenderer;

    act(() => {
      tree = renderer.create(
        <BasePopup visible onClose={onClose} testID="popup-content">
          <TouchableOpacity testID="inside-action" onPress={insidePress}>
            <Text>Popup body</Text>
          </TouchableOpacity>
        </BasePopup>,
      );
    });

    const insideAction = tree!.root.findByProps({ testID: 'inside-action' });

    act(() => {
      insideAction.props.onPress();
    });

    expect(insidePress).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    const backdrop = tree!.root.findByProps({ accessibilityLabel: 'Close popup' });

    act(() => {
      backdrop.props.onPress();
    });

    expect(onClose).toHaveBeenCalledTimes(1);

    act(() => {
      tree!.unmount();
    });
  });
});
