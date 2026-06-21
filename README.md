# Markdown Kanban

A local, zero-dependency Kanban board that reads and writes a plain Markdown file. No cloud, no account, no database — the `.md` file is the source of truth.

Works as a native macOS desktop app (Electron) or as a local web server you can open in any browser.

## Download

Grab the latest `.dmg` from [GitHub Releases](../../releases) and open it:

- **Apple Silicon (M1/M2/M3):** `Markdown-Kanban-x.x.x-arm64.dmg`
- **Intel Mac:** `Markdown-Kanban-x.x.x.dmg`

On first launch macOS may warn "unidentified developer" — right-click the app and choose **Open** to bypass it.

## Getting started

1. Launch **Markdown Kanban.app**
2. On the welcome screen, choose **Open existing file** to use a `.md` file you already have, or **Create new file from template** to start fresh
3. The board loads — drag cards between columns, click titles or notes to edit

The file you open is remembered across launches. To switch files, click the ⚙ gear icon in the top bar.

## Features

- **Plain Markdown source of truth** — your tasks live in a `.md` file you own; open it in any editor
- **Four columns** — Backlog · Priority · In Progress · Done
- **Category tags** — colour-coded chips filter the board to a single topic
- **Sort modes** — Creation date, due date, or custom drag-and-drop order (persisted in localStorage)
- **Multi-select** — ⌘/Ctrl-click, Shift-click, or rubber-band drag to select multiple cards, then drag them all at once
- **Inline editing** — click a card title or notes area to edit in place; press Enter / ⌘↵ to save
- **Full edit modal** — click the ✎ icon for title, status, due date, category, source, and notes all in one form
- **Done animation** — a sparkle checkmark fires when you move a card to Done
- **Dark / light mode** — auto-detects system preference; toggle with the 🌙/☀ button
- **Archive file** — configure a separate `.md` file for completed tasks; agents can move Done cards there automatically
- **Keyboard shortcuts** — ⌘C opens a new-task modal from anywhere on the board
- **Overdue highlighting** — cards with a past due date are visually flagged

## Task file format

Each task is a `---`-separated block:

```markdown
## Fix the login bug
**Created:** 2024-03-01
**Due:** 2024-03-15
**Status:** In Progress
**Source:** Linear
**Category:** #Sites

Tracked in [LIN-42](https://linear.app/…). Reproduces on Safari only.
```

| Field | Values |
|-------|--------|
| Status | `Backlog` · `Priority` · `In Progress` · `Done` |
| Category | any `#Tag` you define in `app.js` |
| Due | `YYYY-MM-DD` or `–` |
| Source | free text — where the task came from |

The Note field (free text after the fields) supports Markdown links.

## Build from source

```bash
git clone https://github.com/psc808/MarkdownToKanban
cd markdown-to-kanban
npm install

# Run as an Electron desktop app
npm run electron

# Build distributable DMGs → dist/
npm run build

# Run as a local web server (open http://localhost:3000 in any browser)
npm start
```

Node 18+ required.

## Customising

**Columns** — edit `COLUMN_DEFS` in [`public/app.js`](public/app.js) (line ~50) and add a matching `.column-header.col-<name>` border-color rule in [`public/styles.css`](public/styles.css).

**Categories / colours** — edit `CATEGORIES` and `CAT_COLORS` in [`public/app.js`](public/app.js) (lines ~55–70). No server changes needed.

## Claude Code integration — Task Ingest skill

This repo ships a [Claude Code](https://claude.ai/code) skill that automatically pulls action items from Slack, Outlook, and Granola meeting notes, deduplicates them against your existing task file, and writes new tasks directly into the `.md` file in the correct format.

See [`task-ingest/SKILL.md`](task-ingest/SKILL.md) for the full skill definition and setup instructions.

**What it does:**

1. Reads your current task file to extract all existing task titles
2. Searches the last 48 hours across Outlook (emails with action items), Slack (direct mentions and assigned work), and Granola (meeting action items)
3. Extracts tasks — short imperative titles, correct category, source attribution, 1–2 sentence notes
4. Deduplicates against existing tasks and within the new batch
5. Inserts new tasks at the top of the file (newest-first), leaving existing tasks untouched
6. Reports a brief summary of what was added and what was skipped

**To use it**, install the skill in Claude Code and say something like "update my task list" or "ingest tasks from the last 48 hours". It will ask which `.md` file to target, then run the full pipeline.

To adapt it for your own workflow, edit [`task-ingest/SKILL.md`](task-ingest/SKILL.md):
- Change the Slack channels to your own
- Replace "Pascal" / `pasc@` references with your name and email
- Adjust the category list to match what you use in `app.js`
- Add or remove sources (Jira, GitHub, email, etc.)

## License

MIT — see [LICENSE](LICENSE).
