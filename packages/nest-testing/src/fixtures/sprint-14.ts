import type { PriorityKey, Recurrence, StatusCategory, StatusKey } from '@cadenway/contracts';

import type { FixtureInitials } from './atelier-nord.js';
import { fixtureId } from './fixture-id.js';

/**
 * Interface FixtureStatus
 *
 * @description
 * One of the ten statuses of the mockup, with its French label and its category.
 */
export interface FixtureStatus {
  // #region Properties
  /**
   * Property key
   *
   * @description
   * Key of the status, one of the shared enumeration of `@cadenway/contracts`.
   *
   * @type {StatusKey}
   * @readonly
   */
  readonly key: StatusKey;

  /**
   * Property label
   *
   * @description
   * Default French label, before a space renames it.
   *
   * @type {string}
   * @readonly
   */
  readonly label: string;

  /**
   * Property category
   *
   * @description
   * Category the counters and dashboards read.
   *
   * @type {StatusCategory}
   * @readonly
   */
  readonly category: StatusCategory;
  // #endregion
}

/**
 * Interface FixtureSpace
 *
 * @description
 * One space of the mockup.
 */
export interface FixtureSpace {
  // #region Properties
  /**
   * Property id
   *
   * @description
   * Stable UUID written for the tests; the mockup gives none.
   *
   * @type {string}
   * @readonly
   */
  readonly id: string;

  /**
   * Property key
   *
   * @description
   * Key of the space in the mockup, such as `produit`.
   *
   * @type {string}
   * @readonly
   */
  readonly key: string;

  /**
   * Property name
   *
   * @description
   * Display name.
   *
   * @type {string}
   * @readonly
   */
  readonly name: string;

  /**
   * Property prefix
   *
   * @description
   * Prefix of the task ids of the space, such as `CAD`.
   *
   * @type {string}
   * @readonly
   */
  readonly prefix: string;

  /**
   * Property description
   *
   * @description
   * Description shown under the name.
   *
   * @type {string}
   * @readonly
   */
  readonly description: string;

  /**
   * Property icon
   *
   * @description
   * Key of the icon chosen for the space.
   *
   * @type {string}
   * @readonly
   */
  readonly icon: string;

  /**
   * Property color
   *
   * @description
   * Key of the palette color chosen for the space.
   *
   * @type {string}
   * @readonly
   */
  readonly color: string;
  // #endregion
}

/**
 * Interface FixtureSprint
 *
 * @description
 * The list of the mockup that is a sprint.
 */
export interface FixtureSprint {
  // #region Properties
  /**
   * Property id
   *
   * @description
   * Stable UUID written for the tests; the mockup gives none.
   *
   * @type {string}
   * @readonly
   */
  readonly id: string;

  /**
   * Property key
   *
   * @description
   * Key of the list in the mockup, `sprint14`.
   *
   * @type {string}
   * @readonly
   */
  readonly key: string;

  /**
   * Property spaceId
   *
   * @description
   * Id of the space that holds the list.
   *
   * @type {string}
   * @readonly
   */
  readonly spaceId: string;

  /**
   * Property name
   *
   * @description
   * Display name.
   *
   * @type {string}
   * @readonly
   */
  readonly name: string;

  /**
   * Property startDate
   *
   * @description
   * First day of the sprint, as an ISO date.
   *
   * @type {string}
   * @readonly
   */
  readonly startDate: string;

  /**
   * Property endDate
   *
   * @description
   * Last day of the sprint, as an ISO date.
   *
   * @type {string}
   * @readonly
   */
  readonly endDate: string;

  /**
   * Property goal
   *
   * @description
   * Goal of the sprint, in French.
   *
   * @type {string}
   * @readonly
   */
  readonly goal: string;

  /**
   * Property icon
   *
   * @description
   * Key of the icon chosen for the list.
   *
   * @type {string}
   * @readonly
   */
  readonly icon: string;

