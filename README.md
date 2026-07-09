# Referral Merge

Internal mail merge outreach for one-off or recurring professional referral campaigns. It is intentionally not a newsletter platform: the MVP emphasizes verified Gmail aliases, preview, throttling, suppression, retries, and clean send logs.

## Stack

- Next.js App Router with TypeScript
- Postgres with Prisma
- Google OAuth via NextAuth
- Gmail API send-as aliases
- BullMQ with Redis for queued throttled sending
- Railway-ready environment variables

## MVP included

- Approved-admin Google login
- Campaign creation and editing before launch
- Paste or CSV recipient import
- Email validation, de-dupe review, personalized preview
- Gmail alias sync and verified-alias enforcement
- Required test email before launch
- BullMQ queue with configurable hourly throttling
- Safe retries, duplicate-send prevention, high-error pause
- Suppression list and unsubscribe page
- Status dashboard and audit logs for major actions

## Setup

1. Copy `.env.example` to `.env`.
2. Create a Google OAuth app and add these scopes:
   - `openid`
   - `email`
   - `profile`
   - `https://www.googleapis.com/auth/gmail.send`
   - `https://www.googleapis.com/auth/gmail.settings.basic`
3. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXTAUTH_SECRET`, `TOKEN_ENCRYPTION_KEY`, and `APPROVED_ADMIN_EMAILS`.
4. Start Postgres and Redis, then set `DATABASE_URL` and `REDIS_URL`.
5. Install and migrate:

```bash
npm install
npm run prisma:migrate
```

6. Run the web app and worker in separate terminals:

```bash
npm run dev
npm run worker
```

7. Sign in, open Aliases, sync Gmail aliases, then create a campaign.

## Railway

Provision Postgres and Redis on Railway, set the variables from `.env.example`, and use:

- Build command: `npm run build`
- Web start command: `npm run start`
- Worker start command: `npm run worker`
- Release command: `npm run prisma:deploy`

## Notes

Gmail only sends from aliases returned by the Gmail `sendAs` API with `verificationStatus = accepted`. Unverified aliases are displayed but disabled in the campaign editor.

Open and click tracking are deliberately not implemented in the MVP. The event table is ready for transparent opt-in tracking later.
