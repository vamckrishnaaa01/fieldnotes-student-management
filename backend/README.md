# Fieldnotes API

Small dependency-free Node.js backend for local development. It persists data to `backend/data/db.json` and exposes JSON endpoints at `/api/v1`.

## Run

Install Node.js 18 or later, then run from this directory:

```sh
npm start
```

The API listens on `http://localhost:3000`. Set `PORT`, `DATA_DIR`, or `CORS_ORIGIN` to customize the port, data location, or allowed browser origin. The default browser origin is `http://localhost:5500` (VS Code Live Server).

## Routes

| Method | Route | Behavior |
|---|---|---|
| GET | `/health` | Liveness check |
| GET | `/api/v1/students?q=&year=` | Search and list students |
| POST | `/api/v1/students` | Create `{ "name": "Jamie Taylor", "year": "Year 3", "class": "3A" }` |
| GET | `/api/v1/students/:id` | Read one student |
| PATCH | `/api/v1/students/:id` | Update name, year, or class |
| DELETE | `/api/v1/students/:id` | Delete a student |
| GET | `/api/v1/attendance?date=YYYY-MM-DD` | List attendance records, optionally by date |
| PUT | `/api/v1/attendance` | Replace a date's register with `{ "date": "2026-11-16", "records": [{ "studentId": "…", "status": "PRESENT" }] }` |
| GET | `/api/v1/settings` | Read school settings |
| PUT | `/api/v1/settings` | Merge school settings from a JSON object |

Responses use `{ "data": ... }`; list responses also include `count`. Errors use `{ "error": { "message": ..., "requestId": ... } }`.

## Scope

This is a local prototype backend, not a production student-record service. It has no authentication, role checks, school tenancy, relational database, migrations, guardian/enrollment model, or audit log. Do not expose it to the public internet or store real student information in it. Those controls are required before production use.
