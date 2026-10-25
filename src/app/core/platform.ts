/** True in the macOS build (WebKit reports "MacIntel" there, on Apple Silicon too). */
export const IS_MAC = /mac/i.test(navigator.platform || navigator.userAgent);

/** The tab-switch modifier: Cmd on a Mac, Ctrl elsewhere. */
export const MOD_KEY = IS_MAC ? '⌘' : 'Ctrl+';
