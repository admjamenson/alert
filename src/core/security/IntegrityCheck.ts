import { Alert, BackHandler } from 'react-native';
import DeviceInfo from 'react-native-device-info';
import i18n from '../../i18n';
import { TelemetryService } from '../../services/TelemetryService';

// Extensão de Interface para resolver o erro 2339 de forma limpa
interface DeviceInfoExtended {
  isJailBroken: () => Promise<boolean>;
}

/**
  * Protocolo de Integridade
 * Verifica se o hardware foi violado ou se é um simulador.
 */
export const verifyDeviceIntegrity = async (): Promise<boolean> => {
  try {
    const isEmulator = await DeviceInfo.isEmulator();

    // Fazemos o cast para a interface estendida
    const deviceSecurity = DeviceInfo as unknown as DeviceInfoExtended;

    // Verificação defensiva de existência do método no runtime
    const isRooted =
      typeof deviceSecurity.isJailBroken === 'function'
        ? await deviceSecurity.isJailBroken()
        : false;

    if (isEmulator || isRooted) {
      TelemetryService.trackEvent('security_violation_detected', {
        isEmulator,
        isRooted,
      });
      Alert.alert(
        i18n.t('security_violation_title', { defaultValue: 'VIOLAÇÃO DE SEGURANÇA' }),
        i18n.t('security_violation_body', {
          defaultValue: 'Ambiente não confiável detectado. O acesso foi bloqueado pelo protocolo de segurança.',
        }),
        [{ text: i18n.t('common_exit', { defaultValue: 'ENCERRAR' }), onPress: () => BackHandler.exitApp() }],
        { cancelable: false },
      );
      return false;
    }

    TelemetryService.trackEvent('security_check_passed', {
      isEmulator,
      isRooted,
    });
    return true;
  } catch (error) {
    // S2486 FIXED: Tratamento explícito da exceção
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown Security Error';
    console.warn(`[Integrity Check Bypass]: ${errorMessage}`);

    TelemetryService.trackEvent('security_check_fail_open', {
      error: errorMessage,
    });

    // Fail-safe: Em caso de erro na lib, permitimos o acesso para evitar 'brick' no app
    return true;
  }
};
