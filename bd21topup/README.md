# BD21 Topup

Next.js 16 + Supabase based top-up application for `topup.ekbotix.com`.

## Local development

```bash
npm install
cp .env.example .env.local
npm run dev
```

Fill the variables in `.env.local` before starting.

## Required environment variables

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY` (server only; never expose this in client code)
- `SIAMBHAU_API_KEY`
- `GOXTOP_API_KEY`

## Supabase Auth / Google OAuth

The application now derives its callback origin from the current site, so the same code works locally and on production. In Supabase Auth settings, add the production callback URL:

`https://topup.ekbotix.com/auth/callback`

Also add your local callback URL when developing locally, for example:

`http://localhost:3000/auth/callback`

## Database backup warning

The current repository contains `bd21_schema_backup.sql` and `supabase/migrations/20260911033403_remote_schema.sql`, but both files are empty in the supplied project archive. Export the live Supabase schema/migrations and commit a sanitized schema backup so the database can be recreated reliably. Do not commit secrets or production data.

## Deployment

The project is suitable for Vercel. Configure the environment variables in the deployment project and map the custom domain `topup.ekbotix.com`.
