import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool, PoolClient } from 'pg';

import { POSTGRES_IMAGE } from '../containers/images.js';

/**
 * Constant ORGANIZATION_SETTING
 *
 * @description
 * PostgreSQL parameter the tenant transaction runner of `@cadenway/nest-common/database` sets for
 * the length of a transaction, and the row-level security policies compare to `organization_id`.
 *
 * @type {string}
 */
export const ORGANIZATION_SETTING: string = 'app.organization_id';

/**
 * Constant SYSTEM_ACCESS_SETTING
 *
 * @description
 * PostgreSQL parameter the system transaction runner sets to `on`, which lets a transaction cross
 * organizations.
 *
 * @type {string}
 */
export const SYSTEM_ACCESS_SETTING: string = 'app.system_access';

/**
 * Interface TestDatabaseOptions
 *
 * @description
 * Options of `startTestDatabase`.
 */
export interface TestDatabaseOptions {
  // #region Properties
  /**
   * Property service
   *
   * @description
   * Name of the service that owns the database, such as `task-service`. It names the database
   * (`task`) and the two roles (`task_migrator`, `task_app`). Defaults to `test-service`.
   *
   * @type {string | undefined}
   * @readonly
   */
  readonly service?: string;

  /**
   * Property image
   *
   * @description
   * PostgreSQL image. Defaults to `POSTGRES_IMAGE`, the tag cadenway-ops pins.
   *
   * @type {string | undefined}
   * @readonly
   */
  readonly image?: string;
  // #endregion
}

/**
 * Interface TestDatabaseRoles
 *
 * @description
 * Names of the two PostgreSQL roles of a service.
 */
export interface TestDatabaseRoles {
  // #region Properties
  /**
   * Property migrator
   *
   * @description
   * Role that owns the database and its tables and runs the migrations: `<database>_migrator`.
   *
   * @type {string}
   * @readonly
   */
  readonly migrator: string;

  /**
   * Property app
   *
   * @description
   * Role the service runs with, `<database>_app`: no DDL right, not a superuser, subject to
   * row-level security.
   *
   * @type {string}
   * @readonly
   */
  readonly app: string;
  // #endregion
}

/**
 * Interface TestDatabase
 *
 * @description
 * Disposable PostgreSQL with the two roles of a Cadenway service.
 */
export interface TestDatabase {
  // #region Properties
  /**
   * Property appUrl
   *
   * @description
   * Connection string of the application role: the `DATABASE_URL` of the service under test.
   *
   * @type {string}
   * @readonly
   */
  readonly appUrl: string;

  /**
   * Property migratorUrl
   *
   * @description
   * Connection string of the migrator role: the `MIGRATION_DATABASE_URL` that `src/migrate.ts`
   * of the service reads.
   *
   * @type {string}
   * @readonly
   */
  readonly migratorUrl: string;

  /**
   * Property roles
   *
   * @description
   * Names of the migrator and application roles.
   *
   * @type {TestDatabaseRoles}
   * @readonly
   */
  readonly roles: TestDatabaseRoles;

  /**
   * Property app
   *
   * @description
   * Pool of the application role. A query outside `asOrganization` and `asSystem` sees no row of
   * a table protected by the organization policy.
   *
   * @type {Pool}
   * @readonly
   */
  readonly app: Pool;

  /**
   * Property migrator
   *
   * @description
   * Pool of the migrator role, which owns the tables.
   *
   * @type {Pool}
   * @readonly
   */
  readonly migrator: Pool;

  /**
   * Property admin
   *
   * @description
   * Pool of the superuser, to seed or inspect rows whatever the policies say.
   *
   * @type {Pool}
   * @readonly
   */
  readonly admin: Pool;
  // #endregion

