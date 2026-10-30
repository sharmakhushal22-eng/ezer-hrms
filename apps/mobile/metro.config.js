// metro.config.js — lets the app import pure business logic straight from the
// website's lib/ folder (`@web/...`, see tsconfig.json) instead of copying it.
//
// Only dependency-free modules may be shared this way: a calculation, a
// validation regex, a constant table. Anything that imports supabase, next/*,
// server-only code or the DOM stays on the website (scripts/check-shared.mjs
// enforces this).
const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const config = getDefaultConfig(__dirname)
const webLib = path.resolve(__dirname, '../../lib')

config.watchFolders = [webLib]
// A shared file's own imports must resolve to THIS app's packages, never the
// website's node_modules (a second React would break hooks).
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')]

module.exports = config
