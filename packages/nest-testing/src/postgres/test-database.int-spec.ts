import type { PoolClient } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { fixtures } from '../fixtures/fixtures.js';
import type { FixtureTask } from '../fixtures/sprint-14.js';
import {
  ORGANIZATION_PREDICATE,
  writeSampleMigrations,
  type SampleMigrations,
} from '../testing/sample-migrations.js';
import {
  assertTenantIsolation,
  checkTenantIsolation,
  findUnprotectedTables,
  type TenantIsolationReport,
} from './tenant-isolation.js';
import { startTestDatabase, type TestDatabase } from './test-database.js';

/**
 * Constant ATELIER_NORD
 *
 * @description
 * Id of the organization that owns the seeded rows.
 *
 * @type {string}
 */
const ATELIER_NORD: string = fixtures.atelierNord().organization.id;

/**
 * Constant LUMEN
 *
 * @description
 * Id of the organization that must not see them.
 *
 * @type {string}
 */
const LUMEN: string = fixtures.cooperativeLumen().organization.id;

/**
 * Function keys
 *
 * @description
 * Reads the display keys a query on `tasks` returned, sorted.
 *
 * @param {{ rows: unknown[] }} result - Result of the query.
 * @returns {string[]} The sorted keys.
 */
function keys(result: { rows: unknown[] }): string[] {
  return (result.rows as { display_key: string }[]).map((row) => row.display_key).sort();
}

