/**
 * Пути, которые никогда не должны попадать в логи.
 * Используется как redact-конфигурация pino.
 */
export const REDACTED_LOG_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  'password',
  '*.password',
  'passwordHash',
  '*.passwordHash',
  'sessionKey',
  '*.sessionKey',
  'token',
  '*.token',
  'secret',
  '*.secret',
  'apiKey',
  '*.apiKey',
  'sharedSecret',
  '*.sharedSecret',
  'encryptionKey',
  '*.encryptionKey',
  'sessionSecret',
  '*.sessionSecret',
];

/**
 * @param {{ logLevel: string }} config
 */
export function createLoggerOptions(config) {
  return {
    level: config.logLevel,
    redact: {
      paths: REDACTED_LOG_PATHS,
      censor: '[redacted]',
    },
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
    formatters: {
      level(label) {
        return { level: label };
      },
    },
  };
}
