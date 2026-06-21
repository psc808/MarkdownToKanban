---
name: task-ingest
description: >
  Use this skill whenever the user says something like "update my task list", "ingest tasks",
  "sync my tasks", "what do I have to do", "pull in tasks from the last 48 hours", or any
  variation of wanting to refresh their task file from Slack, email, or meeting notes.
---

# Task Ingest Skill

Pulls action items from the last 48 hours across configured sources (Slack, Outlook/email, Granola meeting notes), then merges net-new tasks into a Markdown task file. No duplicates. Newest first.

---

## Setup

Before using this skill you need to:

1. **Configure your task file path** — update the path in Step 1 to point at your `.md` file
2. **Configure your sources** — edit Step 2 to match the Slack channels, email account, or meeting tool you actually use
3. **Configure your categories** — edit the category list in Step 3 to match the `CATEGORIES` array in `public/app.js`
4. **Install MCP connectors** — this skill uses MCP servers for Slack, Outlook/email, and Granola. Install whichever ones you need via Claude Code settings

---

## Step 1 — Choose the target task file

Use `AskUserQuestion` to present the available task files. List every `.md` file found in your tasks directory. Present them as options, always including a final "Other (I'll type the path)" option.

Once the user selects or types a path, use that as `TARGET_FILE` for all remaining steps. If the user says nothing and the context makes it obvious (e.g. they already mentioned a file earlier in the conversation), skip the question and proceed.

Then read `TARGET_FILE` in full. Extract all existing task titles (the `## ` headings). You'll use these to deduplicate at the end.

---

## Step 2 — Pull data from all sources (do in parallel)

Use the available MCP connectors. Pull everything from the **last 48 hours**.

### Email (Outlook / Gmail)
Search for emails that contain action items, requests, deadlines, or decisions directed at you. Focus on:
- Direct asks ("can you...", "please...", "I need you to...")
- Deadlines or deliverables with your name
- Follow-ups or pending decisions

### Slack
Pull messages from the channels relevant to your work. For each channel, look for messages that:
- @mention you directly
- Contain a question or request directed at you
- Contain action items from threads you're involved in
- Assign you something explicitly

**Channels to monitor** *(edit these to match your workspace)*:
- `#your-team-channel`
- `#your-project-channel`
- DMs from key collaborators

### Meeting notes (Granola / Notion / etc.)
Get meetings from the last 48 hours. For each meeting, extract:
- Action items explicitly assigned to you
- Decisions that require follow-up from you
- Open questions you own

---

## Step 3 — Extract tasks

For each signal found, extract a task. Only include it if:
- It requires you to **do something** (not just read/observe)
- It isn't already in `TARGET_FILE`
- It is not a duplicate of another task extracted in this batch

For each task, determine:

| Field | What to populate |
|---|---|
| `TASK_TITLE` | Short, imperative verb phrase. Max 10 words. ("Review API draft", "Respond to Alice re: onboarding") |
| `CREATED_DATE` | Today's date (YYYY-MM-DD) |
| `DUE_DATE` | If mentioned explicitly, use it. Otherwise use `–` |
| `STATUS` | Always `Backlog` for new items |
| `SOURCE` | `Outlook`, `Slack – #channel-name`, `Slack – DM Name`, or `Meeting – [Meeting Name]` |
| `CATEGORY` | Choose the best fit from your configured categories (see `public/app.js`) |
| `NOTES` | 1–2 sentences of context. Include a link if available. Skip if nothing useful to add. |

---

## Step 4 — Deduplicate

Before writing, compare each new task title against:
1. All existing `##` headings in `TARGET_FILE`
2. Other tasks in your current batch

If a task is substantively the same (same action, same topic), drop the duplicate. Don't add it.

---

## Step 5 — Write to TARGET_FILE

**Merge strategy:** Insert new tasks *after* the comment block and the first `---` separator, but *before* any existing tasks. This keeps the list newest-first. If the file has no existing structure, just append the tasks.

Use this exact format for each task block:

```
## {{TASK_TITLE}}
**Created:** {{CREATED_DATE}}
**Due:** {{DUE_DATE}}
**Status:** {{STATUS}}
**Source:** {{SOURCE}}
**Category:** {{CATEGORY}}

{{NOTES}}

---
```

Leave any comment block or field reference at the top of the file untouched. Do not modify existing tasks.

---

## Step 6 — Report back

After writing, give a brief summary:

- How many tasks were added
- Which sources contributed
- Any ambiguous items you skipped and why (max 2–3 lines)

Keep it short. One short paragraph is enough.
