const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');
const exclusionList = require('metro-config/src/defaults/exclusionList');

const generatedPathBlockList = [
  /.*\/\.gradle(?:-[^/]+)?\/.*/,
  /.*\/android-sdk\/.*/,
  /.*\/android\/ndk\/.*/,
  /.*\/android\/(?:app\/)?build\/.*/,
  /.*\/artifacts\/.*/,
  /.*\/billing-web\/dist\/.*/,
  /.*\/(?:tmp|tmp_apk|_cmake_test|_ninja_test|_tmp)\/.*/,
];

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('metro-config').MetroConfig}
 */
const config = {
  resolver: {
    blockList: exclusionList(generatedPathBlockList),
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