  /**
   * Property color
   *
   * @description
   * Key of the palette color chosen for the list.
   *
   * @type {string}
   * @readonly
   */
  readonly color: string;
  // #endregion
}

/**
 * Interface FixtureChecklistItem
 *
 * @description
 * One line of the checklist of a task.
 */
export interface FixtureChecklistItem {
  // #region Properties
  /**
   * Property label
   *
   * @description
   * Text of the line.
   *
   * @type {string}
   * @readonly
   */
  readonly label: string;

  /**
   * Property done
   *
   * @description
   * Whether the line is checked.
   *
   * @type {boolean}
   * @readonly
   */
  readonly done: boolean;
  // #endregion
}

/**
 * Interface FixtureComment
 *
 * @description
 * One comment of a task. The mockup dates comments with relative words only, so no timestamp is
 * given: the array order is the order of the thread.
 */
export interface FixtureComment {
  // #region Properties
  /**
   * Property author
   *
   * @description
   * Initials of the author.
   *
   * @type {FixtureInitials}
   * @readonly
   */
  readonly author: FixtureInitials;

  /**
   * Property body
   *
   * @description
   * Text of the comment.
   *
   * @type {string}
   * @readonly
   */
  readonly body: string;
  // #endregion
}

/**
 * Interface FixtureTask
 *
 * @description
 * One task of Sprint 14, as the mockup writes it.
 */
export interface FixtureTask {
  // #region Properties
  /**
   * Property id
   *
   * @description
   * Id of the task in the mockup and in the contracts: the space prefix and a number, such as
   * `CAD-482`.
   *
   * @type {string}
   * @readonly
   */
  readonly id: string;

  /**
   * Property uuid
   *
   * @description
   * Stable UUID for the row of the task, written for the tests; it ends with the task number.
   *
   * @type {string}
   * @readonly
   */
  readonly uuid: string;

  /**
   * Property number
   *
   * @description
   * Number of the task inside its space: 482 for `CAD-482`.
   *
   * @type {number}
   * @readonly
   */
  readonly number: number;

  /**
   * Property parentId
   *
   * @description
   * Id of the parent task for a subtask, `null` for a task of the list.
   *
   * @type {string | null}
   * @readonly
   */
  readonly parentId: string | null;

  /**
   * Property name
   *
   * @description
   * Title, in French.
   *
   * @type {string}
   * @readonly
   */
  readonly name: string;

  /**
   * Property description
   *
   * @description
   * Description, in French.
   *
   * @type {string}
   * @readonly
   */
  readonly description: string;

  /**
   * Property status
   *
   * @description
   * Status key.
   *
   * @type {StatusKey}
   * @readonly
   */
  readonly status: StatusKey;

  /**
   * Property priority
   *
   * @description
   * Priority key.
   *
   * @type {PriorityKey}
   * @readonly
   */
  readonly priority: PriorityKey;

  /**
   * Property assignees
   *
   * @description
   * Initials of the assigned people, in the order of the mockup. Resolve them with
   * `fixtures.atelierNord()`.
   *
   * @type {readonly FixtureInitials[]}
   * @readonly
   */
  readonly assignees: readonly FixtureInitials[];

  /**
   * Property dueDate
   *
   * @description
   * Due date as an ISO date, or `null`.
   *
   * @type {string | null}
   * @readonly
   */
  readonly dueDate: string | null;

  /**
   * Property labels
   *
   * @description
   * Names of the labels.
   *
   * @type {readonly string[]}
   * @readonly
   */
  readonly labels: readonly string[];

  /**
   * Property estimateMinutes
   *
   * @description
   * Estimate in minutes. The mockup writes hours (`8 h`) or minutes (`30 min`).
   *
   * @type {number}
   * @readonly
   */
  readonly estimateMinutes: number;

  /**
   * Property recurrence
   *
   * @description
   * Recurrence of the task; `none` unless the mockup sets one.
   *
   * @type {Recurrence}
   * @readonly
   */
  readonly recurrence: Recurrence;