  // #region Methods
  /**
   * Method migrate
   *
   * @description
   * Applies the Drizzle migrations of a folder as the migrator role, the way `src/migrate.ts` of
   * a service does. Nothing is added to them: a migration that forgets to force row-level
   * security leaves the table unforced, and `findUnprotectedTables` reports it.
   *
   * @param {string} migrationsFolder - Folder that holds `meta/_journal.json`, absolute or relative to the working directory.
   * @returns {Promise<void>} Resolves once migrated.
   * @throws {Error} When the folder holds no migration journal.
   */
  migrate(migrationsFolder: string): Promise<void>;

  /**
   * Method execute
   *
   * @description
   * Runs SQL statements in order as the migrator role, for a test that writes its own tables.
   *
   * @param {readonly string[]} statements - Statements to run.
   * @returns {Promise<void>} Resolves once run.
   */
  execute(statements: readonly string[]): Promise<void>;

  /**
   * Method asOrganization
   *
   * @description
   * Runs work as the application role inside a transaction scoped to one organization, as the
   * tenant transaction runner does for a use case. The transaction commits when the work
   * resolves and rolls back when it rejects.
   *
   * @param {string} organizationId - UUID of the organization.
   * @param {(client: PoolClient) => Promise<TResult>} work - Work to run on the connection.
   * @returns {Promise<TResult>} What the work returns.
   */
  asOrganization<TResult>(
    organizationId: string,
    work: (client: PoolClient) => Promise<TResult>,
  ): Promise<TResult>;

  /**
   * Method asSystem
   *
   * @description
   * Runs work as the application role inside a transaction with system access, as the system
   * transaction runner does for a relay or a schedule.
   *
   * @param {(client: PoolClient) => Promise<TResult>} work - Work to run on the connection.
   * @returns {Promise<TResult>} What the work returns.
   */
  asSystem<TResult>(work: (client: PoolClient) => Promise<TResult>): Promise<TResult>;

  /**
   * Method reset
   *
   * @description
   * Empties every table of the `public` schema and restarts their sequences, to start a test
   * from a known state. The migration history is kept.
   *
   * @returns {Promise<void>} Resolves once emptied.
   */
  reset(): Promise<void>;

  /**
   * Method stop
   *
   * @description
   * Closes the pools and removes the container.
   *
   * @returns {Promise<void>} Resolves once stopped.
   */
  stop(): Promise<void>;
  // #endregion
}

/**
 * Interface RoleTimeouts
 *
 * @description
 * Timeouts cadenway-ops sets on a role, as PostgreSQL durations.
 */
interface RoleTimeouts {
  // #region Properties
  /**
   * Property statement
   *
   * @description
   * `statement_timeout`.
   *
   * @type {string}
   * @readonly
   */
  readonly statement: string;

  /**
   * Property lock
   *
   * @description
   * `lock_timeout`.
   *
   * @type {string}
   * @readonly
   */
  readonly lock: string;

  /**
   * Property idleInTransaction
   *
   * @description
   * `idle_in_transaction_session_timeout`.
   *
   * @type {string}
   * @readonly
   */
  readonly idleInTransaction: string;
  // #endregion
}

/**
 * Constant APP_TIMEOUTS
 *
 * @description
 * Timeouts of the application role: a statement never outlives the 10 s budget of a request.
 *
 * @type {RoleTimeouts}
 */
const APP_TIMEOUTS: RoleTimeouts = { statement: '10s', lock: '5s', idleInTransaction: '30s' };

/**
 * Constant MIGRATOR_TIMEOUTS
 *
 * @description
 * Timeouts of the migrator role: an index may build for minutes, a lock is not waited for.
 *
 * @type {RoleTimeouts}
 */
const MIGRATOR_TIMEOUTS: RoleTimeouts = {
  statement: '15min',
  lock: '5s',
  idleInTransaction: '60s',
};

/**
 * Function roleTimeouts
 *
 * @description
 * Writes the statements that set the timeouts of a role, for every session it opens.
 *
 * @param {string} role - Quoted role name.
 * @param {RoleTimeouts} timeouts - Timeouts to set.
 * @returns {string} The statements.
 */
