const sql = require('mssql')
const { APIDB, DB_SERVER, DB_USERNAME, DB_PWD } = require('../config')
const { defaultLogger: logger } = require('../logger')
const config = {
  user: DB_USERNAME,
  password: DB_PWD,
  server: DB_SERVER,
  database: APIDB,
  options: {
    enableArithAbort: false, //probably set this to true in the future after testing
    //encrypt: true // probably set this to true in the future after testing
  }
}

sql.connect(config, function (err) {
  if (err) {
    console.log(err)
    // res.send("{'output':500,'message':'DB connection error'}")
  } else {
    logger.info('Established Connection to SQL Server: ' + config.database)
  }
})

module.exports = sql