  /**
   * Property checklist
   *
   * @description
   * Lines of the checklist.
   *
   * @type {readonly FixtureChecklistItem[]}
   * @readonly
   */
  readonly checklist: readonly FixtureChecklistItem[];

  /**
   * Property comments
   *
   * @description
   * Comments, oldest first.
   *
   * @type {readonly FixtureComment[]}
   * @readonly
   */
  readonly comments: readonly FixtureComment[];
  // #endregion
}

/**
 * Interface Sprint14Fixture
 *
 * @description
 * Sprint 14 of the space Produit of Atelier Nord: the space, the sprint, the statuses and the
 * tasks the mockup writes by hand.
 */
export interface Sprint14Fixture {
  // #region Properties
  /**
   * Property today
   *
   * @description
   * The day the mockup is set on, as an ISO date. Due dates read "today" or "late" against it.
   *
   * @type {string}
   * @readonly
   */
  readonly today: string;

  /**
   * Property space
   *
   * @description
   * The space Produit, whose task ids start with `CAD`.
   *
   * @type {FixtureSpace}
   * @readonly
   */
  readonly space: FixtureSpace;

  /**
   * Property sprint
   *
   * @description
   * The list Sprint 14.
   *
   * @type {FixtureSprint}
   * @readonly
   */
  readonly sprint: FixtureSprint;

  /**
   * Property statuses
   *
   * @description
   * The ten default statuses, in the order of the mockup.
   *
   * @type {readonly FixtureStatus[]}
   * @readonly
   */
  readonly statuses: readonly FixtureStatus[];

  /**
   * Property tasks
   *
   * @description
   * The fourteen tasks of the sprint, then their seven subtasks.
   *
   * @type {readonly FixtureTask[]}
   * @readonly
   */
  readonly tasks: readonly FixtureTask[];
  // #endregion

  // #region Methods
  /**
   * Method task
   *
   * @description
   * Returns one task by its mockup id.
   *
   * @param {string} id - Id such as `CAD-482`.
   * @returns {FixtureTask} The task.
   * @throws {Error} When the sprint has no such task.
   */
  task(id: string): FixtureTask;
  // #endregion
}

/**
 * Type TaskSource
 *
 * @description
 * What is written for each task below: everything but the values derived from the id.
 *
 * @type {Omit<FixtureTask, 'uuid' | 'number'>}
 */
type TaskSource = Omit<FixtureTask, 'uuid' | 'number'>;

/**
 * Function task
 *
 * @description
 * Completes one task with its number and its stable UUID, and freezes it.
 *
 * @param {TaskSource} source - The task as the mockup writes it.
 * @returns {FixtureTask} The frozen task.
 */
function task(source: TaskSource): FixtureTask {
  const number: number = Number(source.id.slice(source.id.indexOf('-') + 1));
  return Object.freeze({
    ...source,
    uuid: fixtureId('task', number),
    number,
    assignees: Object.freeze([...source.assignees]),
    labels: Object.freeze([...source.labels]),
    checklist: Object.freeze(
      source.checklist.map((item: FixtureChecklistItem) => Object.freeze({ ...item })),
    ),
    comments: Object.freeze(
      source.comments.map((comment: FixtureComment) => Object.freeze({ ...comment })),
    ),
  });
}

/**
 * Constant STATUSES
 *
 * @description
 * The ten statuses (`STATUSES` of `App.dc.html`).
 *
 * @type {readonly FixtureStatus[]}
 */
const STATUSES: readonly FixtureStatus[] = Object.freeze(
  (
    [
      ['triage', 'À trier', 'open'],
      ['backlog', 'À planifier', 'open'],
      ['todo', 'À faire', 'open'],
      ['progress', 'En cours', 'active'],
      ['review', 'En revue', 'active'],
      ['testing', 'En validation', 'active'],
      ['waiting', 'En attente', 'active'],
      ['blocked', 'Bloqué', 'active'],
      ['done', 'Terminé', 'closed'],
      ['cancelled', 'Annulé', 'closed'],
    ] as const
  ).map(([key, label, category]: readonly [StatusKey, string, StatusCategory]): FixtureStatus =>
    Object.freeze({ key, label, category }),
  ),
);

