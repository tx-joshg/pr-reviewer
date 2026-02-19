# PR Reviewer

AI-powered senior developer PR review with auto-fix capabilities. Uses OpenAI to perform a comprehensive code review on every pull request, automatically fixing trivial issues and creating GitHub Issues for tech debt.

Works with **any project** — configure once and every PR gets reviewed automatically. Pairs with a local MCP server for a Cursor-based feedback loop.

## Features

- **Automated senior-dev review** on every PR (schema safety, auth, multi-tenancy, tests, docs, code quality, security, GUI patterns)
- **Auto-fix trivial issues** — unused imports, formatting, simple type fixes are committed directly
- **Tech debt tracking** — non-blocking issues are filed as GitHub Issues with `tech-debt` label
- **Blocking checks** — critical issues (security, missing auth, tenant scope) block the PR until fixed
- **Structured output** — review findings are machine-parseable for integration with MCP servers and Cursor
- **Reusable** — one action repo, per-project config files

## System Overview

```
PR opened/updated
    │
    ▼
GitHub Action (this repo)
    ├── Fetches PR diff, files, commits
    ├── Loads project-specific review-config.yml
    ├── Sends to OpenAI for structured review
    ├── Auto-fixes trivial suggestions (Level 2)
    ├── Creates GitHub Issues for tech debt
    ├── Posts review (approve / request changes)
    ├── Sets commit status (pass / fail)
    └── Merges PR (if approved + auto-merge enabled)
    │                           │
    │ (if blocking)             ▼
    │                    Deploys from main
    ▼                   (Railway, Vercel, etc.)
Cursor + MCP Server (local)
    ├── Fetches structured findings from PR
    ├── Queries dev/prod database for context
    ├── You fix the issues with AI assistance
    └── Push → action re-runs → passes → merges → deploys
```

---

## Quick Setup (5 minutes per project)

### Step 1: Add the workflow file

Create `.github/workflows/pr-review.yml` in your project:

```yaml
name: PR Review
on:
  pull_request:
    types: [opened, synchronize]

permissions:
  contents: write
  pull-requests: write
  issues: write
  statuses: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/create-github-app-token@v1
        id: app-token
        with:
          app-id: ${{ secrets.APP_ID }}
          private-key: ${{ secrets.APP_PRIVATE_KEY }}

      - uses: tx-joshg/pr-reviewer@main
        with:
          review_config: .github/review-config.yml
          openai_api_key: ${{ secrets.OPENAI_API_KEY }}
          github_token: ${{ steps.app-token.outputs.token }}

      - name: Merge PR
        env:
          GH_TOKEN: ${{ steps.app-token.outputs.token }}
        run: gh pr merge ${{ github.event.pull_request.number }} --squash --admin
```

### Step 2: Create the review config

