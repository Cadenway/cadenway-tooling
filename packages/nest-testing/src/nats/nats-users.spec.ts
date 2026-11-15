import { describe, expect, it } from 'vitest';

import {
  credentialsOf,
  grantOf,
  natsUserNameOf,
  permissionsOf,
  serverConfiguration,
  type NatsPermissions,
  type TestNatsCredentials,
} from './nats-users.js';

describe('natsUserNameOf', () => {
  it('names the user after the service, as cadenway-ops does', () => {
    expect(natsUserNameOf('task-service')).toBe('task');
    expect(natsUserNameOf('api-gateway')).toBe('api-gateway');
    expect(natsUserNameOf('realtime-gateway')).toBe('realtime-gateway');
  });
});

describe('permissionsOf', () => {
  it('lets a backend publish the events and rebuilds of its own entities only', () => {
    const task: NatsPermissions = permissionsOf('task', grantOf({ name: 'task' }));

    expect(task.publish).toEqual(
      expect.arrayContaining(['evt.task.>', 'evt.milestone.>', 'rebuild.*.task']),
    );
    expect(task.publish).not.toContain('evt.organization.>');
    expect(task.publish).not.toContain('evt.>');
    expect(task.publish).not.toContain('restricted.>');
    expect(task.subscribe).toEqual(['_INBOX.task.>', 'rebuild.task.>']);
  });

  it('gives the JetStream calls that read a stream, never those that create or delete one', () => {
    const task: NatsPermissions = permissionsOf('task', grantOf({ name: 'task' }));

    expect(task.publish).toEqual(
      expect.arrayContaining([
        '$JS.API.CONSUMER.CREATE.EVENTS.>',
        '$JS.API.CONSUMER.MSG.NEXT.EVENTS.*',
        '$JS.ACK.EVENTS.>',
      ]),
    );
    expect(
      task.publish.filter((subject: string) =>
        /STREAM\.(CREATE|UPDATE|DELETE|PURGE)/u.test(subject),
      ),
    ).toEqual([]);
    expect(task.publish.some((subject: string) => subject.includes('EVENTS_RESTRICTED'))).toBe(
      false,
    );
  });

  it('keeps the restricted events between identity and notification', () => {
    const identity: NatsPermissions = permissionsOf('identity', grantOf({ name: 'identity' }));
    const notification: NatsPermissions = permissionsOf(
      'notification',
      grantOf({ name: 'notification' }),
    );

    expect(identity.publish).toContain('restricted.>');
    expect(identity.publish).not.toContain('$JS.API.CONSUMER.CREATE.EVENTS_RESTRICTED.>');
    expect(notification.publish).toEqual(
      expect.arrayContaining([
        '$JS.API.CONSUMER.CREATE.EVENTS_RESTRICTED.>',
        '$JS.API.STREAM.MSG.GET.EVENTS_RESTRICTED',
        'dlq.>',
      ]),
    );
    expect(notification.subscribe).toContain(
      '$JS.EVENT.ADVISORY.CONSUMER.MAX_DELIVERIES.EVENTS_RESTRICTED.>',
    );
  });

  it('gives a gateway its usage event and no consumer', () => {
    const gateway: NatsPermissions = permissionsOf('api-gateway', grantOf({ name: 'api-gateway' }));

    expect(gateway).toEqual({
      publish: [
        'evt.api-usage.>',
        '$JS.API.INFO',
        '$JS.API.STREAM.NAMES',
        '$JS.API.STREAM.INFO.EVENTS',
      ],
      subscribe: ['_INBOX.api-gateway.>'],
    });
  });

  it('takes an explicit grant for a user that is not a Cadenway backend', () => {
    const reporting: NatsPermissions = permissionsOf(
      'reporting',
      grantOf({ name: 'reporting', grant: { entities: ['report'], consumes: [] } }),
    );

    expect(reporting.publish).toEqual([
      'evt.report.>',
      'rebuild.*.report',
      '$JS.API.INFO',
      '$JS.API.STREAM.NAMES',
      '$JS.API.STREAM.INFO.EVENTS',
    ]);
    expect(() => grantOf({ name: 'reporting' })).toThrow('No NATS grant is known');
  });
});

describe('serverConfiguration', () => {
  it('declares the admin user and the user of the application, every value quoted', () => {
    const admin: TestNatsCredentials = credentialsOf('admin');
    const task: TestNatsCredentials = credentialsOf('task');
    const configuration: string = serverConfiguration(admin, {
      credentials: task,
      permissions: permissionsOf('task', grantOf({ name: 'task' })),
    });

    expect(configuration).toContain('jetstream { store_dir: "/data" }');
    expect(configuration).toContain(`"password": "${task.password}"`);
    expect(configuration).toContain('"$JS.API.INFO"');
    // The broker would read an unquoted `$NAME` as a variable.
    expect(configuration).not.toMatch(/[^"]\$JS/u);
    expect(task).toMatchObject({ user: 'task', inboxPrefix: '_INBOX.task' });
    // Letters and digits starting with a letter: the only shape the broker never misreads.
    expect(task.password).toMatch(/^p[0-9a-f]{36}$/u);
    expect(task.password).not.toBe(admin.password);
  });
});
