# Code quality for assistants

Use this guide when maintaining Cadenway's assistant instructions or reviewing how an assistant
applies them. Start with the owning checkout's `AGENTS.md`, `CLAUDE.md`, and the rules that match
the affected files. The workspace's repository map identifies the owner for cross-repository work.
Repository instructions must be usable from that checkout alone.

## Maintain the instruction sources

- When a repository provides `cw-quality`, keep its ordered procedure in the development guide.
  Have the Codex skill and Claude command point to that procedure. Check it against the package
  scripts and any additional local checks when one of them changes.
- Keep scoped rules equivalent on both platforms. Use the `paths` declared in each rule as the
  source for its scope. Verify that a new source or test layout still matches the selectors.
- Edit a specialist in its owning repository first. Compare the workspace Codex copy with the
  repository's file when the role changes. Make sure each listed role has an owning checkout.

## Common instructions

Keep the short block below in the repository's `AGENTS.md`. Put concrete repository conventions,
commands, and examples in the existing scoped rules or quality instructions. Where Codex and Claude
have separate copies, keep the behavior and file coverage equivalent. Specialized agents should
point to the applicable rule when their task needs it.

```markdown
## Code quality

- Read the affected entry point, its callers, and its relevant tests before editing.
  Preserve the behavior callers rely on unless the task changes it.
- Keep the diff focused. Use names that express intent and reuse existing code when
  it preserves the required behavior. Extract code when it clarifies a responsibility.
- Keep business decisions with their owning module. Validate external inputs at the
  boundary and use documented public interfaces across modules and repositories.
- For writes that can fail, overlap, or be retried, verify the resulting state.
  Check transaction boundaries, tenant scope, and repeated delivery where relevant.
- For collections and repeated work, check what grows with input size. Measure or
  inspect the bottleneck before adding an index, cache, worker, or replica.
- Run the repository checks that cover the affected behavior. Report the commands
  and their results, including checks that did not run and tests that selected zero cases.
```

When a change crosses repositories, follow the published contract and package through the producing
service, the gateways and event consumers, and then the webapp. Review each change against the
dependencies installed in its checkout. Update the owning `MODULE.md` or `FEATURE.md` when public
entry points or documented behavior change.

## Decisions and evidence

The task examples illustrate future behavior. They describe review cases without assuming the
corresponding feature is present in the checkout.

| Situation                                  | Risk in the proposed change                                                               | Expected decision and evidence                                                                                                                                                                                     |
| ------------------------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A sign-in error message needs correction   | Reorganizing controllers broadens the risk to HTTP behavior and session handling.         | Change the message mapping. Check the expected text and any response status and problem code the client depends on.                                                                                                |
| A task changes status                      | A catch-all task manager mixes the HTTP boundary, business rule, and write orchestration. | Put the invariant in the task domain, the transaction in the `ChangeTaskStatus` use case, and response mapping in the controller. Exercise the transition in a domain test.                                        |
| An external response has an optional field | A cast hides the missing value, or a gateway adds an undocumented field.                  | Handle the missing case according to the contract. Start a contract change in the spec and regenerate the client. Check the actual response at the HTTP boundary.                                                  |
| A task write emits an event                | Separate transactions can commit the task without its event.                              | Persist the task and its outbox row in one transaction. With PostgreSQL, verify that an outbox write failure rolls back the task write.                                                                            |
| A consumer receives a duplicate delivery   | Replaying the same event can create a second notification.                                | Deduplicate by event ID at the owning consumer's persistence boundary. Deliver the same event twice and verify one business effect.                                                                                |
| A request reads organization data          | Taking the organization from the request body allows a caller-controlled scope.           | Scope the read from the verified request context. Exercise the same query from two organizations and verify the boundary.                                                                                          |
| A page shows task assignees                | A lookup inside the task loop adds work per row.                                          | Use the contract's page limit and stable ordering. Load related data in a bounded batch through the owning service. Check the query count for a full page and inspect the query plan before proposing a new index. |
| A gateway route is slow                    | Caching session introspection without measuring its cost can extend a revoked session.    | Time introspection, account lookup, and database wait separately for `GET /v1/me`. Preserve revocation on the next request and compare candidates at equivalent load and resources.                                |
| A list or optimistic update fails          | An empty array hides a failed read, or a toast leaves a rejected status visible.          | Keep failure and successful emptiness distinct. Provide retry for the read and restore the last confirmed value after a rejected update. Assert the visible outcome.                                               |

## Choose checks by the change

Use the actual commands in the repository's quality instructions and package scripts. Report a
precondition such as unavailable Docker when it prevents a check.

