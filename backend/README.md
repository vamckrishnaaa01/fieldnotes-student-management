# Backend operations

## Architecture

Fastify serves the browser app and versioned JSON API from one origin. PostgreSQL is the system of record; Redis provides shared API rate limiting. Database changes are ordered SQL migrations under `migrations/`. The API uses opaque server-side sessions, Argon2id password hashes, encrypted TOTP MFA, signed double-submit CSRF tokens, role checks, school-scoped queries/foreign keys, structured request IDs, and audit records for sensitive administrative changes.

## Local stack

Requires Docker Compose v2. Copy `.env.example` to `.env`, replace every placeholder, then from this directory:

```sh
docker compose up --build -d
docker compose run --rm api node src/bootstrap-admin.js
```

Open `http://localhost:3000/login.html`. Set a unique admin password of at least 16 characters. Add staff through the operator CLI; set `SCHOOL_ID`, `OPERATOR_EMAIL`, `OPERATOR_PASSWORD`, optional `OPERATOR_MFA_CODE`, `USER_EMAIL`, `USER_NAME`, `USER_PASSWORD`, and `USER_ROLE` in the protected environment and run `docker compose run --rm api node src/create-user.js`. Valid roles are `admin`, `teacher`, `attendance_staff`, and `viewer`. The bootstrap command prints the school ID for this step. A verified school owner/admin must authorize provisioning; in production, create staff during the restricted MFA enrollment window and restore enforcement after they enroll.

For account recovery, set `SCHOOL_ID`, `OPERATOR_EMAIL`, `OPERATOR_PASSWORD`, optional `OPERATOR_MFA_CODE`, `USER_EMAIL`, and a new `USER_PASSWORD` in the protected environment, then run `docker compose run --rm api node src/reset-password.js`. A verified owner/admin in that school must authorize the reset; all target sessions are revoked, MFA is cleared for re-enrollment, the user must change the temporary password, and the reset is audited. Share the password through an approved secure channel. If MFA is enforced, move the app into a restricted recovery window with `MFA_REQUIRED=false`, then restore enforcement after the user re-enrolls.

For staff offboarding, set `SCHOOL_ID`, `OPERATOR_EMAIL`, `OPERATOR_PASSWORD`, optional `OPERATOR_MFA_CODE`, and `USER_EMAIL`, then run `docker compose run --rm api node src/offboard-user.js`. This revokes only that school's membership and sessions, preserves other school memberships, and writes an audit record. The last owner cannot be removed.

Useful commands:

```sh
docker compose logs -f api
docker compose exec api node src/migrate.js
docker compose down
```

`docker compose down` preserves named database volumes. Do not use `docker compose down -v` unless intentionally deleting all local database and Redis data.

## Configuration

See `.env.example`. Production requires HTTPS `APP_ORIGIN`, `NODE_ENV=production`, TLS-enabled `DATABASE_URL` plus `DATABASE_SSL=true`, TLS Redis (`rediss://`), distinct high-entropy `SESSION_SECRET` and `CSRF_SECRET`, and a unique 32-byte `MFA_ENCRYPTION_KEY`. Generate keys with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`; use a different generated value for each secret. `MFA_REQUIRED` defaults to true in production. Set it to false only while the app is private and staff enroll; restore true before public access. New staff get a temporary password and must change it before using other API routes. Provide secrets through a secrets manager or protected deployment environment, not committed files. Set `TRUST_PROXY` only when the API is reachable exclusively through the configured trusted proxy. The app has no CORS allowlist because UI and API share an origin.

## Routes

| Area | Routes | Access |
|---|---|---|
| Health | `GET /health/live`, `GET /health/ready` | Public status only |
| Session and MFA | `GET /api/v1/csrf`, `POST/GET/DELETE /api/v1/session`, `PUT /api/v1/password`, `POST /api/v1/mfa/setup`, `/enable`, `/disable` | Session lifecycle; authenticator enrollment |
| Students | `GET/POST /api/v1/students`, `GET/PATCH/DELETE /api/v1/students/:id`, `GET /api/v1/students/:id/enrollments` | Authenticated, scoped; role restrictions for writes/history |
| Classes | `GET/POST /api/v1/classes`, `GET /api/v1/classes/:id/roster`, `GET/PUT /api/v1/classes/:id/teachers` | Authenticated; teacher assignment admin-only |
| Staff | `GET /api/v1/users?role=teacher` | Owner/admin |
| Attendance | `GET/PUT /api/v1/attendance`, `GET /api/v1/reports/attendance` | Authenticated, school and class scoped |
| Calendar/settings | `GET/POST /api/v1/events`, `GET/PUT /api/v1/settings` | Authenticated; writes role restricted |
| Reporting/admin | `GET /api/v1/overview`, `GET /api/v1/audit` | Authenticated; audit owner/admin |

All mutations require matching `Origin` and the CSRF token returned by `/api/v1/csrf`. Student deletion is a soft-delete. User creation and password recovery are operator-only; there is no self-service signup or email recovery flow.

## Validation

Run `npm ci`, `npm test`, and `npm audit --omit=dev --audit-level=high` from this directory. The GitHub Actions workflow runs the tests and builds the production image on pushes and pull requests to `main`.

## Data operations

Migrations take a PostgreSQL advisory lock and run transactionally. Back up PostgreSQL using your provider's supported encrypted, point-in-time backup mechanism. Before upgrades, take a restorable backup and test restoration into a separate environment. Redis is operational state and can be rebuilt; PostgreSQL contains student records and must have monitored backups, retention controls, and restore drills.

## Student data retention

Student deletion through the API is a soft-delete; it records a deletion timestamp and closes active enrollment history. The retention CLI is policy-driven and dry-run by default. After the school approves a retention period, provide `SCHOOL_ID`, `OPERATOR_EMAIL`, `OPERATOR_PASSWORD`, optional `OPERATOR_MFA_CODE`, and `RETENTION_DAYS` to the protected job environment. Run `docker compose run --rm api node src/retention.js` to preview the eligible count. Verify a restorable backup and run the same command with `--execute` to permanently delete batches of eligible student records and linked attendance, enrollment, and student audit data; the job keeps a batch-level audit record. Schedule this command in the provider's protected scheduler only after approval. Choose the policy for all linked data with the school's legal/data owner; the app does not select a retention period.

## Deployment limits

The included Compose file is a single API instance and local infrastructure reference. It does not provide automatic certificate issuance, managed backups, high availability, secret rotation, email delivery, a retention schedule, or jurisdiction-specific privacy controls. Configure and review those with the actual deployment provider and school data owner before production use.

