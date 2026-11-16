# Front end

The browser app is served by Fastify on the same origin. Sign-in is at `/login.html`; protected pages redirect to sign-in. `app.js` calls `/api/v1` using session cookies and CSRF tokens. Student data and credentials are not stored in browser local storage. Standalone Live Server is not supported because it bypasses the session and CSRF model.

## Pages

- `index.html`: school overview backed by API metrics.
- `students.html`: searchable, paginated student directory and records.
- `attendance.html`: class/date attendance register and summaries.
- `classes.html`: classes, rosters, and administrator teacher assignment.
- `reports.html`: attendance report and CSV export.
- `calendar.html`: school events.
- `settings.html`: school profile and attendance settings.

The UI reflects the signed-in role, but the API independently enforces authorization. Browser inputs remain untrusted and are validated again on the server.

