const { AsyncLocalStorage } = require('async_hooks');
const asyncLocalStorage = new AsyncLocalStorage();
const { defaultLogger } = require('./logger');

function withRequestLogger(logger, callback) {
  asyncLocalStorage.run(new Map([['logger', defaultLogger]]), callback);
}

function getCurrentRequestLogger() {
  const store = asyncLocalStorage.getStore();
  return store?.get('logger') ? store.get('logger') : defaultLogger;
}

module.exports = {
  withRequestLogger,
  getCurrentRequestLogger
};
