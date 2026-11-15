# Agent guide

## Project

Issue-to-PR is a workflow orchestrator in TypeScript whose goal is to transform tasks from management tools into draft Pull Requests through processes started from a chat. The design and planned phases are in `PLAN.md`; do not assume that everything described there is already implemented.

## Structure

- `src/domain/`: workflow contracts and logic, independent of SDKs and persistence.
- `src/application/`: context preparation and handling.
- `src/adapters/`: integrations with Linear, Figma, SQLite, and Git worktrees.
- `src/index.ts`: public exports.
- `test/`: tests with the Node.js test runner.
- `docs/`: provider-specific documentation for context providers, migrations, and worktrees.
- `dist/`: generated build output; modify the sources in `src/`.

## Environment and commands

Node.js >= 22.13.0 is required. Install dependencies with `npm ci` when necessary.

- `npm run build`: generates `dist/index.js` with esbuild.
- `npm run typecheck`: checks types without emitting files.
- `npm run lint`: runs ESLint.
- `npm run format`: applies Prettier to the project.
- `npm test`: compiles and runs the tests.
- `npm run check`: runs typecheck, lint, and tests.

## Code conventions

- Separate distinct stages and responsibilities with blank lines; it is not necessary to separate every statement.
- Name intermediate expressions when it helps explain their purpose, especially if they combine several operations.
- Extract functions for operations with a recognizable responsibility, not only to reduce the number of lines.
- Adjust the detail of names to their scope: in callbacks or immediate uses, brief names are acceptable if they are unambiguous; the larger the scope or the distance between declaration and use, the more descriptive the name must be. Avoid ambiguous abbreviations even in small scopes.
- In GraphQL queries, write each field on its own line to make them easier to read and review.

## Change validation

When you finish changes, run `npm run format` and then `npm run check`.