function roleTimeouts(role: string, timeouts: RoleTimeouts): string {
  return [
    `alter role ${role} set statement_timeout = '${timeouts.statement}';`,
    `alter role ${role} set lock_timeout = '${timeouts.lock}';`,
    `alter role ${role} set idle_in_transaction_session_timeout = '${timeouts.idleInTransaction}';`,
  ].join('\n');
}

/**
 * Function quoteIdentifier
 *
 * @description
 * Quotes a PostgreSQL identifier.
 *
 * @param {string} name - Identifier to quote.
 * @returns {string} The identifier between double quotes.
 */
export function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/**
 * Function databaseNameOf
 *
 * @description
 * Derives the database name of a service the way cadenway-ops names it: `task-service` gives
 * `task`.
 *
 * @param {string} service - Name of the service, in lowercase kebab-case.
 * @returns {string} The database name, which also prefixes the two roles.
 * @throws {Error} When the name is not lowercase kebab-case.
 */
function databaseNameOf(service: string): string {
  if (!/^[a-z][a-z0-9-]{1,40}$/u.test(service)) {
    throw new Error('A service name is lowercase kebab-case, such as "task-service".');
  }
  return service.replace(/-service$/u, '').replaceAll('-', '_');
}

/**
 * Function inTransaction
 *
 * @description
 * Runs work on one connection of a pool, inside a transaction that carries PostgreSQL parameters
 * for its length only.
 *
 * @param {Pool} pool - Pool to take the connection from.
 * @param {Readonly<Record<string, string>>} settings - Parameters to set for the transaction.
 * @param {(client: PoolClient) => Promise<TResult>} work - Work to run.
 * @returns {Promise<TResult>} What the work returns.
 */
async function inTransaction<TResult>(
  pool: Pool,
  settings: Readonly<Record<string, string>>,
  work: (client: PoolClient) => Promise<TResult>,
): Promise<TResult> {
  const client: PoolClient = await pool.connect();
  let broken: boolean = false;
  try {
    await client.query('begin');
    try {
      for (const [name, value] of Object.entries(settings)) {
        await client.query('select set_config($1, $2, true)', [name, value]);
      }
      const result: TResult = await work(client);
      await client.query('commit');
      return result;
    } catch (error) {
      try {
        await client.query('rollback');
      } catch {
        broken = true;
      }
      throw error;
    }
  } finally {
    client.release(broken);
  }
}

/**
 * Function startTestDatabase
 *
 * @description
 * Starts a disposable PostgreSQL and creates the database and the two roles of a service as
 * cadenway-ops does (`docs/database.md`): the migrator owns the database and runs the DDL; the
 * application role may connect, owns nothing, creates nothing (no schema, no table, no temporary
 * table), is neither a superuser nor exempt from row-level security, and receives the data rights
 * on every schema, table and sequence the migrator creates. Both carry the timeouts of the
 * deployed roles. Nothing starts before this call, and `stop` removes everything.
 *
 * @param {TestDatabaseOptions} options - Service name and image.
 * @returns {Promise<TestDatabase>} The running database.
 */