/**
 * Constant SPACE
 *
 * @description
 * The space Produit (`SPACE_DEFS` of `App.dc.html`).
 *
 * @type {FixtureSpace}
 */
const SPACE: FixtureSpace = Object.freeze({
  id: fixtureId('space', 1),
  key: 'produit',
  name: 'Produit',
  prefix: 'CAD',
  description: 'Développement de Cadenway : sprints, bugs et feuille de route.',
  icon: 'rocket',
  color: 'violet',
});

/**
 * Constant SPRINT
 *
 * @description
 * The list Sprint 14 (`LIST_DEFS` of `App.dc.html`, second list of the mockup).
 *
 * @type {FixtureSprint}
 */
const SPRINT: FixtureSprint = Object.freeze({
  id: fixtureId('list', 2),
  key: 'sprint14',
  spaceId: SPACE.id,
  name: 'Sprint 14',
  startDate: '2026-11-03',
  endDate: '2026-11-17',
  goal: 'Livrer la connexion SSO et la page des quotas d’organisation.',
  icon: 'lightning',
  color: 'violet',
});

/**
 * Constant TASKS
 *
 * @description
 * The tasks the mockup writes by hand in Sprint 14 (`TASKS` and `TASK_META` of `App.dc.html`),
 * then the subtasks it writes by hand under `CAD-482` and `CAD-488`. The tasks and subtasks the
 * mockup generates in a loop to fill its lists (`CAD-500` and above) are left out.
 *
 * @type {readonly FixtureTask[]}
 */
