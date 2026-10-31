import { loadDatabaseConfig } from '../config/index.js';
import { createPool } from './pool.js';
import { getMigrationStatus, runMigrations } from './migrate.js';

const command = process.argv[2] ?? 'up';

if (!['up', 'status'].includes(command)) {
  console.error(`Неизвестная команда: ${command}. Допустимо: up, status`);
  process.exit(1);
}

let config;
try {
  config = loadDatabaseConfig();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const pool = createPool({ url: config.url, max: config.poolMax, applicationName: 'persephone-migrate' });

try {
  if (command === 'status') {
    const status = await getMigrationStatus({ pool });
    console.log(`Таблица ${'schema_migrations'}: ${status.tableExists ? 'есть' : 'нет'}`);
    for (const migration of status.migrations) {
      console.log(`${migration.filename}: ${migration.applied ? 'применена' : 'ожидает'}`);
    }
    console.log(`Ожидают применения: ${status.pending}`);
    if (status.appliedNotOnDisk.length > 0) {
      console.error('Применены, но отсутствуют на диске:');
      for (const record of status.appliedNotOnDisk) {
        console.error(`  ${record.version}_${record.name}`);
      }
      process.exitCode = 1;
    }
  } else {
    const result = await runMigrations({ pool, logger: console });
    if (result.applied.length > 0) {
      console.log(`Применено миграций: ${result.applied.length}`);
      for (const filename of result.applied) {
        console.log(`  ${filename}`);
      }
    } else {
      console.log(`Новых миграций нет (всего ${result.total}).`);
    }
  }
} catch (error) {
  console.error(`Ошибка миграций: ${error.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
