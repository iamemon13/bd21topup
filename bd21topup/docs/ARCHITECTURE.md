# BD21topup — Architecture

## High-level flow

```text
Browser
  |
  | Supabase Auth / Bearer token
  v
Next.js App Router
  |
  +--> Customer pages
  +--> Admin pages
  +--> /api/* Route Handlers
          |
          +--> validation
          +--> authentication
          +--> RBAC where required
          v
      server-side Supabase client
          |
          +--> PostgreSQL tables
          +--> RPC functions
          +--> RLS / grants / constraints
          +--> audit and wallet ledger records
```

## Main domains

### Authentication
- Login
- Google OAuth callback
- Password recovery/update
- Customer account

### Product catalog
Categories include:
- UID TopUp
- Weekly / Monthly
- Weekly Lite
- Level Up Pass
- FF Likes
- Indonesia Server

Package metadata lives in Supabase.

### Orders
Order creation validates authentication, package identity, payment method, authoritative server-side price, and payment reference rules.

### Wallet
Wallet activity is represented separately from order records. Sensitive balance operations increasingly use canonical ledger records and database RPCs.

### Add money
Users submit external payment references; protected admin workflows review and apply results.

### Withdrawals
The hardened model controls request-time debit and rejection reversal behavior through server/database logic.

### Admin
Admin access uses roles + fine-grained permissions, with sensitive actions audit logged.

### Support
Rejected/cancelled operations can be attached to support cases so customer history and admin support share the same operation context.

## Important tables

- `profiles`
- `orders`
- `packages`
- `add_money_requests`
- `withdrawals`
- `wallet_transactions`
- `notifications`
- `admin_roles`
- `admin_audit_logs`
- support-case tables
- UID cache/rate-limit tables

## Important database patterns

### Wallet payment RPC
- load authoritative price
- lock wallet/profile row
- validate funds
- update balance
- insert order
- insert wallet transaction

### Financial admin operations
Cancellation/refund, wallet adjustment, add-money, and withdrawal paths are controlled server-side to reduce double-processing/race risks.

## Deployment

Production runs on Vercel.

Serverless behavior influenced architecture decisions such as moving rate-limit state out of process memory and into Supabase.

## Core principle

**Browser input expresses intent.  
Server validates intent.  
Database owns authoritative financial state.**
