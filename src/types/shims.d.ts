declare module '*.png' {
  const value: number;
  export default value;
}

declare module 'pako' {
  const value: any;
  export default value;
}

declare module 'crypto-js' {
  const value: any;
  export default value;
}

declare module 'react-native-mmkv' {
  export const MMKV: any;
}

declare module 'react-native-config' {
  const Config: Record<string, string | undefined>;
  export default Config;
}

declare const AudioRecorderPlayer: any;
declare const AudioSourceAndroidType: any;
declare const OutputFormatAndroidType: any;
declare const AudioEncoderAndroidType: any;
declare const AVModeIOSOption: any;
declare const AVEncodingOption: any;
declare const AVEncoderAudioQualityIOSType: any;
