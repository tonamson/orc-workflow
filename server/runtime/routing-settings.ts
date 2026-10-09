import type { DataSource } from 'typeorm';
import { createDefaultRoutingPolicy, parseRoutingPolicy, ROUTING_PROVIDERS, type RoutingPolicy, type RoutingSettingsEnvelope } from '../../features/settings/routing-policy';
import { RuntimeRoutingSettingsEntity } from './entities';

export const ROUTING_SETTINGS_ID = 'global';

export async function getRoutingSettings(source: DataSource): Promise<RoutingSettingsEnvelope> {
  const row = await source.getRepository(RuntimeRoutingSettingsEntity).findOneBy({ id: ROUTING_SETTINGS_ID });
  return {
    configured: row !== null,
    revision: row?.revision ?? 0,
    policy: row ? parseRoutingPolicy(row.policy) : createDefaultRoutingPolicy(),
    providers: ROUTING_PROVIDERS.map(provider => ({ ...provider, efforts: [...provider.efforts] })),
  };
}

export async function saveRoutingSettings(source: DataSource, expectedRevision: unknown, untrustedPolicy: unknown): Promise<RoutingSettingsEnvelope> {
  if (!Number.isSafeInteger(expectedRevision) || (expectedRevision as number) < 0) throw new Error('invalid_routing_settings');
  let policy: RoutingPolicy;
  try { policy = parseRoutingPolicy(untrustedPolicy); } catch { throw new Error('invalid_routing_settings'); }
  return source.transaction(async manager => {
    await manager.query('SELECT pg_advisory_xact_lock($1)', [4815162343]);
    const repo = manager.getRepository(RuntimeRoutingSettingsEntity);
    const current = await repo.findOneBy({ id: ROUTING_SETTINGS_ID });
    if ((current?.revision ?? 0) !== expectedRevision) throw new Error('routing_settings_revision_conflict');
    const row = repo.create({ id: ROUTING_SETTINGS_ID, revision: (current?.revision ?? 0) + 1, policy, createdAt: current?.createdAt ?? new Date(), updatedAt: new Date() });
    await repo.save(row);
    return { configured: true, revision: row.revision, policy, providers: ROUTING_PROVIDERS.map(provider => ({ ...provider, efforts: [...provider.efforts] })) };
  });
}