Create `.github/review-config.yml` with rules specific to your project. See [Config Examples](#config-examples) below for templates.

### Step 3: Add secrets

In your GitHub repo: Settings > Secrets and variables > Actions > New repository secret:

- `OPENAI_API_KEY` — your OpenAI API key
- `APP_ID` — your GitHub App's ID
- `APP_PRIVATE_KEY` — your GitHub App's private key (PEM format)

### Step 4: Configure branch protection

In your GitHub repo: Settings > Rules > New ruleset for `main`:

- **Require status checks to pass before merging**: select `pr-review`
- **Require a pull request before merging**: set required approvals to **0** — the `pr-review` status check is the gate, not human approvals
- **Add the GitHub App as a bypass actor** so the `--admin` merge works

### Step 5 (optional): Set up the MCP server for Cursor

To get the review feedback loop in Cursor, add the MCP server to your project. See [MCP Server Setup](#mcp-server-setup).

---

## Action Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `review_config` | Yes | `.github/review-config.yml` | Path to review config |
| `openai_api_key` | Yes | — | OpenAI API key |
| `github_token` | Yes | — | GitHub token with repo permissions |
| `database_url` | No | — | Read-only database URL |
| `auto_fix` | No | `true` | Enable auto-fix for trivial issues |
| `auto_merge` | No | `true` | Merge the PR after a passing review (only when auto-merge is enabled on the PR) |
| `model` | No | `gpt-5.2-codex` | OpenAI model to use |

---

## Finding Severities

| Severity | Action | Examples |
|----------|--------|----------|
| **blocking** | Posts "Request Changes", fails status check | Security vulnerabilities, missing auth, missing tenant scope, breaking migrations, intent mismatch |
| **suggestion** | Auto-fixed and committed (Level 2) | Unused imports, formatting, simple type improvements |
| **tech_debt** | Creates a GitHub Issue, does not block | Missing tests, TODO comments, code duplication, documentation gaps |

---

## Config Examples

### Config Reference

All available config fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `project_type` | string | Yes | Project identifier (e.g. `express-drizzle`, `nextjs-prisma`) |
| `language` | string | Yes | Primary language (`typescript`, `python`, etc.) |
| `schema.orm` | string | No | ORM name (`drizzle`, `prisma`, `sqlalchemy`) |
| `schema.path` | string | No | Path to schema definition file |
| `multi_tenancy.enabled` | boolean | No | Whether multi-tenancy checks are active |
| `multi_tenancy.scope_column` | string | No | Column name used for tenant scoping |
| `multi_tenancy.check_description` | string | No | Human-readable description of the scoping rule |
| `multi_tenancy.applies_to` | string[] | No | Limit multi-tenancy checks to these paths only |
| `auth.provider` | string | No | Auth provider name (`clerk`, `next-auth`, etc.) |
| `auth.middleware_import` | string | No | Import path for auth middleware |
| `auth.protected_routes` | string | No | Route pattern that requires auth |
| `auth.except` | string[] | No | Routes exempt from auth requirement |
| `auth.applies_to` | string[] | No | Limit auth checks to these paths only |
| `testing.framework` | string | No | Test framework (`vitest`, `jest`, `pytest`) |
| `testing.test_dir` | string | No | Directory containing tests |
| `testing.source_dirs` | string[] | No | Source directories that should have test coverage |
| `routes.file` | string | No | File or directory containing route definitions |
| `routes.data_access` | string | No | File or directory for data access layer |
| `exclude_paths` | array | No | Paths to skip for application-level checks |
| `exclude_paths[].path` | string | — | Glob or directory path to exclude |
| `exclude_paths[].reason` | string | — | Why this path is excluded (shown to the LLM) |
| `conventions` | string[] | No | Project-specific rules the reviewer must respect |

### TypeScript + Express + Drizzle (multi-tenant SaaS)

```yaml
project_type: express-drizzle
language: typescript

schema:
  orm: drizzle
  path: shared/schema.ts

multi_tenancy:
  enabled: true
  scope_column: companyId
  check_description: "All storage methods and routes must filter by companyId"
  applies_to: [server/routes.ts, server/storage.ts]

auth:
  provider: clerk
  middleware_import: "@clerk/express"
  protected_routes: "/api/*"
  except: ["/api/health", "/api/stripe/webhook"]
  applies_to: [server/routes.ts]

testing:
  framework: vitest
  test_dir: tests/
  source_dirs: [server/, client/src/, shared/]

routes:
  file: server/routes.ts
  data_access: server/storage.ts

exclude_paths:
  - path: "client/src/components/ui/"
    reason: "Shared UI primitives — no auth or tenant logic"
  - path: "scripts/"
    reason: "Build/dev scripts, not application code"

conventions:
  - "All API routes are defined in server/routes.ts — do not add routes elsewhere"
  - "Storage methods in server/storage.ts always receive companyId as the first parameter"
  - ".env.example and .cursor/mcp.json.example contain placeholder values, not real secrets"
```

### Next.js + Prisma

```yaml
project_type: nextjs-prisma
language: typescript

schema:
  orm: prisma
  path: prisma/schema.prisma

multi_tenancy:
  enabled: false

auth:
  provider: next-auth
  middleware_import: next-auth/react
  protected_routes: "/api/*"
  except: ["/api/auth"]
  applies_to: [app/api/, pages/api/]

testing:
  framework: jest
  test_dir: __tests__/
  source_dirs: [src/, pages/, app/]

routes:
  file: app/api/
  data_access: lib/db.ts

exclude_paths:
  - path: "public/"
    reason: "Static assets, no application logic"

conventions:
  - "Server actions use 'use server' directive — they do not need API route auth middleware"
```

### Python + FastAPI + SQLAlchemy

```yaml
project_type: fastapi-sqlalchemy
language: python

schema:
  orm: sqlalchemy
  path: app/models/

multi_tenancy:
  enabled: true
  scope_column: organization_id
  check_description: "All queries must filter by organization_id"
  applies_to: [app/api/, app/crud/]

auth:
  provider: custom-jwt
  middleware_import: app.auth
  protected_routes: "/api/v1/*"
  except: ["/api/v1/health", "/api/v1/auth/login"]
  applies_to: [app/api/]

testing:
  framework: pytest
  test_dir: tests/
  source_dirs: [app/]

routes:
  file: app/api/
  data_access: app/crud/

exclude_paths:
  - path: "alembic/"
    reason: "Migration scripts — reviewed separately"
  - path: "app/core/config.py"
    reason: "Settings module using pydantic-settings, not hardcoded secrets"
```

### Minimal config (any project)

The only required fields are `project_type` and `language`. Everything else is optional:

```yaml
project_type: generic
language: typescript

testing:
  framework: vitest
  test_dir: tests/
  source_dirs: [src/]
```

Even without project-specific config, the reviewer applies universal baseline rules (`.example` files aren't secrets, single-query + `.map()` isn't N+1, lock files are skipped, config values aren't magic strings).

---

## MCP Server Setup

The MCP server runs locally and bridges the automated GitHub review back into Cursor. It provides tools to fetch review findings, query databases, and inspect your schema.

### 1. Install dependencies

Add these to your project (if not already present):

```bash
npm install @modelcontextprotocol/sdk @octokit/rest pg
```

### 2. Copy the MCP server files

Copy the `mcp-server/` directory from the reference implementation (see [actemore](https://github.com/tx-joshg/actemore) for an example):

```
mcp-server/
  index.ts                # Entry point, registers tools, starts stdio transport
  types.ts                # Shared TypeScript types
  tools/
    github-tools.ts       # get_review_findings, list_tech_debt_issues, re_request_review
    database-tools.ts     # query_database, get_table_info
    codebase-tools.ts     # get_drizzle_schema, check_test_coverage
```

### 3. Configure Cursor

Create `.cursor/mcp.json` (add this file to `.gitignore` — it contains secrets):

```json
{
  "mcpServers": {
    "pr-reviewer": {
      "command": "node",
      "args": ["--import", "tsx/esm", "mcp-server/index.ts"],
      "env": {
        "GITHUB_TOKEN": "<personal access token with repo scope>",
        "GITHUB_OWNER": "<your-github-username>",
        "GITHUB_REPO": "<your-repo-name>",
        "DATABASE_URL_DEV": "postgresql://user@localhost:5432/mydb",
        "DATABASE_URL_PROD": "postgresql://readonly_user:pass@host:port/db"
      }
    }
  }
}
```

Commit a `.cursor/mcp.json.example` with placeholder values so other devs know what's needed.

### 4. Add the Cursor rule

Create `.cursor/rules/pr-review.mdc` to teach Cursor the review workflow. See the [actemore example](https://github.com/tx-joshg/actemore/blob/main/.cursor/rules/pr-review.mdc).

### 5. Create a GitHub Personal Access Token

Go to https://github.com/settings/tokens and create a token with `repo` scope. This is used by the MCP server to fetch PR reviews and create comments.

### MCP Tools Available

| Tool | Description |
|------|-------------|
| `get_review_findings(pr_number)` | Fetches structured review findings from a PR |
| `list_tech_debt_issues(labels?)` | Lists open tech-debt issues created by the reviewer |
| `re_request_review(pr_number)` | Posts a comment requesting re-review |
| `query_database(sql, environment)` | Runs read-only SQL against dev or prod (5s timeout, 100 row limit) |
| `get_table_info(table_name, environment?)` | Returns columns, indexes, constraints, row count |
| `get_drizzle_schema()` | Reads and parses the Drizzle schema file |
| `check_test_coverage(file_paths)` | Checks if source files have corresponding test files |

---

## Cursor Workflow

Once everything is set up, the workflow looks like this:

1. Push your branch and open a PR
2. The GitHub Action automatically reviews it (1-2 minutes)
3. If issues are found, open Cursor and say: **"Review PR #42"**
4. Cursor uses the MCP tools to fetch findings and fix them
5. Push the fixes — the action re-runs automatically
6. When it passes, the workflow merges the PR automatically and Railway (or your deployment platform) deploys from main

---

## New Project Checklist

When adding PR Reviewer to a new project:

- [ ] Create a GitHub App with `Contents: write` and `Pull requests: write` permissions
- [ ] Add `APP_ID` and `APP_PRIVATE_KEY` as repo secrets
- [ ] Add `OPENAI_API_KEY` as a GitHub repo secret
- [ ] Create `.github/workflows/pr-review.yml` (copy from Quick Setup above)
- [ ] Create `.github/review-config.yml` (use a Config Example as starting point)
- [ ] Set up a ruleset on `main` (require `pr-review` status check, 0 required approvals)
- [ ] Add the GitHub App as a bypass actor in the repository ruleset
- [ ] (Optional) Copy `mcp-server/` directory and configure `.cursor/mcp.json`
- [ ] (Optional) Add `.cursor/rules/pr-review.mdc` for the Cursor feedback loop
- [ ] (Optional) Add `.cursor/mcp.json` to `.gitignore`, commit `.cursor/mcp.json.example`

---

## Development

```bash
npm install
npm run build        # Bundle with esbuild to dist/
npm run typecheck    # Type check without emitting
```

When making changes to the action, rebuild and commit `dist/index.mjs` — GitHub Actions runs the compiled bundle directly.
