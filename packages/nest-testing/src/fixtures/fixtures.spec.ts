import { PRIORITY_KEYS, STATUS_CATEGORY_BY_KEY, STATUS_KEYS } from '@cadenway/contracts';
import { describe, expect, it } from 'vitest';

import type { FixturePerson } from './atelier-nord.js';
import { fixtureId } from './fixture-id.js';
import { fixtures } from './fixtures.js';
import type { FixtureStatus, FixtureTask, Sprint14Fixture } from './sprint-14.js';

/**
 * Constant UUID_V7
 *
 * @description
 * Shape of a UUID version 7, as the internal token and the row-level security policies expect.
 *
 * @type {RegExp}
 */
const UUID_V7: RegExp = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

describe('fixtureId', () => {
  it('builds a UUID version 7 that ends with the index', () => {
    expect(fixtureId('task', 482)).toBe('0193a1f0-0005-7000-8000-000000000482');
    expect(fixtureId('organization', 1)).toMatch(UUID_V7);
  });

  it('keeps the kinds of entity apart', () => {
    expect(fixtureId('user', 1)).not.toBe(fixtureId('organization', 1));
  });

  it('refuses an index that is not a positive integer', () => {
    expect(() => fixtureId('task', 0)).toThrow(RangeError);
    expect(() => fixtureId('task', 1.5)).toThrow(RangeError);
    expect(() => fixtureId('task', 1e12)).toThrow(RangeError);
  });
});

describe('fixtures.atelierNord', () => {
  it('gives Atelier Nord and the four people of the mockup', () => {
    const { organization, CM, IR, HD, LP, members } = fixtures.atelierNord();

    expect(organization).toMatchObject({ key: 'AN', name: 'Atelier Nord', slug: 'atelier-nord' });
    expect(members).toEqual([CM, IR, HD, LP]);
    expect(members.map((member: FixturePerson) => `${member.initials} ${member.name}`)).toEqual([
      'CM Camille Martin',
      'IR Inès Robert',
      'HD Hugo Dubois',
      'LP Léa Petit',
    ]);
    expect(members.map((member: FixturePerson) => member.role)).toEqual([
      'owner',
      'admin',
      'admin',
      'member',
    ]);
    expect(CM.email).toBe('camille.martin@ateliernord.fr');
  });

  it('gives every entity a distinct UUID', () => {
    const { organization, members } = fixtures.atelierNord();
    const ids: string[] = [organization.id, ...members.map((member: FixturePerson) => member.id)];

    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(UUID_V7);
    }
  });

  it('returns frozen data, the same at every call', () => {
    expect(fixtures.atelierNord()).toBe(fixtures.atelierNord());
    expect(Object.isFrozen(fixtures.atelierNord().CM)).toBe(true);
    expect(Object.isFrozen(fixtures.atelierNord().members)).toBe(true);
  });
});

describe('fixtures.cooperativeLumen', () => {
  it('gives another organization where Camille Martin is a member', () => {
    const lumen: ReturnType<typeof fixtures.cooperativeLumen> = fixtures.cooperativeLumen();
    const nord: ReturnType<typeof fixtures.atelierNord> = fixtures.atelierNord();

    expect(lumen.organization.name).toBe('Coopérative Lumen');
    expect(lumen.organization.id).not.toBe(nord.organization.id);
    expect(lumen.CM).toEqual({ ...nord.CM, role: 'member' });
  });
});

