# PLAN.md — Issue-to-PR Agent Workflow

## Goal

Build a workflow orchestrator in TypeScript that transforms a Linear issue into a draft Pull Request through Pi agents supervised from Herdr.

The system must be predictable, recoverable after failures, easily extensible, and maintain a lightweight hexagonal architecture.

## Design principles

1. **Deterministic outside, agentic inside.** Code determines transitions, verifications, and approvals; implementation decisions belong to the agents.
2. **TypeScript first.** The domain, application, and adapters are implemented in TypeScript. Compatibility JavaScript is only allowed when the runtime requires it.
3. **Minimal abstractions.** Introduce interfaces only to separate real responsibilities or enable testing.
4. **No framework dependency in the domain.** The domain must not import Pi, Linear, Slack, GitHub SDKs, or persistence libraries.
5. **Explicit state.** No important decision should depend exclusively on the history of a conversation.
6. **Recoverable operations.** External actions must be reconcilable after a restart, avoiding duplications.
7. **Tests before expansion.** Each phase must be validated before adding functionality.

## Functional requirements

### Start

- The user manually starts a workflow from Pi by specifying a Linear issue.
- The description, acceptance criteria, attachments, and references are retrieved.
- Figma context is retrieved when relevant links exist.
- The absence of mandatory context blocks implementation.

### Planning

- An agent generates a structured technical plan.
- The user must always approve the plan before modifying the code.
- A rejected plan can be revised and presented again.
- A substantial change in scope invalidates the approval.

### Worktrees

- The main repository directory stays on the `main` branch.
- Each issue works on an independent branch and worktree.
- Recovering existing worktrees associated with an issue is allowed.
- A workflow run does not delete its worktree or branch, so interrupted or retried work can resume.
- When the task is completed, a cleanup step removes all the worktrees and branches created for that task and deletes their ownership records.
- Cleanup is not tied to a single merge: a task can span multiple PRs, so it runs only after the task reaches its completed state.
- Cleanup is safe and idempotent: it takes the same locks as creation, can resume after an interruption, and never discards uncommitted work or branches not merged into `main`.
- The `main` branch is never modified from an agentic run.
- Concurrent operations on the same worktree are blocked.

### Implementation

- A single developer agent keeps its context across iterations.
- The developer implements the approved plan, modifies tests, and fixes findings.
- It cannot publish the PR directly.
- The workflow limits correction cycles and allows human intervention.

### Verification and review

- Verification commands are defined in the repository.
- Lint, tests, typecheck, and build must pass when applicable.
- Three independent reviewers evaluate:
  - Correctness and regressions.
  - Test coverage and quality.
  - Unnecessary complexity, YAGNI, and simplicity.
- Each reviewer returns a structured result validated with Zod.
- Reviews must refer to the same code snapshot.
- Any subsequent change invalidates previous approvals.

### Publication

- The system verifies the approved snapshot again.
- It publishes the changes through a commit and a feature branch.
- It creates or reuses a draft PR.
- It records the PR URL and links it to the issue.
- Publication must be recoverable and idempotent.

### Slack (optional)

- Publish important events in one thread per workflow.
- Show planning, pending approvals, failures, and published PR.
- Store the thread identifier to resume notifications.
- The absence of Slack must never block the workflow.
- Do not implement interactive approvals from Slack in the first version.

## Architecture

### Domain

Contains:

- `WorkflowState`
- `WorkflowEvent`
- `TaskContext`
- `ImplementationPlan`
- `ReviewResult`
- `VerificationResult`
- Transition and approval rules
- Retry and complexity policies

The domain must be pure and testable without external services.

### Application

Implements the `IssueToPR` use case and coordinates the stages through ports.

Initial ports:

- `IssueProvider`
- `DesignProvider`
- `AgentRunner`
- `WorktreeManager`
- `VerificationRunner`
- `PullRequestPublisher`
- `RunRepository`
- `EventPublisher`

Avoid creating a port for every individual function.

### Adapters

Implement specific adapters:

- Linear GraphQL
- Figma MCP
- Pi / pi-extensible-workflows
- Git worktrees
- GitHub CLI
- SQLite
- Slack Web API

The application receives its dependencies through explicit construction.

### Persistence

Use SQLite initially.

Persist:

- Workflow ID and issue ID.
- Current state, version, and timestamp.
- Branch, worktree, and base commit.
- Approved plan and its version.
- References to artifacts.
- Execution and review attempts.
- Reviewed code snapshot.
- PR URL and publication state.
- Slack thread identifier.
- History of events and relevant errors.