export async function startTestDatabase(options: TestDatabaseOptions = {}): Promise<TestDatabase> {
  const database: string = databaseNameOf(options.service ?? 'test-service');
  const roles: TestDatabaseRoles = { migrator: `${database}_migrator`, app: `${database}_app` };
  const { default: pg } = await import('pg');
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    options.image ?? POSTGRES_IMAGE,
  )
    .withDatabase(database)
    .start();
  const pools: Pool[] = [];
  /**
   * Function open
   *
   * @description
   * Opens a small pool that never lets a lost connection crash the test process.
   *
   * @param {string} connectionString - Connection string of the role.
   * @returns {Pool} The pool.
   */
  const open = (connectionString: string): Pool => {
    const pool: Pool = new pg.Pool({ connectionString, max: 4 });
    pool.on('error', (): void => undefined);
    pools.push(pool);
    return pool;
  };
  /**
   * Function stop
   *
   * @description
   * Closes the pools, then removes the container even when a pool failed to close.
   *
   * @returns {Promise<void>} Resolves once stopped.
   */
  const stop = async (): Promise<void> => {
    try {
      await Promise.all(pools.splice(0).map((pool: Pool) => pool.end()));
    } finally {
      await container.stop();
    }
  };
  try {
    const address: string = `${container.getHost()}:${String(container.getPort())}/${database}`;
    // Generated for each run: no credential of a disposable database is written anywhere.
    const migratorPassword: string = randomBytes(18).toString('hex');
    const appPassword: string = randomBytes(18).toString('hex');
    const migratorUrl: string = `postgres://${roles.migrator}:${migratorPassword}@${address}`;
    const appUrl: string = `postgres://${roles.app}:${appPassword}@${address}`;
    const admin: Pool = open(container.getConnectionUri());
    const migratorRole: string = quoteIdentifier(roles.migrator);
    const appRole: string = quoteIdentifier(roles.app);
    const databaseName: string = quoteIdentifier(database);
    // What compose/postgres/init/10-service-databases.sh of cadenway-ops does for one service,
    // statement for statement, so a test runs with the privileges of the deployed service.
    await admin.query(`
      create role ${migratorRole} with login nosuperuser nocreatedb nocreaterole noreplication
        nobypassrls password '${migratorPassword}';
      create role ${appRole} with login nosuperuser nocreatedb nocreaterole noreplication
        nobypassrls password '${appPassword}';
      ${roleTimeouts(migratorRole, MIGRATOR_TIMEOUTS)}
      ${roleTimeouts(appRole, APP_TIMEOUTS)}
      alter database ${databaseName} owner to ${migratorRole};
      revoke all on database ${databaseName} from public;
      revoke all on database ${databaseName} from ${appRole};
      grant connect on database ${databaseName} to ${appRole};
      revoke create on schema public from public;
      grant usage on schema public to ${appRole};
      alter default privileges for role ${migratorRole} grant usage on schemas to ${appRole};
      alter default privileges for role ${migratorRole}
        grant select, insert, update, delete on tables to ${appRole};
      alter default privileges for role ${migratorRole}
        grant usage, select on sequences to ${appRole};
    `);
    const migrator: Pool = open(migratorUrl);
    const app: Pool = open(appUrl);
    return {
      appUrl,
      migratorUrl,
      roles,
      app,
      migrator,
      admin,
      migrate: async (migrationsFolder: string): Promise<void> => {
        const folder: string = resolve(migrationsFolder);
        if (!existsSync(join(folder, 'meta', '_journal.json'))) {
          throw new Error(`No migration journal (meta/_journal.json) in ${folder}.`);
        }
        const { drizzle } = await import('drizzle-orm/node-postgres');
        const { migrate } = await import('drizzle-orm/node-postgres/migrator');
        await migrate(drizzle({ client: migrator }), { migrationsFolder: folder });
      },
      execute: async (statements: readonly string[]): Promise<void> => {
        for (const statement of statements) {
          await migrator.query(statement);
        }
      },
      asOrganization: <TResult>(
        organizationId: string,
        work: (client: PoolClient) => Promise<TResult>,
      ): Promise<TResult> => inTransaction(app, { [ORGANIZATION_SETTING]: organizationId }, work),
      asSystem: <TResult>(work: (client: PoolClient) => Promise<TResult>): Promise<TResult> =>
        inTransaction(app, { [SYSTEM_ACCESS_SETTING]: 'on' }, work),
      reset: async (): Promise<void> => {
        const tables: { rows: { tablename: string }[] } = await admin.query(
          "select tablename from pg_tables where schemaname = 'public' order by tablename",
        );
        if (tables.rows.length > 0) {
          const names: string = tables.rows
            .map((row: { tablename: string }) => `public.${quoteIdentifier(row.tablename)}`)
            .join(', ');
          await admin.query(`truncate table ${names} restart identity cascade`);
        }
      },
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}
