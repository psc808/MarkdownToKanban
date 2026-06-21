'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Tasks file ─────────────────────────────────────────────────────────────

const TASKS_FILE = process.env.TASKS_FILE
  || path.join(__dirname, 'my-tasks.md');

function ensureFile() {
  if (!fs.existsSync(TASKS_FILE)) {
    const template = path.join(__dirname, 'tasks-template.md');
    fs.copyFileSync(template, TASKS_FILE);
  }
}

// ── Parser (mirrors electron/main.js) ─────────────────────────────────────

function parseTasks(raw) {
  const sections = raw.split('\n---\n');
  const tasks = [];

  sections.forEach((rawSection, rawIdx) => {
    const section = rawSection.replace(/<!--[\s\S]*?-->/g, '');
    const titleMatch = section.match(/^##\s+(.+)$/m);
    if (!titleMatch) return;
    const title = titleMatch[1].trim();
    if (title.includes('{{')) return;

    const fields = {};
    const metaRe = /^\*\*(\w+):\*\*[ \t]*(.*)$/gm;
    let m;
    while ((m = metaRe.exec(section)) !== null) {
      fields[m[1].toLowerCase()] = m[2].trim();
    }

    const freetext = section
      .split('\n')
      .filter(l => !l.match(/^##\s+/) && !l.match(/^\*\*\w+:\*\*\s*/))
      .join('\n')
      .trim();

    const notes = fields.note || freetext;

    tasks.push({
      id: rawIdx,
      title,
      created: fields.created || '',
      due: fields.due || '',
      status: fields.status || 'Backlog',
      source: fields.source || '',
      category: fields.category || '',
      done_date: fields.done_date || '',
      notes,
    });
  });

  return tasks;
}

// ── Writer (mirrors electron/main.js) ─────────────────────────────────────

function createTask(fields) {
  if (!fields.title || !fields.title.trim()) throw new Error('Title is required');
  const title = fields.title.trim();
  const today = new Date().toISOString().slice(0, 10);
  const created = fields.created || today;
  const due = fields.due || '–';
  const status = fields.status || 'Backlog';
  const category = (fields.category || '').trim();
  const notes = (fields.notes || '').trim();

  const metaLines = [
    `## ${title}`,
    `**Created:** ${created}`,
    `**Due:** ${due}`,
    `**Status:** ${status}`,
    `**Source:** Kanban`,
    `**Category:** ${category}`,
  ];
  if (notes) metaLines.push(`**Note:** ${notes}`);

  const newSection = metaLines.join('\n') + '\n';
  const raw = fs.readFileSync(TASKS_FILE, 'utf8');
  fs.writeFileSync(TASKS_FILE, raw.trimEnd() + '\n---\n' + newSection, 'utf8');
}

function deleteTask(rawSectionIdx) {
  const raw = fs.readFileSync(TASKS_FILE, 'utf8');
  const sections = raw.split('\n---\n');
  if (rawSectionIdx < 0 || rawSectionIdx >= sections.length)
    throw new Error(`Section index ${rawSectionIdx} out of range`);
  sections.splice(rawSectionIdx, 1);
  fs.writeFileSync(TASKS_FILE, sections.join('\n---\n'), 'utf8');
}

function updateTask(rawSectionIdx, changes) {
  const raw = fs.readFileSync(TASKS_FILE, 'utf8');
  const sections = raw.split('\n---\n');
  if (rawSectionIdx < 0 || rawSectionIdx >= sections.length)
    throw new Error(`Section index ${rawSectionIdx} out of range`);

  let sec = sections[rawSectionIdx];

  if (changes.status !== undefined) {
    sec = sec.replace(/^(\*\*Status:\*\*\s*).*$/m, `$1${changes.status}`);
    const today = new Date().toISOString().slice(0, 10);
    const hasDoneDate = /^\*\*Done_date:\*\*\s*.+$/m.test(sec);
    if (changes.status === 'Done') {
      if (hasDoneDate) {
        sec = sec.replace(/^\*\*Done_date:\*\*\s*.*$/m, `**Done_date:** ${today}`);
      } else {
        sec = sec.replace(/^(\*\*Status:\*\*\s*.*)$/m, `$1\n**Done_date:** ${today}`);
      }
    } else if (hasDoneDate) {
      sec = sec.replace(/\n\*\*Done_date:\*\*\s*.*$/m, '');
    }
  }

  if (changes.title !== undefined)
    sec = sec.replace(/^(##\s+).*$/m, `$1${changes.title}`);

  if (changes.category !== undefined)
    sec = sec.replace(/^(\*\*Category:\*\*\s*).*$/m, `$1${changes.category}`);

  if (changes.due !== undefined) {
    if (/^\*\*Due:\*\*\s*/m.test(sec)) {
      sec = sec.replace(/^(\*\*Due:\*\*\s*).*$/m, `$1${changes.due || '–'}`);
    }
  }

  if (changes.notes !== undefined) {
    const newNotes = changes.notes.trim();
    if (/^\*\*Note:\*\*\s*/m.test(sec)) {
      if (newNotes) {
        sec = sec.replace(/^(\*\*Note:\*\*\s*).*$/m, `$1${newNotes}`);
      } else {
        sec = sec.replace(/\n?\*\*Note:\*\*[^\n]*\n?/m, '\n');
      }
    } else {
      const lines = sec.split('\n');
      let lastMetaIdx = -1;
      let seenTitle = false;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].match(/^##\s+/)) { seenTitle = true; continue; }
        if (seenTitle && lines[i].match(/^\*\*\w+:\*\*\s*/)) lastMetaIdx = i;
      }
      if (lastMetaIdx >= 0) {
        const header = lines.slice(0, lastMetaIdx + 1).join('\n');
        sec = header + (newNotes ? `\n**Note:** ${newNotes}\n` : '\n');
      }
    }
  }

  sections[rawSectionIdx] = sec;
  fs.writeFileSync(TASKS_FILE, sections.join('\n---\n'), 'utf8');
}

// ── Routes ─────────────────────────────────────────────────────────────────

app.get('/api/tasks', (req, res) => {
  try {
    ensureFile();
    const raw = fs.readFileSync(TASKS_FILE, 'utf8');
    res.json(parseTasks(raw));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tasks', (req, res) => {
  try {
    ensureFile();
    createTask(req.body);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/tasks/:id', (req, res) => {
  try {
    ensureFile();
    updateTask(Number(req.params.id), req.body);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/tasks/:id', (req, res) => {
  try {
    ensureFile();
    deleteTask(Number(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Start ──────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Kanban running at http://localhost:${PORT}`);
  console.log(`Tasks file: ${TASKS_FILE}`);
});