Use a `RunRepository` that exposes atomic load, create, and update operations with version control.

Do not use Pi's history as the source of truth for business transitions.

## Milestones

### M0 — Initialization and contracts

- [x] Initialize a Node.js + TypeScript project in strict mode.
- [x] Configure esbuild, the Node test runner, ESLint, and build and typecheck scripts (without Vitest).
- [x] Define initial contracts with Zod and infer types.
- [x] Implement the pure state machine.
- [x] Create tests for valid and invalid transitions.

**Acceptance:** all transitions can be tested without Pi or external APIs.

### M1 — Persistence and worktrees

- [x] Implement the SQLite repository.
- [x] Store state, versions, events, and artifacts.
- [ ] Implement `WorktreeManager`.
  - [ ] Test interruptions during creation and define how to recover partially created branches or worktrees.
  - [ ] Return the base commit so the workflow can persist it.
  - [ ] Connect the manager with persistence to store and restore worktree data.
  - [ ] Test the interruption and resumption of a persisted workflow without losing state or overwriting work.
  - [ ] Define the `WorktreeManager` port so the application does not depend directly on Git.
- [x] Detect existing worktrees by issue and configuration.
- [x] Keep the main checkout on `main` intact during manager operations.
- [x] Add locking by issue/worktree.
- [x] Test manager recovery after a restart.
- [ ] Implement task cleanup: after a task is completed, remove the worktrees and branches created for the task and delete their ownership records.
- [ ] Test cleanup: reuse the creation locks, retry idempotently after an interruption, and preserve worktrees with uncommitted changes or branches not merged into `main`.

The Git adapter covers basic creation, reuse, and locking. Defer the rest of this integration until a workflow consumer exists: then define the port according to its needs and test persistence and recovery end to end. Do not yet assume that Git worktrees will be the only isolation mechanism; a VM could replace or complement it. Recovery from partial interruptions and the base commit are still pending and must be resolved before using the adapter in a real workflow.

**Acceptance:** the workflow can be interrupted and resumed without losing state or overwriting a worktree.

### M2 — Linear and context

**Current status:** `src/application/context.ts` defines the generic ports and collects a validated snapshot with the result of each reference. The Linear and Figma adapters have simulated tests, but they have not been validated with real services. `src/application/prepare-context.ts` connects retrieval with a repository port and persists the snapshot and the transition atomically. `docs/context-providers.md` and `docs/figma-context-source.md` document the configuration and known limitations.

**Work done and pending:**

1. [ ] Complete and verify Linear normalization:
   - [ ] Validate the GraphQL query, authentication, and pagination with a real issue and credentials provided by the user; do not store credentials or private data in the repository. Document how to run the test and what to do if there is no access.
   - [x] Review the current representation: the full description and attachment URLs are preserved; lists are only extracted under specific headings, without inferring criteria. Retrieving additional attachment metadata is deferred until a consumer needs it.
   - [x] Document the current extraction, deduplication, source selection, and `required-context` directive rules, as well as the Markdown limitations. A full Markdown parser and additional classification are deferred until concrete use cases exist.
2. [x] Implement a context source for Figma using `ContextSource`, without coupling the domain or the use case to Figma. Define configuration, permissions, and normalized representation of the retrieved information; test simulated responses and errors. Keep the integration extensible for other sources. Validation with real Figma is still pending.
   - [ ] Investigate and implement a local alternative, such as the Figma MCP server, to retrieve file and node context when the HTTP API reaches its limits. First verify its capabilities, access requirements, and limits: MCP does not guarantee avoiding quotas or working offline. Keep the HTTP API as a configurable option and define explicit selection or fallback, without hiding errors or altering the blocking of mandatory references. Document configuration, permissions, and content differences; test normalization, failures, selection, and snapshot persistence with simulated responses and validate the real integration when possible.
3. [ ] Complete the normalized and reproducible context:
   - [x] Keep in `ContextSnapshot` the issue, the resolved content, the mandatory status, and the result of each reference, including optional failures. `TaskContext` keeps its previous representation.
   - [x] Persist a validated and versioned snapshot as an artifact; reuse it in `planning` and create a new version when retrying a failed retrieval.
   - [ ] Define and implement how to request an explicit update of the already accepted context and how to invalidate subsequent work that depends on the previous version.
