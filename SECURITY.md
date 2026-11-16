# Security and privacy operations

## Included controls

- PostgreSQL persistence with school-scoped relationships and school-scoped API queries.
- Opaque server-managed sessions, hashed session tokens, secure/HTTP-only/SameSite cookies, and server-side session expiry.
- Argon2id password hashing, login throttling via Redis, and a generic login failure response.
- Same-origin mutation checks plus signed double-submit CSRF tokens.
- Role checks, request schema validation, bounded request size/timeouts, security headers, and production HTTPS requirements.
- Structured request IDs, redacted credentials, and audit events for administrative changes.

## Required before real student data

1. Deploy only behind HTTPS and configure the trusted proxy boundary correctly.
2. Generate distinct random session and CSRF secrets; store and rotate them using a secrets manager.
3. Use managed PostgreSQL and Redis with TLS, network restrictions, least-privilege credentials, encryption at rest, and monitored backups.
4. Perform a security review and restore drill against the actual deployment, including tenant-isolation and role scenarios.
5. Decide the school's retention, deletion, access-review, incident-response, and jurisdiction-specific student privacy obligations.
6. Create only named staff accounts, enforce strong unique passwords, and establish an offboarding process.

MFA, email-based recovery/invitations, guardian access, automated retention/deletion, and provider-specific compliance controls are not implemented. This repository is an application baseline, not a compliance certification or a substitute for a production security assessment.