describe('fixtures.sprint14', () => {
  const sprint: Sprint14Fixture = fixtures.sprint14();

  it('gives Sprint 14 of the space Produit', () => {
    expect(sprint.space).toMatchObject({ key: 'produit', name: 'Produit', prefix: 'CAD' });
    expect(sprint.sprint).toMatchObject({
      key: 'sprint14',
      name: 'Sprint 14',
      spaceId: sprint.space.id,
      startDate: '2026-11-03',
      endDate: '2026-11-17',
    });
    expect(sprint.today).toBe('2026-11-08');
  });

  it('keeps CAD-482 as the mockup writes it', () => {
    const task: FixtureTask = sprint.task('CAD-482');

    expect(task).toMatchObject({
      id: 'CAD-482',
      number: 482,
      uuid: '0193a1f0-0005-7000-8000-000000000482',
      parentId: null,
      name: 'Refondre l’écran de connexion SSO',
      status: 'progress',
      priority: 'haute',
      assignees: ['CM', 'IR'],
      dueDate: '2026-11-12',
      labels: ['Auth', 'Front'],
      estimateMinutes: 480,
      recurrence: 'none',
    });
    expect(task.checklist).toHaveLength(3);
    expect(task.comments.map((comment: { author: string }) => comment.author)).toEqual([
      'IR',
      'CM',
      'HD',
    ]);
  });

  it('lists the fourteen tasks of the sprint, then their seven subtasks', () => {
    const roots: FixtureTask[] = sprint.tasks.filter((task: FixtureTask) => task.parentId === null);
    const subtasks: FixtureTask[] = sprint.tasks.filter(
      (task: FixtureTask) => task.parentId !== null,
    );

    expect(roots).toHaveLength(14);
    expect(subtasks.map((task: FixtureTask) => `${task.id} < ${String(task.parentId)}`)).toEqual([
      'CAD-483 < CAD-482',
      'CAD-484 < CAD-482',
      'CAD-485 < CAD-482',
      'CAD-489 < CAD-483',
      'CAD-492 < CAD-483',
      'CAD-486 < CAD-488',
      'CAD-487 < CAD-488',
    ]);
    expect(sprint.tasks.slice(0, roots.length)).toEqual(roots);
  });

  it('only uses ids of the space, each once, and parents that exist', () => {
    const ids: string[] = sprint.tasks.map((task: FixtureTask) => task.id);

    expect(new Set(ids).size).toBe(ids.length);
    for (const task of sprint.tasks) {
      expect(task.id).toBe(`${sprint.space.prefix}-${String(task.number)}`);
      expect(task.uuid).toBe(fixtureId('task', task.number));
      if (task.parentId !== null) {
        expect(ids).toContain(task.parentId);
      }
    }
  });

  it('only uses statuses, priorities and people that exist', () => {
    const people: string[] = fixtures
      .atelierNord()
      .members.map((member: FixturePerson) => member.initials);

    for (const task of sprint.tasks) {
      expect(STATUS_KEYS).toContain(task.status);
      expect(PRIORITY_KEYS).toContain(task.priority);
      expect(task.estimateMinutes).toBeGreaterThan(0);
      for (const initials of [
        ...task.assignees,
        ...task.comments.map((comment: { author: string }) => comment.author),
      ]) {
        expect(people).toContain(initials);
      }
    }
  });

  it('carries the weekly recurrence of CAD-494 and its missing assignee', () => {
    expect(sprint.task('CAD-494')).toMatchObject({ recurrence: 'weekly', assignees: [] });
  });

  it('refuses a task the sprint does not have', () => {
    // CAD-461 is in the backlog of the mockup, not in the sprint.
    expect(() => sprint.task('CAD-461')).toThrow('Sprint 14 of the mockup has no task CAD-461.');
  });

  it('returns frozen tasks', () => {
    expect(Object.isFrozen(sprint.tasks)).toBe(true);
    expect(Object.isFrozen(sprint.task('CAD-482'))).toBe(true);
    expect(Object.isFrozen(sprint.task('CAD-482').checklist[0])).toBe(true);
  });
});

describe('fixtures.statuses', () => {
  it('lists the ten statuses of the contracts, with their categories', () => {
    const statuses: readonly FixtureStatus[] = fixtures.statuses();

    expect(statuses.map((status: FixtureStatus) => status.key)).toEqual([...STATUS_KEYS]);
    for (const status of statuses) {
      expect(status.category).toBe(STATUS_CATEGORY_BY_KEY[status.key]);
    }
    expect(statuses.find((status: FixtureStatus) => status.key === 'review')?.label).toBe(
      'En revue',
    );
    expect(fixtures.sprint14().statuses).toBe(statuses);
  });
});
