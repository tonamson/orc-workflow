import 'dotenv/config';
import { getPersistenceDataSource } from '../../server/persistence/data-source';

const command = process.argv[2] ?? 'status';
const dataSource = await getPersistenceDataSource();
try {
  if (command === 'up') {
    const migrations = await dataSource.runMigrations();
    console.log(migrations.length ? `Applied ${migrations.length} migration(s).` : 'Database schema is current.');
  } else if (command === 'down') {
    await dataSource.undoLastMigration();
    console.log('Reverted the latest migration, if present.');
  } else if (command === 'status') {
    const executed = await dataSource.showMigrations();
    console.log(executed ? 'Pending migrations exist.' : 'All migrations are applied.');
  } else throw new Error(`Unknown migration command: ${command}`);
} finally { await dataSource.destroy(); }
