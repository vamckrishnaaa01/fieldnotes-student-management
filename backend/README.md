# Backend operations

## Architecture

Fastify serves the browser app and versioned JSON API from one origin. PostgreSQL is the system of record; Redis provides shared API rate limiting. Database changes are ordered SQL migrations under `migrations/`. The API uses opaque server-side sessions, Argon2id password hashes, signed double-submit CSRF tokens, role checks, school-scoped queries/foreign keys, structured request IDs, and audit records for sensitive administrative changes.

## Local stack

Requires Docker Compose v2. Copy `.env.example` to `.env`, replace every placeholder, then from this directory:

```sh
docker compose up --build -d
docker compose run --rm -e ADMIN_EMAIL -e ADMIN_NAME -e ADMIN_PASSWORD -e SCHOOL_NAME api node src/bootstrap-admin.js
```

Open `http://localhost:3000/login.html`. Set a unique admin password of at least 16 characters. Add staff through the operator CLI; set `SCHOOL_ID`, `USER_EMAIL`, `USER_NAME`, `USER_PASSWORD`, and `USER_ROLE` in the protected environment and run `docker compose run --rm api node src/create-user.js`. Valid roles are `admin`, `teacher`, `attendance_staff`, and `viewer`.

Useful commands:

```sh
docker compose logs -f api
docker compose exec api node src/migrate.js
docker compose down
```

`docker compose down` preserves named database volumes. Do not use `docker compose down -v` unless intentionally deleting all local database and Redis data.

## Configuration

See `.env.example`. Production requires HTTPS `APP_ORIGIN`, `NODE_ENV=production`, TLS-enabled `DATABASE_URL` plus `DATABASE_SSL=true`, TLS Redis (`rediss://`), and distinct high-entropy `SESSION_SECRET` and `CSRF_SECRET`. Provide secrets through a secrets manager or protected deployment environment, not committed files. Set `TRUST_PROXY` only when the API is reachable exclusively through the configured trusted proxy. The app has no CORS allowlist because UI and API share an origin.

## Routes

| Area | Routes | Access |
|---|---|---|
| Health | `GET /health/live`, `GET /health/ready` | Public status only |
| Session | `GET /api/v1/csrf`, `POST/GET/DELETE /api/v1/session`, `POST /api/v1/password` | Session lifecycle |
| Students | `GET/POST /api/v1/students`, `GET/PATCH/DELETE /api/v1/students/:id`, `GET /api/v1/students/:id/enrollments` | Authenticated, scoped; role restrictions for writes/history |
| Classes | `GET/POST /api/v1/classes`, `GET /api/v1/classes/:id/roster`, `GET/PUT /api/v1/classes/:id/teachers` | Authenticated; teacher assignment admin-only |
| Staff | `GET /api/v1/users?role=teacher` | Owner/admin |
| Attendance | `GET/PUT /api/v1/attendance`, `GET /api/v1/reports/attendance` | Authenticated, school and class scoped |
| Calendar/settings | `GET/POST /api/v1/events`, `GET/PUT /api/v1/settings` | Authenticated; writes role restricted |
| Reporting/admin | `GET /api/v1/overview`, `GET /api/v1/audit` | Authenticated; audit owner/admin |

All mutations require matching `Origin` and the CSRF token returned by `/api/v1/csrf`. Student deletion is a soft-delete. User creation is operator-only; no self-service signup or password reset email flow is implemented.

## Data operations

Migrations take a PostgreSQL advisory lock and run transactionally. Back up PostgreSQL using your provider's supported encrypted, point-in-time backup mechanism. Before upgrades, take a restorable backup and test restoration into a separate environment. Redis is operational state and can be rebuilt; PostgreSQL contains student records and must have monitored backups, retention controls, and restore drills.

## Deployment limits

The included Compose file is a single API instance and local infrastructure reference. It does not provide automatic certificate issuance, managed backups, high availability, secrets rotation, MFA, email delivery, data-retention automation, or jurisdiction-specific privacy controls. Configure and review those with the actual deployment provider and school data owner before production use.

