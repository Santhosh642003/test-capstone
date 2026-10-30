# Ways To Use Logging System

## 1) Via a request object (Inside HttpRequest Functions)

Use this method inside HttpRequest Functions (most of the time) because:
1) you don't need to import any additional modules to use it
2) It helps the logger keep the request header data with the log records

```js
exports.myHTTPEndpointFunction = async function (req, res) {
    const { myParam } = req.query;

    req.log.trace('Trace: For ultra-detailed, short-term debugging. Meant for local use only — don’t commit this.');
    req.log.debug('Debug: For verbose debugging info that’s safe to commit, but should be off in production unless needed.');
    req.log.info('Info: Standard operational messages. This and higher levels are always logged.');
    req.log.warn('Warn: Something unexpected happened or might require attention, but the app can continue.');
    req.log.error('Error: Something went wrong. Use this for 5XXs, DB failures, and critical issues.');
    req.log.fatal('Fatal: Reserved for crashes or unrecoverable states. Don’t use this in normal code.');

    const x = await DBSendResponse('select * from company')
    res.json(x)
}
```

## 2) Via getCurrentRequestLogger()

Use this method inside of functions that don't have access to the `req` object, but still might be called within request, such as a database function like `DBSendResponse()`

Feel free to use this method even if you're unsure whether the function is tied to an HTTP request — it will automatically fall back to a default logger if no request context is available

*However* the `const log = getCurrentRequestLogger();` declaration **must be done *inside* of a function**

```js
const { getCurrentRequestLogger } = require('../loggerContext');

...

exports.DBSendResponse = async function (query) {
  const log = getCurrentRequestLogger();
  
  const request = new db.Request();
  log.debug('DBSendResponse Query: ' + query)

  try {
    const result = await request.query(query);
    return result.recordset;
  } catch (err) {
    err.query = query;
    log.error(err, 'An error occurred during a \'DBSendResponse\' query')
  }
}
```

## 3) When in doubt, you can always use the default logger

Useful for things outside of functions or that are not associated to any requests like some cron jobs, app-level boilerplate, etc

```js
const { defaultLogger } = require('../logger')

defaultLogger.info('Hello World')
```

You can also rename it during import if you prefer a shorter or more convenient name when using the module


```js
const { defaultLogger: logger } = require('../logger')

logger.info('Hello World')
```
