const fs = require('fs');
const path = require('path');
const pino = require('pino');
const pinoHttp = require('pino-http');
const rfs = require('rotating-file-stream');
const azureStorage = require('azure-storage');
const https = require('https');
const { LOGGING_METHOD, LOGGING_LEVEL, BLOB_KEY, CONTAINER_NAME, env } = require('./config');
const { connect } = require('http2');

const loggingMethod = LOGGING_METHOD || 'console';
const loggingLevel = LOGGING_LEVEL || 'info';
const { v4: uuidv4 } = require('uuid');

const customLevels = {
  fatal: 60,
  error: 50,
  warn: 40,
  info: 30,
  database: 25, // custom level
  debug: 20,
  trace: 10
};

// New Relic Logger Class
class NewRelicLogger {
  constructor(apiKey, bufferSize = 500, flushInterval = 180000) { // flush to NewRelic after {buffersize} # of logs or {flushInterval} ms
    this.apiKey = apiKey;
    this.logBuffer = [];
    this.bufferSize = bufferSize;
    this.flushInterval = flushInterval;
    this.isUploading = false;
    
    // Start periodic flush
    this.startPeriodicFlush();
  }

  addLog(logEntry) {
    // Convert log entry to New Relic format
    const newRelicLog = {
      timestamp: logEntry.timestamp || new Date().toISOString(),
      level: logEntry.level,
      message: logEntry.msg || logEntry.message,
      service: 'fieldworkerAPI',
      environment: env,
      ...logEntry
    };
    
    this.logBuffer.push(newRelicLog);
    
    // Flush if buffer is full
    if (this.logBuffer.length >= this.bufferSize) {
      this.flushLogs();
    }
  }

  startPeriodicFlush() {
    setInterval(() => {
      if (this.logBuffer.length > 0) {
        this.flushLogs();
      }
    }, this.flushInterval);
  }

  async flushLogs() {
    if (this.isUploading || this.logBuffer.length === 0) return;
    
    this.isUploading = true;
    const logsToSend = [...this.logBuffer];
    this.logBuffer = [];

    try {
      await this.sendToNewRelic(logsToSend);
      console.log(`Successfully sent ${logsToSend.length} logs to New Relic`);
    } catch (err) {
      console.error('Failed to send logs to New Relic:', err);
      // Re-add failed logs to buffer for retry
      this.logBuffer.unshift(...logsToSend);
    } finally {
      this.isUploading = false;
    }
  }

