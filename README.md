# Fieldnotes Student Management

Fieldnotes is a school administration application with a same-origin Node.js API. PostgreSQL stores school-scoped users, students, enrollments, classes, attendance, calendar events, settings, sessions, and audit events; Redis provides shared API rate limiting.

## Local deployment

Requires Docker Engine with Compose v2. From `backend/`:

```sh
Copy-Item .env.example .env
# Replace every placeholder secret/password before starting.
docker compose up --build -d
docker compose run --rm -e ADMIN_EMAIL -e ADMIN_NAME -e ADMIN_PASSWORD -e SCHOOL_NAME api node src/bootstrap-admin.js
```

Open `http://localhost:3000/login.html`. Use a unique administrator password of at least 16 characters. Provision staff through the operator CLI described in [backend/README.md](backend/README.md).

## Production deployment

Use managed PostgreSQL and Redis with TLS, a trusted HTTPS reverse proxy, a real DNS name, and a secrets manager. Configure `NODE_ENV=production`, `APP_ORIGIN=https://your-host`, `DATABASE_SSL=true`, TLS database and Redis URLs, distinct random `SESSION_SECRET` and `CSRF_SECRET`, and `TRUST_PROXY` for the exact trusted proxy boundary. Keep the API private behind the proxy.

The included Compose stack is a single-instance template. A real launch still requires infrastructure, domain and certificate setup, secret management, tested backups/restores, monitoring, and school privacy/security review. Read [SECURITY.md](SECURITY.md) before handling student records.

## Project files

- `backend/src/`: API, database access, authentication, migrations, and account provisioning.
- `backend/migrations/`: ordered PostgreSQL migrations.
- `backend/compose.yaml` and `backend/Dockerfile`: container deployment template.
- `login.html`, `app.js`, page HTML, `styles.css`: browser application.

Health endpoints are `GET /health/live` and `GET /health/ready`; application routes are under `/api/v1/`.

