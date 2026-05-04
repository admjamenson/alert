module.exports = {
  preset: 'react-native',
  setupFiles: ['<rootDir>/jest.setup.js'],
  modulePathIgnorePatterns: [
    '<rootDir>/android/ndk/',
    '<rootDir>/android-sdk/',
  ],
  testPathIgnorePatterns: ['<rootDir>/backend/'],
  moduleNameMapper: {
    '^react-native/Libraries/Animated/NativeAnimatedHelper$':
      '<rootDir>/jest.nativeAnimatedMock.js',
    '^react-native/libraries/Animated/NativeAnimatedHelper$':
      '<rootDir>/jest.nativeAnimatedMock.js',
    '^react-native-config$': '<rootDir>/__mocks__/reactNativeConfig.js',
    '\\.(png|jpg|jpeg|gif|svg)$': '<rootDir>/__mocks__/fileMock.js',
  },
};
