// src/features/social/wall/composerSlot.tsx — where WallOfFame finds the two
// composers (built in ./composers/). One indirection so the screen bundles
// while the composers are being written.
export { default as ShoutoutComposer } from './composers/ShoutoutComposer'
export { default as AppreciationComposer } from './composers/AppreciationComposer'