const TASKS: readonly FixtureTask[] = Object.freeze([
  task({
    id: 'CAD-482',
    parentId: null,
    name: 'Refondre l’écran de connexion SSO',
    description:
      'Regrouper Google, GitHub, Microsoft, GitLab et le SSO SAML sur un seul écran, avec la détection du domaine de l’adresse saisie. Reprendre les jetons du thème sombre.',
    status: 'progress',
    priority: 'haute',
    assignees: ['CM', 'IR'],
    dueDate: '2026-11-12',
    labels: ['Auth', 'Front'],
    estimateMinutes: 480,
    recurrence: 'none',
    checklist: [
      { label: 'Maquette validée par le design', done: true },
      { label: 'Détection du domaine SSO', done: true },
      { label: 'Boutons des fournisseurs OAuth', done: true },
    ],
    comments: [
      {
        author: 'IR',
        body: 'Les boutons en deux colonnes passent bien à 320 px. On garde le SSO en pleine largeur ?',
      },
      { author: 'CM', body: 'Oui, il concerne les comptes d’entreprise : il mérite sa ligne.' },
      {
        author: 'HD',
        body: 'Le verrouillage après 5 essais est prêt côté API, branche auth/lockout.',
      },
    ],
  }),
  task({
    id: 'CAD-479',
    parentId: null,
    name: 'Limiter le débit des jetons d’API',
    description:
      'Plafonner chaque jeton personnel à 600 requêtes par minute et renvoyer 429 avec l’en-tête Retry-After. Compter les appels dans le quota mensuel de l’organisation.',
    status: 'progress',
    priority: 'urgente',
    assignees: ['HD'],
    dueDate: '2026-11-08',
    labels: ['Back', 'Sécurité'],
    estimateMinutes: 300,
    recurrence: 'none',
    checklist: [
      { label: 'Compteur glissant par jeton', done: true },
      { label: 'Réponse 429 et Retry-After', done: false },
      { label: 'Décompte dans le quota mensuel', done: false },
    ],
    comments: [],
  }),
  task({
    id: 'CAD-475',
    parentId: null,
    name: 'Export CSV des tâches filtrées',
    description:
      'Exporter exactement les lignes visibles de la vue, filtres et tri compris, avec les champs personnalisés en colonnes.',
    status: 'review',
    priority: 'moyenne',
    assignees: ['LP'],
    dueDate: '2026-11-14',
    labels: ['Back'],
    estimateMinutes: 180,
    recurrence: 'none',
    checklist: [
      { label: 'Respect des filtres actifs', done: true },
      { label: 'Colonnes des champs personnalisés', done: true },
    ],
    comments: [],
  }),
  task({
    id: 'CAD-488',
    parentId: null,
    name: 'Page des quotas de l’organisation',
    description:
      'Afficher sièges, stockage, appels d’API et exécutions d’automatisations avec leurs seuils, et prévenir les propriétaires à 80 % et 95 %.',
    status: 'todo',
    priority: 'haute',
    assignees: ['CM'],
    dueDate: '2026-11-18',
    labels: ['Front', 'Facturation'],
    estimateMinutes: 360,
    recurrence: 'none',
    checklist: [
      { label: 'Historique sur 30 jours', done: false },
      { label: 'Lien vers le changement de plan', done: false },
    ],
    comments: [],
  }),
  task({
    id: 'CAD-490',
    parentId: null,
    name: 'Régénérer les codes de secours MFA',
    description:
      'Permettre de générer un nouveau lot de 10 codes depuis le profil, après confirmation du mot de passe ; l’ancien lot devient invalide.',
    status: 'todo',
    priority: 'moyenne',
    assignees: ['HD', 'CM'],
    dueDate: '2026-11-20',
    labels: ['Sécurité'],
    estimateMinutes: 120,
    recurrence: 'none',
    checklist: [
      { label: 'Confirmation du mot de passe', done: false },
      { label: 'Téléchargement en .txt', done: false },
    ],
    comments: [],
  }),
  task({
    id: 'CAD-491',
    parentId: null,
    name: 'E-mails transactionnels en thème sombre',
    description:
      'Adapter les gabarits d’invitation, de code et de réinitialisation à prefers-color-scheme sans casser Outlook.',
    status: 'testing',
    priority: 'basse',
    assignees: ['IR'],
    dueDate: '2026-11-21',
    labels: ['Design'],
    estimateMinutes: 240,
    recurrence: 'none',
    checklist: [],
    comments: [],
  }),
  task({
    id: 'CAD-493',
    parentId: null,
    name: 'Invitations par lien avec expiration',
    description:
      'Lien d’invitation réutilisable, limité à un domaine et à une durée (1, 7 ou 30 jours), révocable depuis la page Membres.',
    status: 'triage',
    priority: 'moyenne',
    assignees: ['LP'],
    dueDate: '2026-11-22',
    labels: ['Back'],
    estimateMinutes: 300,
    recurrence: 'none',
    checklist: [
      { label: 'Génération et révocation', done: false },
      { label: 'Restriction par domaine', done: false },
      { label: 'Expiration configurable', done: false },
    ],
    comments: [],
  }),
  task({
    id: 'CAD-494',
    parentId: null,
    name: 'Rédiger la note de version 3.2',
    description: 'En attente du gel des fonctionnalités du 21 novembre.',
    status: 'waiting',
    priority: 'basse',
    assignees: [],
    dueDate: '2026-11-25',
    labels: ['Docs'],
    estimateMinutes: 120,
    recurrence: 'weekly',
    checklist: [],
    comments: [],
  }),
  task({
    id: 'CAD-470',
    parentId: null,
    name: 'Webhook de facturation reçu en double',
    description:
      'Le prestataire de paiement renvoie l’événement invoice.paid deux fois ; il faut dédoublonner par identifiant d’événement. Bloqué : accès au tableau de bord du prestataire en attente.',
    status: 'blocked',
    priority: 'urgente',
    assignees: ['HD'],
    dueDate: '2026-11-05',
    labels: ['Facturation', 'Bug'],
    estimateMinutes: 180,
    recurrence: 'none',
    checklist: [
      { label: 'Reproduire en environnement de test', done: true },
      { label: 'Clé d’idempotence', done: false },
      { label: 'Rejouer les événements manqués', done: false },
      { label: 'Alerte de supervision', done: false },
    ],
    comments: [
      {
        author: 'HD',
        body: 'Bloqué tant que nous n’avons pas l’accès en lecture au tableau de bord du prestataire.',
      },
      { author: 'CM', body: 'Demande envoyée au propriétaire du compte, réponse attendue lundi.' },
    ],
  }),
  task({
    id: 'CAD-466',
    parentId: null,
    name: 'Rotation des clés de session',
    description: 'Rotation hebdomadaire automatique, sans déconnecter les sessions actives.',
    status: 'done',
    priority: 'haute',
    assignees: ['HD'],
    dueDate: '2026-11-03',
    labels: ['Sécurité'],
    estimateMinutes: 240,
    recurrence: 'none',
    checklist: [],
    comments: [],
  }),
  task({
    id: 'CAD-468',
    parentId: null,
    name: 'Sélecteur d’organisation après connexion',
    description: 'Liste des organisations, invitations en attente et création d’organisation.',
    status: 'done',
    priority: 'moyenne',
    assignees: ['CM'],
    dueDate: '2026-11-04',
    labels: ['Front'],
    estimateMinutes: 180,
    recurrence: 'none',
    checklist: [],
    comments: [],
  }),
  task({
    id: 'CAD-471',
    parentId: null,
    name: 'Vérification de l’adresse par code',
    description:
      'Code à 6 chiffres valable 10 minutes, renvoi limité à une fois toutes les 30 secondes.',
    status: 'done',
    priority: 'moyenne',
    assignees: ['LP'],
    dueDate: '2026-11-06',
    labels: ['Auth'],
    estimateMinutes: 180,
    recurrence: 'none',
    checklist: [],
    comments: [],
  }),
  task({
    id: 'CAD-473',
    parentId: null,
    name: 'Thème sombre : jetons de couleur',
    description: 'Jetons sombres de surfaces, filets et teintes vives, contrastes vérifiés.',
    status: 'done',
    priority: 'basse',
    assignees: ['IR'],
    dueDate: '2026-11-07',
    labels: ['Design'],
    estimateMinutes: 360,
    recurrence: 'none',
    checklist: [],
    comments: [],
  }),
  task({
    id: 'CAD-457',
    parentId: null,
    name: 'Connecteur Slack (première version)',
    description:
      'Abandonné : les webhooks sortants couvrent le besoin sans dépendre d’un service tiers.',
    status: 'cancelled',
    priority: 'moyenne',
    assignees: ['HD'],
    dueDate: '2026-10-30',
    labels: ['Back'],
    estimateMinutes: 360,
    recurrence: 'none',
    checklist: [],
    comments: [],
  }),
  task({
    id: 'CAD-483',
    parentId: 'CAD-482',
    name: 'Messages d’erreur et verrouillage',
    description: 'Sous-tâche de CAD-482.',
    status: 'progress',
    priority: 'haute',
    assignees: ['HD'],
    dueDate: '2026-11-11',
    labels: [],
    estimateMinutes: 180,
    recurrence: 'none',
    checklist: [],
    comments: [],
  }),
  task({
    id: 'CAD-484',
    parentId: 'CAD-482',
    name: 'Tests de bout en bout du SSO',
    description: 'Sous-tâche de CAD-482.',
    status: 'todo',
    priority: 'moyenne',
    assignees: ['IR'],
    dueDate: '2026-11-12',
    labels: [],
    estimateMinutes: 120,
    recurrence: 'none',
    checklist: [],
    comments: [],
  }),
  task({
    id: 'CAD-485',
    parentId: 'CAD-482',
    name: 'Documenter la connexion SSO',
    description: 'Sous-tâche de CAD-482.',
    status: 'done',
    priority: 'basse',
    assignees: ['LP'],
    dueDate: '2026-11-09',
    labels: [],
    estimateMinutes: 60,
    recurrence: 'none',
    checklist: [],
    comments: [],
  }),
  task({
    id: 'CAD-489',
    parentId: 'CAD-483',
    name: 'Verrouillage après 5 essais',
    description: 'Sous-tâche de CAD-483.',
    status: 'todo',
    priority: 'haute',
    assignees: ['HD'],
    dueDate: '2026-11-11',
    labels: [],
    estimateMinutes: 60,
    recurrence: 'none',
    checklist: [],
    comments: [],
  }),
  task({
    id: 'CAD-492',
    parentId: 'CAD-483',
    name: 'Message « compte verrouillé »',
    description: 'Sous-tâche de CAD-483.',
    status: 'done',
    priority: 'moyenne',
    assignees: ['HD'],
    dueDate: '2026-11-10',
    labels: [],
    estimateMinutes: 30,
    recurrence: 'none',
    checklist: [],
    comments: [],
  }),
  task({
    id: 'CAD-486',
    parentId: 'CAD-488',
    name: 'Jauges par quota',
    description: 'Sous-tâche de CAD-488.',
    status: 'todo',
    priority: 'haute',
    assignees: ['IR'],
    dueDate: '2026-11-16',
    labels: [],
    estimateMinutes: 180,
    recurrence: 'none',
    checklist: [],
    comments: [],
  }),
  task({
    id: 'CAD-487',
    parentId: 'CAD-488',
    name: 'Alertes à 80 % et 95 %',
    description: 'Sous-tâche de CAD-488.',
    status: 'todo',
    priority: 'moyenne',
    assignees: ['HD'],
    dueDate: '2026-11-18',
    labels: [],
    estimateMinutes: 120,
    recurrence: 'none',
    checklist: [],
    comments: [],
  }),
]);

