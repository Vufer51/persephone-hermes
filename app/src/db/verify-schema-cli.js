import { loadDatabaseConfig } from '../config/index.js';
import { createPool } from './pool.js';
import { verifySchema } from './verify-schema.js';

let config;
try {
  config = loadDatabaseConfig();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const pool = createPool({ url: config.url, max: 1, applicationName: 'persephone-verify-schema' });

try {
  const result = await verifySchema(pool);

  if (result.missingTables.length > 0) {
    console.error(`Отсутствуют таблицы: ${result.missingTables.join(', ')}`);
  }
  if (result.missingExtensions.length > 0) {
    console.error(`Отсутствуют расширения: ${result.missingExtensions.join(', ')}`);
  }
  if (result.missingIndexes.length > 0) {
    console.error(`Отсутствуют индексы: ${result.missingIndexes.join(', ')}`);
  }
  if (result.unexpectedTables.length > 0) {
    console.warn(`Посторонние таблицы в public: ${result.unexpectedTables.join(', ')}`);
  }

  if (result.ok) {
    console.log('Схема соответствует ожидаемой.');
  } else {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`Ошибка проверки схемы: ${error.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
