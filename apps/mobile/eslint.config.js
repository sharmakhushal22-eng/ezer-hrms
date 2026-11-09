// eslint.config.js — the app's own lint (the website's root config ignores apps/).
const { defineConfig } = require('eslint/config')
const expoConfig = require('eslint-config-expo/flat')

module.exports = defineConfig([
  expoConfig,
  { ignores: ['dist/*', '.expo/*', 'node_modules/*'] },
])