describe('startTestDatabase', () => {
  let database: TestDatabase;
  let migrations: SampleMigrations;

  beforeAll(async () => {
    migrations = writeSampleMigrations();
    database = await startTestDatabase({ service: 'task-service' });
    await database.migrate(migrations.folder);
    // Tables that each miss one part of the protection, to check that the helpers notice.
    await database.execute([
      'create table "notes" ("id" uuid primary key default uuidv7(), "organization_id" uuid not null)',
      'alter table "notes" enable row level security',
      `create policy "organization_isolation" on "notes" for all
         using (${ORGANIZATION_PREDICATE}) with check (${ORGANIZATION_PREDICATE})`,
      'create table "labels" ("id" uuid primary key default uuidv7(), "organization_id" uuid not null)',
      'create table "flags" ("id" uuid primary key default uuidv7(), "organization_id" uuid not null)',
      'alter table "flags" enable row level security',
      'alter table "flags" force row level security',
      'create table "plans" ("id" uuid primary key default uuidv7(), "name" text not null)',
    ]);
  });

  beforeEach(async () => {
    await database.reset();
    const task: FixtureTask = fixtures.sprint14().task('CAD-482');
    await database.admin.query(
      `insert into tasks (organization_id, display_key, title, status) values
         ($1, $3, $4, $5), ($1, 'CAD-479', 'Limiter le débit', 'progress'), ($2, 'LUM-1', 'Autre', 'todo')`,
      [ATELIER_NORD, LUMEN, task.id, task.name, task.status],
    );
    await database.admin.query('insert into notes (organization_id) values ($1)', [ATELIER_NORD]);
    await database.admin.query('insert into labels (organization_id) values ($1)', [ATELIER_NORD]);
  });

  afterAll(async () => {
    await database.stop();
    migrations.remove();
  });

  it('runs PostgreSQL 18 and names the database and the roles after the service', async () => {
    const version: { rows: { version: number }[] } = await database.admin.query(
      "select current_setting('server_version_num')::int / 10000 as version",
    );
    const session: { rows: { database: string; role: string }[] } = await database.app.query(
      'select current_database() as database, current_user as role',
    );

    expect(version.rows[0]?.version).toBe(18);
    expect(session.rows[0]).toEqual({ database: 'task', role: 'task_app' });
    expect(database.roles).toEqual({ migrator: 'task_migrator', app: 'task_app' });
    expect(database.appUrl).toContain('task_app:');
    expect(database.migratorUrl).toContain('task_migrator:');
  });

  it('applies the migrations as the migrator, which owns the tables', async () => {
    const owner: { rows: { tableowner: string }[] } = await database.admin.query(
      "select tableowner from pg_tables where schemaname = 'public' and tablename = 'tasks'",
    );
    const history: { rows: { n: number }[] } = await database.admin.query(
      'select count(*)::int as n from drizzle.__drizzle_migrations',
    );

    expect(owner.rows[0]?.tableowner).toBe('task_migrator');
    expect(history.rows[0]?.n).toBe(1);

    // Applying again changes nothing: the history says the migration ran.
    await database.migrate(migrations.folder);
    const again: { rows: { n: number }[] } = await database.admin.query(
      'select count(*)::int as n from drizzle.__drizzle_migrations',
    );
    expect(again.rows[0]?.n).toBe(1);
  });

  it('refuses a folder without a migration journal', async () => {
    await expect(database.migrate('no-such-folder')).rejects.toThrow('No migration journal');
  });

  it('gives the application role data rights only', async () => {
    const role: { rows: { rolsuper: boolean; rolbypassrls: boolean; rolcreaterole: boolean }[] } =
      await database.admin.query(
        "select rolsuper, rolbypassrls, rolcreaterole from pg_roles where rolname = 'task_app'",
      );

    expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false, rolcreaterole: false });
    await expect(database.app.query('create table "intruder" ("id" int)')).rejects.toThrow(
      /permission denied/u,
    );
    await expect(database.app.query('create temporary table "scratch" ("id" int)')).rejects.toThrow(
      /permission denied/u,
    );
    await expect(database.app.query('create schema "intruder"')).rejects.toThrow(
      /permission denied/u,
    );
    await expect(database.app.query('drop table "tasks"')).rejects.toThrow(/must be owner/u);
    await expect(
      database.app.query('alter table "tasks" no force row level security'),
    ).rejects.toThrow(/must be owner/u);
  });

  it('lets the migrator own the database, as cadenway-ops creates it', async () => {
    const owner: { rows: { owner: string }[] } = await database.admin.query(
      "select pg_get_userbyid(datdba) as owner from pg_database where datname = 'task'",
    );

    expect(owner.rows[0]?.owner).toBe('task_migrator');
  });

  it('gives the application role the rows the migrator creates in public', async () => {
    await database.execute([
      'create table "audit_entries" ("id" serial primary key, "label" text not null)',
    ]);

    // The sequence of the serial column is granted with the table.
    await database.app.query('insert into audit_entries (label) values ($1)', ['created']);
    const entries: { rows: { label: string }[] } = await database.app.query(
      'select label from audit_entries',
    );
    expect(entries.rows).toEqual([{ label: 'created' }]);
    await expect(database.app.query('drop table audit_entries')).rejects.toThrow(/must be owner/u);
  });

  it('keeps another schema of the migrator closed until its creator grants access', async () => {
    // The jobs keep their tables in a schema of their own; @cadenway/nest-jobs grants the
    // application role what its runtime needs when it provisions that schema.
    await database.execute([
      'create schema "pgboss"',
      'create table "pgboss"."job" ("id" serial primary key, "name" text not null)',
    ]);

    await expect(database.app.query('select name from pgboss.job')).rejects.toThrow(
      /permission denied for schema pgboss/u,
    );

    await database.execute([
      'grant usage on schema "pgboss" to "task_app"',
      'grant select, insert, update, delete on "pgboss"."job" to "task_app"',
      'grant usage, select on all sequences in schema "pgboss" to "task_app"',
    ]);
    await database.app.query('insert into pgboss.job (name) values ($1)', ['purge-trash']);
    const jobs: { rows: { name: string }[] } = await database.app.query(
      'select name from pgboss.job',
    );
    expect(jobs.rows).toEqual([{ name: 'purge-trash' }]);
    await expect(database.app.query('drop table pgboss.job')).rejects.toThrow(/must be owner/u);
  });

  it('keeps the migration journal of Drizzle out of reach of the application role', async () => {
    // A deleted journal row would make the next migration run apply that migration again.
    const statements: readonly string[] = [
      'select count(*) from drizzle.__drizzle_migrations',
      "insert into drizzle.__drizzle_migrations (hash, created_at) values ('forged', 0)",
      'update drizzle.__drizzle_migrations set hash = hash',
      'delete from drizzle.__drizzle_migrations',
      'alter table drizzle.__drizzle_migrations add column "x" int',
    ];

    for (const statement of statements) {
      await expect(database.app.query(statement)).rejects.toThrow(
        /permission denied for schema drizzle/u,
      );
    }
    const journal: { rows: { n: number }[] } = await database.admin.query(
      'select count(*)::int as n from drizzle.__drizzle_migrations',
    );
    expect(journal.rows[0]?.n).toBe(1);
  });

  it('sets the timeouts of the deployed roles', async () => {
    /**
     * Function timeoutsOf
     *
     * @description
     * Reads the three timeouts a session of a pool runs with.
     *
     * @param {TestDatabase['app']} pool - Pool of one role.
     * @returns {Promise<unknown>} The timeouts, by name.
     */
    const timeoutsOf = async (pool: TestDatabase['app']): Promise<unknown> =>
      (
        await pool.query(
          `select current_setting('statement_timeout') as statement,
                  current_setting('lock_timeout') as lock,
                  current_setting('idle_in_transaction_session_timeout') as idle`,
        )
      ).rows[0];

    expect(await timeoutsOf(database.app)).toEqual({ statement: '10s', lock: '5s', idle: '30s' });
    expect(await timeoutsOf(database.migrator)).toEqual({
      statement: '15min',
      lock: '5s',
      idle: '1min',
    });
  });

  it('shows an organization its own rows and no others', async () => {
    const nord: string[] = await database.asOrganization(
      ATELIER_NORD,
      async (client: PoolClient): Promise<string[]> =>
        keys(await client.query('select display_key from tasks')),
    );
    const lumen: string[] = await database.asOrganization(
      LUMEN,
      async (client: PoolClient): Promise<string[]> =>
        keys(await client.query('select display_key from tasks')),
    );

    expect(nord).toEqual(['CAD-479', 'CAD-482']);
    expect(lumen).toEqual(['LUM-1']);
  });

  it('shows nothing outside a transaction scoped to an organization', async () => {
    expect(keys(await database.app.query('select display_key from tasks'))).toEqual([]);
  });

  it('shows every organization to a system transaction', async () => {
    const all: string[] = await database.asSystem(async (client: PoolClient): Promise<string[]> =>
      keys(await client.query('select display_key from tasks')),
    );

    expect(all).toEqual(['CAD-479', 'CAD-482', 'LUM-1']);
  });

  it('refuses a row written for another organization', async () => {
    await expect(
      database.asOrganization(LUMEN, (client: PoolClient) =>
        client.query(
          "insert into tasks (organization_id, display_key, title, status) values ($1, 'CAD-900', 'x', 'todo')",
          [ATELIER_NORD],
        ),
      ),
    ).rejects.toThrow(/row-level security/u);
  });

  it('commits the work that resolves and rolls back the work that rejects', async () => {
    await database.asOrganization(ATELIER_NORD, (client: PoolClient) =>
      client.query("update tasks set status = 'review' where display_key = 'CAD-482'"),
    );
    await expect(
      database.asOrganization(ATELIER_NORD, async (client: PoolClient): Promise<void> => {
        await client.query("update tasks set status = 'done' where display_key = 'CAD-482'");
        throw new Error('use case failed');
      }),
    ).rejects.toThrow('use case failed');

    const status: { rows: { status: string }[] } = await database.admin.query(
      "select status from tasks where display_key = 'CAD-482'",
    );
    expect(status.rows[0]?.status).toBe('review');
  });

  it('empties the tables on reset and keeps the migration history', async () => {
    await database.reset();

    const tasks: { rows: { n: number }[] } = await database.admin.query(
      'select count(*)::int as n from tasks',
    );
    const history: { rows: { n: number }[] } = await database.admin.query(
      'select count(*)::int as n from drizzle.__drizzle_migrations',
    );
    expect(tasks.rows[0]?.n).toBe(0);
    expect(history.rows[0]?.n).toBe(1);
  });

  describe('assertTenantIsolation', () => {
    it('proves that another organization neither reads nor changes the rows', async () => {
      const report: TenantIsolationReport = await assertTenantIsolation(database, {
        table: 'tasks',
        organizationId: ATELIER_NORD,
        otherOrganizationId: LUMEN,
      });

      expect(report).toEqual({
        table: 'tasks',
        enabled: true,
        forced: true,
        ownedRows: 2,
        visibleToOwner: 2,
        visibleToOther: 0,
        visibleWithoutOrganization: 0,
        writableByOther: 0,
        failures: [],
      });
      // The probe changed nothing.
      const rows: { rows: { n: number }[] } = await database.admin.query(
        'select count(*)::int as n from tasks',
      );
      expect(rows.rows[0]?.n).toBe(3);
    });

    it('fails on a table whose row-level security is not forced', async () => {
      await expect(
        assertTenantIsolation(database, {
          table: 'notes',
          organizationId: ATELIER_NORD,
          otherOrganizationId: LUMEN,
        }),
      ).rejects.toThrow(
        'Tenant isolation is broken on notes:\n- Row-level security is not forced on notes',
      );
    });

    it('fails on a table without row-level security, naming what leaks', async () => {
      const report: TenantIsolationReport = await checkTenantIsolation(database, {
        table: 'labels',
        organizationId: ATELIER_NORD,
        otherOrganizationId: LUMEN,
      });

      expect(report).toMatchObject({
        enabled: false,
        forced: false,
        visibleToOther: 1,
        visibleWithoutOrganization: 1,
        writableByOther: 1,
      });
      expect(report.failures).toEqual([
        'Row-level security is not enabled on labels.',
        expect.stringContaining('Row-level security is not forced on labels'),
        `Organization ${LUMEN} reads 1 rows of organization ${ATELIER_NORD} in labels.`,
        'A transaction with no organization reads 1 rows of labels.',
        `Organization ${LUMEN} can change 1 rows of organization ${ATELIER_NORD} in labels.`,
      ]);
      // The write attempt was rolled back.
      const rows: { rows: { n: number }[] } = await database.admin.query(
        'select count(*)::int as n from labels',
      );
      expect(rows.rows[0]?.n).toBe(1);
    });

    it('fails on an empty table, which would prove nothing', async () => {
      await database.reset();

      await expect(
        assertTenantIsolation(database, {
          table: 'tasks',
          organizationId: ATELIER_NORD,
          otherOrganizationId: LUMEN,
        }),
      ).rejects.toThrow('seed one, an empty table proves nothing');
    });

    it('refuses a table that does not exist', async () => {
      await expect(
        checkTenantIsolation(database, {
          table: 'missing',
          organizationId: ATELIER_NORD,
          otherOrganizationId: LUMEN,
        }),
      ).rejects.toThrow('No table public.missing');
    });
  });

  describe('findUnprotectedTables', () => {
    it('lists the tenant-owned tables that miss a part of the protection', async () => {
      expect(await findUnprotectedTables(database)).toEqual([
        { table: 'flags', reason: 'no-policy' },
        { table: 'labels', reason: 'not-enabled' },
        { table: 'notes', reason: 'not-forced' },
      ]);
    });
  });
});

describe('TestDatabase.stop', () => {
  it('removes the container: nothing answers afterwards', async () => {
    const database: TestDatabase = await startTestDatabase();
    const session: { rows: { role: string }[] } = await database.app.query(
      'select current_user as role',
    );
    expect(session.rows[0]?.role).toBe('test_app');
    const { default: pg } = await import('pg');

    await database.stop();

    const client: InstanceType<typeof pg.Client> = new pg.Client({
      connectionString: database.appUrl,
      connectionTimeoutMillis: 3000,
    });
    await expect(client.connect()).rejects.toThrow();
  });

  it('refuses a service name that is not kebab-case', async () => {
    await expect(startTestDatabase({ service: 'Task Service' })).rejects.toThrow(
      'lowercase kebab-case',
    );
  });
});
