# Fieldnotes Student Management

Fieldnotes is a lightweight school administration prototype with separate pages for the overview, student directory, attendance, classes, reports, calendar, and school settings.

## Run locally

1. Install Node.js 18 or later.
2. Start the API from the `backend` directory with `npm start`.
3. Serve the project root with VS Code Live Server on port 5500 and open `index.html`.

The student directory, attendance register, and school profile use the API at `http://localhost:3000/api/v1`. The API stores data in `backend/data/db.json`, which is excluded from Git. Other pages still use prototype sample content.

See [backend/README.md](backend/README.md), [BACKEND.md](BACKEND.md), and [FRONTEND.md](FRONTEND.md) for implementation details.

## Security

This is a local development prototype. The API has no authentication, authorization, school tenancy, or production database. Use synthetic data only and do not expose it to the public internet.
