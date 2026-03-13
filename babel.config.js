module.exports = function (api) {
    api.cache(true);
    return {
        presets: [
            ['babel-preset-expo', { unstable_transformImportMeta: true }],
        ],
        plugins: [
            // react-native-reanimated는 반드시 마지막에 위치
            'react-native-reanimated/plugin',
        ],
    };
};
