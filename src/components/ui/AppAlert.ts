import {
  Alert as NativeAlert,
  type AlertButton,
  type AlertOptions,
} from 'react-native';

import type { BasePopupPlacement } from './BasePopup';

export type AppAlertRequest = {
  id: number;
  title: string;
  message?: string;
  buttons: AlertButton[];
  options?: AlertOptions;
  placement: BasePopupPlacement;
};

type AlertPresenter = (request: AppAlertRequest) => void;
type NativeAlertType = typeof NativeAlert.alert;

const originalAlert = NativeAlert.alert.bind(NativeAlert) as NativeAlertType;

let presenter: AlertPresenter | null = null;
let installed = false;
let nextId = 1;

const normalizeButtons = (buttons?: AlertButton[]): AlertButton[] => {
  if (Array.isArray(buttons) && buttons.length > 0) {
    return buttons;
  }
  return [{ text: 'OK', style: 'default' }];
};

const resolvePlacement = (
  message: string | undefined,
  buttons: AlertButton[],
): BasePopupPlacement => {
  const hasBody = typeof message === 'string' && message.trim().length > 0;
  return !hasBody && buttons.length > 2 ? 'bottom' : 'center';
};

const buildRequest = (
  title: string,
  message?: string,
  buttons?: AlertButton[],
  options?: AlertOptions,
): AppAlertRequest => {
  const normalizedButtons = normalizeButtons(buttons);
  return {
    id: nextId++,
    title: String(title || ''),
    message,
    buttons: normalizedButtons,
    options,
    placement: resolvePlacement(message, normalizedButtons),
  };
};

export const installAppAlertPresenter = (nextPresenter: AlertPresenter) => {
  presenter = nextPresenter;

  if (!installed) {
    (NativeAlert as { alert: NativeAlertType }).alert = ((
      title: string,
      message?: string,
      buttons?: AlertButton[],
      options?: AlertOptions,
    ) => {
      if (presenter) {
        presenter(buildRequest(title, message, buttons, options));
        return;
      }
      originalAlert(title, message, buttons, options);
    }) as NativeAlertType;
    installed = true;
  }

  return () => {
    if (presenter === nextPresenter) {
      presenter = null;
    }
  };
};

export const showAppAlert = (
  title: string,
  message?: string,
  buttons?: AlertButton[],
  options?: AlertOptions,
) => {
  if (presenter) {
    presenter(buildRequest(title, message, buttons, options));
    return;
  }
  originalAlert(title, message, buttons, options);
};

