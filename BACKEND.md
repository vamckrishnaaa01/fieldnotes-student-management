# Backend architecture

Fastify serves the browser app and versioned API from one origin. PostgreSQL is the system of record, Redis supplies shared API rate limiting, and ordered SQL files in `backend/migrations/` define the schema. The API uses opaque server-side sessions, Argon2id password hashes, encrypted TOTP MFA, signed double-submit CSRF tokens, role checks, school-scoped queries/foreign keys, request IDs, and audit records for administrative changes.

See [backend/README.md](backend/README.md) for setup, configuration, staff provisioning, route access, and data operations. See [SECURITY.md](SECURITY.md) for required deployment controls and known limitations.

## Domain model

Schools own staff memberships, students, classes, enrollments, attendance registers, events, settings, and audit events. Composite school-scoped foreign keys prevent cross-school references. Enrollment history preserves class changes. Staff accounts are provisioned by an operator; there is no public signup endpoint.

## Production boundary

This repository provides an application and single-instance Compose baseline. It does not create cloud infrastructure, DNS, certificates, managed backups, monitoring, email-based recovery, or jurisdiction-specific privacy controls. Production use requires deployment-specific security review and operational verification.

