# Fieldnotes student management front end

## Open the pages

The frontend has no build step. Start the API from `backend` with `npm start`, then serve the project root with VS Code Live Server at its default port (5500) and open `index.html`. Student, attendance, and school profile changes then persist through the API. Pages still render sample content when the API is offline. See `backend/README.md` for routes and configuration.

## Project structure

```text
Student management system/
├── index.html          # Overview dashboard
├── students.html       # Student directory and add-student form
├── attendance.html     # Weekly attendance summary and daily register
├── classes.html        # Year groups and class cards
├── reports.html        # Report library and CSV download controls
├── calendar.html       # Monthly school calendar and upcoming events
├── settings.html       # School profile, academic year, attendance rules
├── styles.css          # Shared design system, components, responsive layouts
├── app.js              # Shared interactions used by the pages
├── FRONTEND.md         # Front end architecture chart and scope
├── BACKEND.md          # Back end architecture chart and scope
├── backend/            # Local Node.js JSON API
└── PROJECT_GUIDE.md    # This page map and review checklist
```

## What to review on each page

| Page | Main structure | Interactions to review |
|---|---|---|
| Overview | Welcome header, four school metrics, attendance chart, follow-up tasks, student preview | Search shortcut, task checkoffs, notification/help buttons, add student |
| Students | Directory header, search and year filter, student table | Search by name or ID, cycle year filter, add a student, mobile table layout |
| Attendance | Weekly chart, attendance totals, daily register | Toggle a student's Present/Late state; use Save Register |
| Classes | Year group cards and class totals | Add Class prompt; responsive card grid |
| Reports | Weekly attendance feature and report library | Download each sample CSV |
| Calendar | November month grid and upcoming events | Add Event prompt; month arrow controls |
| Settings | School profile, academic year and attendance settings | Edit fields and save; profile uses API persistence with local fallback |

## Shared behavior

- The sidebar links to each separate HTML page and collapses on small screens.
- `styles.css` contains the common typography, colors, navigation, tables, cards, dialogs, and responsive breakpoints.
- `app.js` checks for page-specific elements before attaching interactions, so pages can share the same script.
- The overview, classes, reports, and calendar still use example content. Students, attendance, and the school profile connect to the local JSON API when it is running; profile settings also keep a local fallback.

## Review checklist

- Open every page from the sidebar and confirm the correct section loads.
- Resize to a narrow mobile width and check that the menu opens, tables remain readable, and cards stack cleanly.
- On Students, search for `Ella`, cycle the year filter, and add a sample student.
- On Attendance, toggle a register status and save the register.
- On Reports, download a CSV and confirm it opens with the expected report name.
- On Settings, change the school name, save, reload the page, and confirm it remains saved in the same browser.
- On Calendar and Classes, check event/class action prompts and responsive layouts.
