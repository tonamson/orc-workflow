# ORC Studio UI

ORC Studio is a self-contained Next.js demo of the approved pixel-office workflow. It uses local typed demo state for workspaces, sessions, tasks, reports and project records. It does not start a CLI, authenticate users, call a backend or save real project files.

## Requirements

- Node.js `^22.12.0 || ^24.0.0 || >=26.0.0`
- npm

Observed for this implementation: Node.js `v26.0.0`, npm `11.12.1`.

## Run

```sh
npm install
npm run dev
```

Then open `http://localhost:3000`. Use the workspace and role selectors to review CEO, employee and client views. The seeded client accounts are `client-a` (customer-a), `client-b` (customer-b), and `client-none` (no grants). Employees can browse meeting records; clients can browse only shared records in explicitly granted workspaces.

The office controls switch between the merged map and room cards, resize the demo to 64 departments, create a department on demand, and search rooms. Click an agent to open its exact session panel. Demo controls assign queued work, submit and review reports, trigger approval, disconnect/reconnect, and request or confirm session closure. Progress changes only after report acceptance. Every panel labels its content as simulated.

## Checks

```sh
npm test
npm run typecheck
npm run build
npm run start
```

Validation details and pending browser review are in [docs/validation/orc-nextjs-ui.md](docs/validation/orc-nextjs-ui.md).
