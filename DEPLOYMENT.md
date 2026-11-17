# Production deployment on Render

This repository includes a Render Blueprint at `render.yaml`. It provisions a Docker web service, managed PostgreSQL, and managed Key Value in Singapore, then runs database migrations before each deployment. The web service runs one instance initially. The selected plans are starting capacity and incur Render charges; confirm current pricing in your workspace before creating resources.

## First deployment

1. Sign in to [Render](https://dashboard.render.com/) and create a new **Blueprint** from `vamckrishnaaa01/fieldnotes-student-management` (or the fork you intend to deploy). Render reads `render.yaml` from the repository root.
2. Select the production branch and review the three paid resources and their region. Confirm the cost and create the Blueprint.
3. During setup, provide `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD`, and `SCHOOL_NAME`. Use a unique administrator password of at least 16 characters. Do not put these values in the repository. The Blueprint generates separate session, CSRF, and MFA encryption keys.
4. Wait for PostgreSQL, Key Value, the migration pre-deploy command, and the web service health check to finish. Render assigns HTTPS to its `onrender.com` domain and the app derives its initial allowed origin from Render's hostname.
5. In the Render web service Shell, run `node src/bootstrap-admin.js` once. It prints `SCHOOL_ID`; save that value in the school's protected operations record. Remove `ADMIN_PASSWORD` from the service environment immediately after the successful bootstrap. The command refuses to duplicate an existing owner.
6. The Blueprint temporarily sets `MFA_REQUIRED=false` so the new owner can sign in and enroll MFA. During this restricted enrollment window, do not create other accounts or share the service URL. Sign in immediately, enroll MFA, then set `MFA_REQUIRED=true` in Render and redeploy before inviting staff. The app defaults to requiring MFA in production if this variable is absent.
7. For a custom domain, add and verify it in Render, then set `APP_ORIGIN` on the web service to that exact `https://` origin and redeploy. Render provisions and renews TLS for configured domains.

## Network and database settings

The Blueprint connects to PostgreSQL and Key Value using their internal URLs, which only work when resources share a Render workspace and region. PostgreSQL uses TLS `require`; Render's internal Postgres certificates are self-signed, so the client encrypts traffic without CA verification. Key Value uses `redis://` only because it stays on Render's private network; production config rejects that scheme unless `REDIS_PRIVATE_NETWORK=true`. Do not reuse that setting for a publicly reachable Redis instance. See Render's [private-network documentation](https://render.com/docs/private-network), [Postgres TLS documentation](https://render.com/docs/postgresql-creating-connecting), and [Key Value documentation](https://render.com/docs/key-value).

The Postgres IP allow list is empty, blocking external connections. Key Value external access is not enabled by default. Keep both datastores private. If you later enable Key Value internal authentication, update the connected URL before enforcing it or the API will lose its rate-limit store.

## Before handling real student data

- Confirm the school's student-data privacy, retention, and breach-response requirements. Set an approved retention period before scheduling `backend/src/retention.js`; it defaults to dry-run.
- Configure and verify database backups for the selected plan. Perform a restore drill into a separate database before launch and periodically afterward.
- Set alerts for failed deploys, health checks, database storage, connection saturation, and service errors. Review logs for sensitive-data exposure.
- Run the API and Docker checks in GitHub Actions, then manually verify login, MFA, student creation, attendance, and authorization boundaries in a non-production environment.
- Keep a controlled MFA recovery procedure. Setting `MFA_REQUIRED=false` opens a temporary enrollment/recovery window and must only happen while access is restricted.

## Ongoing deployments

Render watches the configured branch and deploys new commits. The pre-deploy command applies ordered SQL migrations before routing traffic to the new container. Take a restorable database backup before schema changes. Use Render's rollback controls if a deployment fails its readiness check.

Blueprints are declarative, but service creation, billing, custom-domain verification, and secret entry happen in your Render account. Review the [Blueprint reference](https://render.com/docs/blueprint-spec) before changing resource types or deleting managed databases.
