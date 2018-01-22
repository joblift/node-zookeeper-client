module.exports = {
  collectCoverageFrom: ['src/**', '!src/**/*.json'],
  coverageReporters: ['lcov', 'text'],
  setupTestFrameworkScriptFile: './test/config.js',
};
