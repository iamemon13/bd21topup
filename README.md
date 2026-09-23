# BD21 Topup

A production-oriented digital top-up platform built with **Next.js 16, TypeScript, Supabase, PostgreSQL, and Vercel**.

**Live:** https://topup.ekbotix.com/
**Repository:** https://github.com/iamemon13/bd21topup

This repository documents not only the final application, but also the engineering journey: feature development, production bugs, security hardening, database migrations, financial consistency fixes, and deployment troubleshooting.

## What I built

- Supabase Auth and Google OAuth
- Customer account and wallet system
- Add-money and withdrawal workflows
- Wallet and external-payment orders
- Transaction/order history and notifications
- Multiple Free Fire top-up categories
- Admin dashboard and package management
- Role-based admin access with fine-grained permissions
- Super-admin activity log
- Secure support cases
- PostgreSQL RPCs, constraints, RLS/grants, and migrations
- Vercel production deployment

## Tech stack

- Next.js 16 App Router
- React 19
- TypeScript
- Tailwind CSS
- Supabase Auth + PostgreSQL
- Zod
- Vercel
- Git / GitHub

## Engineering highlights

### Server-side financial authority

The server/database, not the browser, is the source of truth for package price and wallet state.

### Atomic wallet payments

Wallet payment logic uses a PostgreSQL RPC and row locking (`FOR UPDATE`) to prevent concurrent requests from spending the same balance.

### RBAC

Admin access evolved into `super_admin`, `admin`, and `editor` roles with permissions such as `manage_users`, `manage_orders`, `manage_add_money`, `manage_withdrawals`, and `manage_packages`.

### Financial reconciliation

Historical ledger corrections were made only after matching production data against historical application behavior. Guarded migrations were used instead of blind balance edits.

### Security hardening

The project includes API authorization, server-side validation, database privilege hardening, direct-write bypass protection, transaction-ID replay protection, safer recovery flows, public-data minimization, and audit logging.

## Portfolio documentation

- [Project Journey](bd21topup/docs/PROJECT_JOURNEY.md)
- [Problem Solving Log](bd21topup/docs/PROBLEM_SOLVING_LOG.md)
- [Security Engineering](bd21topup/docs/SECURITY_ENGINEERING.md)
- [Architecture](bd21topup/docs/ARCHITECTURE.md)
- [Full Commit History](bd21topup/docs/COMMIT_HISTORY.md)

## Selected solved problems

| Problem                             | Solution                                       |
| ----------------------------------- | ---------------------------------------------- |
| Client-controlled financial amounts | Server/database-side package pricing           |
| Wallet race condition               | Atomic PostgreSQL RPC + `FOR UPDATE`           |
| Coarse admin authorization          | RBAC + fine-grained permissions                |
| Direct withdrawal insert bypass     | Blocked direct authenticated insert path       |
| Reused payment Transaction IDs      | Global DB-backed transaction-ID protection     |
| Legacy withdrawal inconsistencies   | Git-history-assisted forensic reconciliation   |
| Duplicate withdrawal history        | Canonical type filtering                       |
| UID rate limiting on Vercel         | Supabase-backed rate-limit state               |
| Public recent-order privacy         | Response data minimization                     |
| All admin packages under UID TopUp  | API now returns real package category metadata |
| Supabase `.temp` committed          | Removed and ignored local CLI state            |
| Password reset flow                 | Recovery-session-only hardening                |

See [Problem Solving Log](bd21topup/docs/PROBLEM_SOLVING_LOG.md) for the detailed root-cause/fix notes.

## Local development

```bash
cd bd21topup
npm install
cp .env.example .env.local
npm run dev
```

Required environment variables:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY` — server only
- `SIAMBHAU_API_KEY`
- `GOXTOP_API_KEY`

## Quality checks

```bash
npm run lint
npm run typecheck
npm run build
```

## Current backlog

- Remaining legacy wallet/order ledger reconciliation
- Remaining historical withdrawal analysis
- Additional audit-log hardening
- Financial API rate limiting
- DB index/RLS performance work
- Production security headers
- Dependency audit
- Full Git-history secret scan

## Commit history

The `main` history contains **300+ commits**, starting with `7cf8f2f` (Initial BD21 Top Up project backup, 2026-09-10).

Regenerate the exact full Markdown history with:

```powershell
powershell -ExecutionPolicy Bypass -File bd21topup/scripts/generate-commit-history.ps1
```