| Change                                               | Focused checks                                                                                                                                          |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Documentation or tooling instructions                | Check the changed files' formatting, resolvable local links, rule path selectors, and command references. Compare the scoped Codex and Claude guidance. |
| Domain rule                                          | Exercise the changed invariant and the relevant boundary case. Reuse an existing test when it detects the regression.                                   |
| Public route, event, or module entry                 | Check compatibility, generated artifacts, documented consumers, and the affected response or error.                                                     |
| Database transaction, asynchronous handler, or query | Exercise the relevant rollback, isolation, redelivery, or query cost with the applicable dependency.                                                    |
| Frontend state                                       | Exercise loading, successful emptiness, retry, or optimistic rollback as affected. Use the store or component's public behavior.                        |
| Performance change                                   | Establish the bottleneck and compare the same workload under equivalent conditions. Record unmeasured effects as such.                                  |

For each review finding, cite the relevant rule and source location, explain the observable
consequence, and propose a focused correction. Lead with a contract, isolation, or data integrity
regression when present. If the scoped change already satisfies the applicable rules, report no
findings.

> The assignee repository runs once per task in the loop. A page of 50 tasks can add up to 50
> queries. Load assignees in a batch within the owning service and verify the query count for a
> full page.

The upper bound in this example comes from reading the loop. Only claim a measured query count or
latency when a check actually ran. At delivery, identify the commands and their results. A targeted
command that exits successfully with zero executed tests leaves that behavior unverified.

## Read-only review exercises

Run the same exercises in separate, fresh Codex and Claude Code sessions. Start once at the
workspace root, with the pilot checkout accessible, and once in the pilot checkout. Use the
read-only controls available in each assistant. Record the assistant, starting directory, case,
rule cited, diagnosis, and suggested verification. Give each session only the review prompt and
the excerpts in its batch. Compare its response with the expected outcomes afterward.

### Review prompt

> Read-only review of hypothetical excerpts for the named Cadenway repository. Read its
> `AGENTS.md`, `CLAUDE.md`, and the relevant scoped rules for this assistant. Leave the shared
> assistant code quality guide unopened during this exercise. Do not edit, run tests, or assume
> the hypothetical files exist in the checkout. For each case, state the
> applicable rule and document, the concrete consequence or why there is no finding, and one
> focused check when needed. Distinguish the evidence in the excerpt from checks actually run.

### Task service batch

```text
Repository: cadenway-task-service

T1. In src/modules/tasks/application/use-cases/commands/lifecycle/change-task-status/change-task-status.use-case.ts,
the use case commits the new status, then writes an outbox row in a separate transaction.
The second write may throw.

T2. In src/modules/tasks/infrastructure/persistence/drizzle/repositories/task/drizzle-task.repository.ts,
the query reads an organization-scoped page of at most 50 tasks and then looks up the
assignee inside the loop for each task.

T3. A targeted integration invocation exits 0. Its output explicitly reports zero tests
executed.
```

- **T1** cites the application or events rule. A committed status can survive a failed outbox write.
  Move the outbox write into the same transaction and verify rollback with PostgreSQL.
- **T2** cites the persistence rule, identifies up to 50 additional calls from the loop, and
  proposes a bounded batch. The finding does not claim a measured query count or latency.
- **T3** cites the tests rule or quality instructions. The process exit code is successful and the
  integration behavior remains unverified. Check the filter and confirm that the intended test ran.

### Webapp batch

```text
Repository: cadenway-webapp

W1. In src/app/features/task/data-access/services/task/task.service.ts, a rejected API call
returns [] to the store. The page renders its empty state.

W2. In src/app/features/task/state/task/task.store.ts, an optimistic status change shows
an error toast after rejection and leaves the rejected status visible.

W3. A French label in src/app/features/task/ui/components/task-row/task-row.component.html
was checked against the mockup and now matches it. The same component and accessible role
remain. The focused spec executed one test and passed. Lint and the strict-template build
also passed. The diff includes just the label and assertion.
```

- **W1** cites the data-access or state rule and distinguishes a failed load from an empty
  successful result. Retain an error state and verify that the user can retry.
- **W2** cites the state rule and calls for restoring the last confirmed status. Verify the
  displayed status after the rejected write.
- **W3** finds the scoped change acceptable. The check results are evidence supplied by the
  excerpt. The assistant should report no finding or additional work for this example.

The pilot succeeds when both assistants find the relevant local rules from both starting
directories, identify the expected consequence in each failing case, and accept W3. Report any
session that could not be run separately from the sessions that passed.
