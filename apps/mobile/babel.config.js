module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    // Reanimated 4 split its Babel plugin out into react-native-worklets;
    // must be listed last per the library's setup docs.
    plugins: ["react-native-worklets/plugin"],
  };
};