  async sendToNewRelic(logs) {
    const payload = JSON.stringify(logs);
    
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'log-api.newrelic.com',
        port: 443,
        path: '/log/v1',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'Api-Key': this.apiKey
        }
      };

      const req = https.request(options, (res) => {
        let responseData = '';
        res.on('data', (chunk) => {
          responseData += chunk;
        });
        
        res.on('end', () => {
          if (res.statusCode === 202) {
            resolve();
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${responseData}`));
          }
        });
      });

      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }
}

// Initialize New Relic logger
const newRelicLogger = new NewRelicLogger('3a031eb9c5105f61a40ed9e01a954a61FFFFNRAL');


let logger;
let loggerMiddleware;
let logStream;

function sanitizeHeaders(headers) {
  const sanitizedHeaders = { ...headers };
  const fieldsToRemove = [
    'authorization',
    'x-ms-client-principal',
    'x-ms-token-aad-access-token',
    'x-ms-token-aad-refresh-token',
    'x-ms-token-aad-id-token',
    'x-ms-token-aad-expires-on',   // Token timing info
    'x-ms-auth-internal-token',    // Azure App Service internal auth token
    'cookie',
    'if-none-match',
    'max-forwards',
    'access-control-allow-credential',
    'access-control-allow-origin',
    'x-arr-log-id',
    'was-default-hostname',
    'x-forwarded-proto',
    'x-appservice-proto',
    'x-arr-ssl',
    'x-forwarded-tlsversion',
    'x-forwarded-for',
    'x-original-url',
    'x-waws-unencoded-url',
    'x-client-port',
    'x-ms-client-principal-id',
    'x-ms-client-principal-idp',
    'client-ip',                   // Client IP addresses
    'x-client-ip',                 // Client IP addresses
    'x-powered-by',                // Framework/server info
    'etag',
    'traceparent',
    'content-length',
    'connection',
    'accept-encoding'
  ];

  fieldsToRemove.forEach(field => delete sanitizedHeaders[field]);
  return sanitizedHeaders;
}

function generateLogFilename(time, index) {
  if (!time) return 'fieldworkerAPI.log';
  const timestamp = new Date().toISOString().replace(/:/g, '-');
  return `${timestamp}-fieldworkerAPI-${index}.log.gz`;
}

if (loggingMethod === 'local' || loggingMethod === 'blob') {
  const logDirectory = path.join(__dirname, 'logs');
  if (!fs.existsSync(logDirectory)) {
    fs.mkdirSync(logDirectory, { recursive: true });
  }

  logStream = rfs.createStream(generateLogFilename, {
    size: '25M', // Rotate every 25MB
    interval: '1d', // Rotate daily
    compress: 'gzip',
    path: logDirectory
  });

  // Create a custom stream that sends logs to both file and New Relic
  const customStream = {
    write: (logLine) => {
      // Write to file stream
      logStream.write(logLine);
      
      // Parse and send to New Relic
      try {
        const logEntry = JSON.parse(logLine);
        newRelicLogger.addLog(logEntry);
      } catch (err) {
        console.error('Error parsing log for New Relic:', err);
      }
    }
  };

  logger = pino({
    level: loggingLevel || 'info',
    customLevels: customLevels,
    timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
    formatters: {
      level: (label) => {
        return { level: label.toUpperCase() };
      },
    },
  }, customStream);

  loggerMiddleware = pinoHttp({
    logger,
    genReqId: (req) => uuidv4(),
    customLogLevel: (req, res, err) => {
      if (res.statusCode >= 500) {
        return 'error';
      } else if (res.statusCode >= 400) {
        return 'warn';
      }
      return 'info';
    },
    serializers: {
      req: (req) => {
        const { remoteAddress, remotePort, ...sanitizedReq } = req;
        return {
          ...sanitizedReq,
          headers: sanitizeHeaders(req.headers),
        };
      },
      res: (res) => {
        return {
          ...res,
          headers: sanitizeHeaders(res.headers),
        };
      },
    }
  });

  if (loggingMethod === 'blob') {
    const blobService = azureStorage.createBlobService(
      `DefaultEndpointsProtocol=https;AccountName=fieldworkblob;AccountKey=${BLOB_KEY};EndpointSuffix=core.windows.net`
    );

    async function uploadLogFiles() {
      console.log('Uploading log files to Azure Blob Storage');
      const files = fs.readdirSync(logDirectory).filter(file => file.endsWith('.gz'));

      const uploadPromises = files.map(file => {
        const filePath = path.join(logDirectory, file);
        const blobName = `logs/${file}`;

        return new Promise((resolve) => {
          blobService.createBlockBlobFromLocalFile(
            CONTAINER_NAME,
            blobName,
            filePath,
            (err) => {
              if (!err) {
                fs.unlinkSync(filePath);
              } else {
                console.error('Error uploading log file to Azure Blob Storage:', err);
              }
              resolve(); // Always resolve to continue even if error occurs
            }
          );
        });
      });

      await Promise.all(uploadPromises);
    }

    async function cleanupOldLogs() {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 14); // delete logs older than 14 days

      blobService.listBlobsSegmentedWithPrefix(CONTAINER_NAME, 'logs/', null, (err, result) => {
        if (err) {
          console.error('Error listing blobs in Azure Blob Storage:', err);
          return;
        }

        const blobs = result.entries;
        for (const blob of blobs) {
          const blobDate = new Date(blob.lastModified);
          if (blobDate < cutoffDate) {
            blobService.deleteBlob(CONTAINER_NAME, blob.name, (err) => {
              if (err) {
                console.error('Error deleting old log file from Azure Blob Storage:', err);
              }
            });
          }
        }
      });
    }

    let isUploading = false;

    setInterval(async () => {
      if (isUploading) return;
      isUploading = true;
      try {
        await uploadLogFiles();
        await cleanupOldLogs();
      } catch (err) {
        logger.error(err, 'Error in periodic log upload/cleanup');
        console.log('Error in periodic log upload/cleanup:', err);
      } finally {
        isUploading = false;
      }
    }, 300000);// Check and upload logs every 5 minutes

    process.on('exit', async () => {
      console.log('Exiting process');
      try{
        await newRelicLogger.flushLogs();
        await uploadLogFiles();
        await cleanupOldLogs();
      } catch(err){
        console.error('Error during exit log handling:', err);
      }
    });
    process.on('SIGINT', async () => {
      console.log('Received SIGINT signal');
      await newRelicLogger.flushLogs();
      await uploadLogFiles();
      await cleanupOldLogs();
      process.exit(0);
    });
    process.on('SIGTERM', async () => {
      console.log('Received SIGTERM signal');
      await newRelicLogger.flushLogs();
      await uploadLogFiles();
      await cleanupOldLogs();
      process.exit(0);
    });
    process.on('uncaughtException', async (err) => {
      console.log('Uncaught Exception:', err);
      logger.fatal(err, 'Uncaught Exception');
      await newRelicLogger.flushLogs();
      await uploadLogFiles();
      await cleanupOldLogs();
      process.exit(1);
    });
    process.on('unhandledRejection', async (reason, promise) => {
      console.log('Unhandled Rejection at:', promise, 'reason:', reason);
      logger.fatal(reason, 'Unhandled Rejection');
      await newRelicLogger.flushLogs();
      await uploadLogFiles();
      await cleanupOldLogs();
      process.exit(1);
    });
  }
} else {
  // Create a custom stream that sends logs to New Relic for console logging
  const consoleStream = {
    write: (logLine) => {
      // Write to console
      process.stdout.write(logLine);
      
      // Parse and send to New Relic
      try {
        const logEntry = JSON.parse(logLine);
        newRelicLogger.addLog(logEntry);
      } catch (err) {
        console.error('Error parsing log for New Relic:', err);
      }
    }
  };

  logger = pino({
    level: loggingLevel || 'info',
    customLevels: customLevels,
    timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
    formatters: {
      level: (label) => {
        return { level: label.toUpperCase() };
      },
    },
  }, consoleStream);

  loggerMiddleware = pinoHttp({
    logger,
    genReqId: (req) => uuidv4(),
    customLogLevel: (req, res, err) => {
      if (res.statusCode >= 500) {
        return 'error';
      } else if (res.statusCode >= 400) {
        return 'warn';
      }
      return 'info';
    },
    serializers: {
      req: (req) => {
        const { remoteAddress, remotePort, ...sanitizedReq } = req;
        return {
          ...sanitizedReq,
          headers: sanitizeHeaders(req.headers),
        };
      },
      res: (res) => {
        return {
          ...res,
          headers: sanitizeHeaders(res.headers),
        };
      },
    }
  });
}

module.exports = {
  defaultLogger: logger,
  loggerMiddleware,
  newRelicLogger
};