4. [ ] Integrate context retrieval with the workflow and persistence:
   - [x] Define the repository port needed for the use case without depending directly on SQLite; use the existing atomic operations and version control.
   - [x] Record the start of attempts, their results, and retries; keep optional failures in the snapshot. Provider error messages are not persisted.
   - [x] Exclude credential and sensitive data filtering from the scope for content and links: it is assumed that Linear, Figma, and the chat do not contain secrets or tokens. Content is persisted unfiltered.
   - [x] On a mandatory failure, record a generic reason and move to `needs_attention` without emitting `context_ready`; keep optional failures without blocking the workflow.
   - [x] Allow and test explicit retry from `needs_attention` when the failure occurred during initial context retrieval.
   - [x] Test recovery after an interruption before the result and conflicts between concurrent attempts, without losing snapshots or duplicating results.
   - [x] Record per reference the errors when selecting a source, just like the errors when resolving it; an optional reference does not block and a mandatory one does.
   - [x] Validate the context and save the artifact, the `context_ready` event, and the state in a single atomic operation.
5. [x] Expand the tests without network or secrets: providers, directives, Figma, snapshots, integrated optional failures, retry, concurrent conflict, and resumption after interruption.
   - [x] Prepare optional integration tests with real Linear and Figma and a temporary SQLite, including pagination and snapshot reuse after a restart. Cases without configuration are skipped; they do not constitute real validation.
6. [x] Document current rules and limitations and how to perform manual validation; run Prettier and `npm run check`.

**Deferrals to continue:** the explicit context update will be designed with planning and approval in M3, so that it invalidates dependent work. Validation with real Linear and Figma requires access and test data provided by the user; until then, the M2 acceptance is not fully met. No secret detection or filtering will be implemented in the context: the user is responsible for not including them in Linear, Figma, or the chat and for severely restricting development credentials.

**Acceptance:** a real issue generates a validated, persisted, and reproducible context; inaccessible mandatory references block progress and their failures are recorded. Resumption and optional failures are covered by tests.

### M3 — Planning and approval

- [ ] Implement the Pi adapter.
- [ ] Run the orchestrator and the agents in separate environments; do not automatically make the orchestrator credentials available to the agents. Define and test this separation when integrating the runner.
- [ ] Generate structured plans.
- [ ] Store the plan as a versioned artifact.
- [ ] Show mandatory approval from Pi.
- [ ] Handle rejections and revisions.
- [ ] Explicitly record the approved plan.

**Acceptance:** no agent modifies code without valid approval.

### M4 — Developer and verifications

- [ ] Run the developer in an environment separate from the orchestrator, with the workspace and development credentials needed for the project. Evaluate Docker Sandboxes or a VM without assuming that Git worktrees provide isolation.
- [ ] Keep the session across corrections.
- [ ] Run deterministic verifications.
- [ ] Store results and evidence.
- [ ] Limit retries.
- [ ] Add failure and resumption tests.

**Acceptance:** a failed verification prevents progress.

### M5 — Independent reviews

- [ ] Implement the correctness reviewer.
- [ ] Implement the test coverage reviewer.
- [ ] Implement the unnecessary complexity reviewer.
- [ ] Run them in parallel on the same snapshot.
- [ ] Validate results with Zod.
- [ ] Return findings to the developer.
- [ ] Invalidate reviews when the code changes.
- [ ] Repeat verification and review after corrections.

**Acceptance:** `ready_for_pr` is only reached if the three reviewers approve the same verified snapshot.

### M6 — GitHub publication

- [ ] Verify the identity of the approved snapshot.
- [ ] Prepare commit and push.
- [ ] Detect an existing PR.
- [ ] Create a draft PR when none exists.
- [ ] Record the publication operation and result.
- [ ] Recover partial failures without duplicating PRs.
- [ ] Link the PR with Linear when credentials allow it.

**Acceptance:** retrying publication does not duplicate unnecessary commits or create two PRs for the same run.

### M7 — Slack

- [ ] Create `SlackEventPublisher`.
- [ ] Generate one thread per workflow.
- [ ] Notify: started, awaiting_approval, review_failed, needs_attention, completed.
- [ ] Persist `channel` and `thread_ts`.
- [ ] Implement retries and detection of already-sent messages.
- [ ] Ensure that Slack errors do not block publication.

**Acceptance:** a workflow can progress without Slack; if configured, its events appear grouped in one conversation.
