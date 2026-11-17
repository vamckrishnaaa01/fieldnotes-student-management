# Security and privacy operations

## Included controls

- PostgreSQL persistence with school-scoped relationships and school-scoped API queries.
- Opaque server-managed sessions, hashed session tokens, secure/HTTP-only/SameSite cookies, and server-side session expiry.
- Argon2id password hashing, login throttling via Redis, and a generic login failure response.
- Optional TOTP MFA with encrypted secrets, recovery through an audited owner/admin password-reset command, and production enforcement after account enrollment.
- Same-origin mutation checks plus signed double-submit CSRF tokens.
- Role checks, request schema validation, bounded request size/timeouts, security headers, and production HTTPS requirements.
- Structured request IDs, redacted credentials, and audit events for administrative changes.

## Required before real student data

1. Deploy only behind HTTPS and configure the trusted proxy boundary correctly.
2. Generate distinct random session and CSRF secrets; store and rotate them using a secrets manager.
3. Use managed PostgreSQL and Redis with TLS, network restrictions, least-privilege credentials, encryption at rest, and monitored backups.
4. Perform a security review and restore drill against the actual deployment, including tenant-isolation and role scenarios.
5. Decide the school's retention, deletion, access-review, incident-response, and jurisdiction-specific student privacy obligations. Review the linked attendance/enrollment purge behavior; run the retention command in dry-run mode and verify backups before scheduling execution.
6. Provision named staff accounts, have each person set a private password and enroll MFA, set `MFA_REQUIRED=true`, and establish an offboarding process.

Email-based recovery/invitations, guardian access, provider-scheduled retention jobs, and jurisdiction-specific compliance controls are not implemented. A policy-driven retention CLI is provided, but the school must choose its retention period and schedule it. MFA uses a time-based authenticator code; loss of the authenticator requires an authorized operator password reset, which clears MFA, forces a password change, and revokes all sessions. If MFA is enforced, temporarily disable that requirement only during an access-controlled recovery window so the user can reset their password and re-enroll. This repository is an application baseline, not a compliance certification or a substitute for a production security assessment.

