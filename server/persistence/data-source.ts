import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { InitialOrcStudioPersistence1710000000000 } from '../../db/migrations/1710000000000-InitialOrcStudioPersistence';
import { CliConversationReferenceEntity, StudioEventEntity, StudioSnapshotEntity } from './entities';
import { RuntimeEventEntity, RuntimeRoutingSettingsEntity, RuntimeRunEntity, RuntimeSessionEntity, RuntimeWorkspaceEntity } from '../runtime/entities';
import { AddNativeRuntime1791460000000 } from '../../db/migrations/1791460000000-AddNativeRuntime';
import { AddGlobalAgentRouting1791490000000 } from '../../db/migrations/1791490000000-AddGlobalAgentRouting';
import { AllowRuntimeResizeEvents1791500000000 } from '../../db/migrations/1791500000000-AllowRuntimeResizeEvents';

export function createPersistenceDataSource(url = process.env.DATABASE_URL): DataSource {
  if (!url) throw new Error('DATABASE_URL is not configured.');
  return new DataSource({
    type: 'postgres',
    url,
    entities: [StudioSnapshotEntity, StudioEventEntity, CliConversationReferenceEntity, RuntimeWorkspaceEntity, RuntimeRunEntity, RuntimeSessionEntity, RuntimeEventEntity, RuntimeRoutingSettingsEntity],
    migrations: [InitialOrcStudioPersistence1710000000000, AddNativeRuntime1791460000000, AddGlobalAgentRouting1791490000000, AllowRuntimeResizeEvents1791500000000],
    migrationsTableName: 'typeorm_migrations',
    migrationsTransactionMode: 'all',
    synchronize: false,
    migrationsRun: false,
    logging: false,
    applicationName: 'orc-studio',
  });
}

declare global {
  var __orcStudioDataSource: DataSource | undefined;
  var __orcStudioDataSourcePromise: Promise<DataSource> | undefined;
}

export async function getPersistenceDataSource(): Promise<DataSource> {
  if (globalThis.__orcStudioDataSource?.isInitialized) return globalThis.__orcStudioDataSource;
  if (!globalThis.__orcStudioDataSourcePromise) {
    globalThis.__orcStudioDataSourcePromise = createPersistenceDataSource().initialize().then(dataSource => {
      globalThis.__orcStudioDataSource = dataSource;
      return dataSource;
    }).catch(error => {
      globalThis.__orcStudioDataSourcePromise = undefined;
      throw error;
    });
  }
  return globalThis.__orcStudioDataSourcePromise;
}
