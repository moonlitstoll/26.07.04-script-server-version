/* global __BUILD_ID__ */
// vite.config.js의 define으로 빌드 시 주입되는 이 빌드의 고유 ID (dev에서는 'dev').
export const BUILD_ID = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev';
