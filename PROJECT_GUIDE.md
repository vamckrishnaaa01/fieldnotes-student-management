# Fieldnotes project guide

## Run the application

The frontend is served by the backend from the same origin so that authentication and CSRF protections apply. Start the PostgreSQL, Redis, migration, and API services with Docker Compose from `backend/`; follow [backend/README.md](backend/README.md) to bootstrap the first school owner and staff accounts. Do not open individual HTML files or use a separate static server.

## Project structure

```text
index.html          # Overview dashboard
students.html       # Student directory
attendance.html     # Attendance register
classes.html        # Classes and teacher assignments
reports.html        # Attendance report/export
calendar.html       # School calendar
settings.html       # School settings
login.html          # Staff sign-in
styles.css          # Shared responsive styles
app.js              # Same-origin browser API client
backend/src/        # Fastify API, authentication, database and operations
backend/migrations/ # PostgreSQL migrations
backend/compose.yaml
backend/Dockerfile
SECURITY.md         # Production security and privacy requirements
BACKEND.md          # Backend architecture summary
FRONTEND.md         # Browser architecture and data rules
```

## Operational notes

- The API is the source of truth; the browser does not persist student records in local storage.
- Sign-in is required for application pages. The API enforces permissions independently of UI controls.
- Staff accounts are operator-provisioned; temporary passwords must be changed at first sign-in.
- Staff can enroll in TOTP MFA from account controls; production can enforce enrollment using `MFA_REQUIRED=true`.
- `GET /health/live` checks process liveness and `GET /health/ready` checks the database and Redis.
- Production needs the HTTPS origin, trusted proxy, TLS data services, secrets, backups, monitoring, and privacy review described in [SECURITY.md](SECURITY.md).