/**
 * Constant TASKS_BY_ID
 *
 * @description
 * The same tasks, by mockup id.
 *
 * @type {ReadonlyMap<string, FixtureTask>}
 */
const TASKS_BY_ID: ReadonlyMap<string, FixtureTask> = new Map<string, FixtureTask>(
  TASKS.map((item: FixtureTask): [string, FixtureTask] => [item.id, item]),
);

/**
 * Constant SPRINT_14
 *
 * @description
 * The whole fixture, built once.
 *
 * @type {Sprint14Fixture}
 */
const SPRINT_14: Sprint14Fixture = Object.freeze({
  today: '2026-11-08',
  space: SPACE,
  sprint: SPRINT,
  statuses: STATUSES,
  tasks: TASKS,
  task: (id: string): FixtureTask => {
    const found: FixtureTask | undefined = TASKS_BY_ID.get(id);
    if (found === undefined) {
      throw new Error(`Sprint 14 of the mockup has no task ${id}.`);
    }
    return found;
  },
});

/**
 * Function sprint14
 *
 * @description
 * Returns Sprint 14 of the space Produit: the sprint that runs from 3 to 17 November 2026, its
 * statuses and its tasks, `CAD-482` among them. Assignees are initials of the people of
 * `atelierNord()`. The data is frozen: spread it to derive a variant.
 *
 * @returns {Sprint14Fixture} The space, the sprint, the statuses and the tasks.
 */
export function sprint14(): Sprint14Fixture {
  return SPRINT_14;
}

/**
 * Function statuses
 *
 * @description
 * Returns the ten default statuses of the mockup, with their French labels and categories.
 *
 * @returns {readonly FixtureStatus[]} The statuses, in the order of the mockup.
 */
export function statuses(): readonly FixtureStatus[] {
  return STATUSES;
}
