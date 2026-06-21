'use strict';

const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// ── Config (persists chosen tasks file) ───────────────────────────────────

const configPath = path.join(app.getPath('userData'), 'config.json');

function readConfig() {
  try { return JSON.parse(fs.readFileSync(configPath, 'utf8')); }
  catch { return {}; }
}

function writeConfig(cfg) {
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
}

function getTasksFile() {
  const cfg = readConfig();
  return cfg.tasksFile || null;
}

function getArchiveFile() {
  const cfg = readConfig();
  return cfg.archiveFile || null;
}

// ── Parser ─────────────────────────────────────────────────────────────────

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

    // Support both **Note:** field format and legacy free-text notes
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

// ── Writer ─────────────────────────────────────────────────────────────────

function createTask(tasksFile, fields) {
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
  const raw = fs.readFileSync(tasksFile, 'utf8');
  fs.writeFileSync(tasksFile, raw.trimEnd() + '\n---\n' + newSection, 'utf8');
}

function deleteTask(tasksFile, rawSectionIdx) {
  const raw = fs.readFileSync(tasksFile, 'utf8');
  const sections = raw.split('\n---\n');
  if (rawSectionIdx < 0 || rawSectionIdx >= sections.length)
    throw new Error(`Section index ${rawSectionIdx} out of range`);
  sections.splice(rawSectionIdx, 1);
  fs.writeFileSync(tasksFile, sections.join('\n---\n'), 'utf8');
}

function updateTask(tasksFile, rawSectionIdx, changes) {
  const raw = fs.readFileSync(tasksFile, 'utf8');
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
      // Update existing **Note:** field (or remove it if empty)
      if (newNotes) {
        sec = sec.replace(/^(\*\*Note:\*\*\s*).*$/m, `$1${newNotes}`);
      } else {
        sec = sec.replace(/\n?\*\*Note:\*\*[^\n]*\n?/m, '\n');
      }
    } else {
      // Legacy free-text approach: replace everything after the last meta line
      const lines = sec.split('\n');
      let lastMetaIdx = -1;
      let seenTitle = false;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].match(/^##\s+/)) { seenTitle = true; continue; }
        if (seenTitle && lines[i].match(/^\*\*\w+:\*\*\s*/)) lastMetaIdx = i;
      }
      if (lastMetaIdx >= 0) {
        // Migrate to **Note:** field format on save
        const header = lines.slice(0, lastMetaIdx + 1).join('\n');
        sec = header + (newNotes ? `\n**Note:** ${newNotes}\n` : '\n');
      }
    }
  }

  sections[rawSectionIdx] = sec;
  fs.writeFileSync(tasksFile, sections.join('\n---\n'), 'utf8');
}

// ── IPC handlers ───────────────────────────────────────────────────────────

ipcMain.handle('tasks:get', () => {
  const file = getTasksFile();
  if (!file || !fs.existsSync(file)) return [];
  return parseTasks(fs.readFileSync(file, 'utf8'));
});

ipcMain.handle('tasks:create', (_, fields) => {
  createTask(getTasksFile(), fields);
  return { ok: true };
});

ipcMain.handle('tasks:update', (_, { id, changes }) => {
  updateTask(getTasksFile(), id, changes);
  return { ok: true };
});

ipcMain.handle('tasks:delete', (_, id) => {
  deleteTask(getTasksFile(), id);
  return { ok: true };
});

ipcMain.handle('file:current', () => getTasksFile());

ipcMain.handle('file:hasFile', () => {
  const f = getTasksFile();
  return !!(f && fs.existsSync(f));
});

ipcMain.handle('file:createFromTemplate', async () => {
  const result = await dialog.showSaveDialog({
    title: 'Create Tasks File',
    defaultPath: path.join(app.getPath('documents'), 'my-tasks.md'),
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  });
  if (!result.canceled && result.filePath) {
    const templatePath = path.join(__dirname, '..', 'tasks-template.md');
    fs.copyFileSync(templatePath, result.filePath);
    const cfg = readConfig();
    cfg.tasksFile = result.filePath;
    writeConfig(cfg);
    return result.filePath;
  }
  return null;
});

ipcMain.handle('file:choose', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Markdown', extensions: ['md'] }],
    defaultPath: app.getPath('documents'),
  });
  if (!result.canceled && result.filePaths[0]) {
    const cfg = readConfig();
    cfg.tasksFile = result.filePaths[0];
    writeConfig(cfg);
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('file:reveal', () => {
  shell.showItemInFinder(getTasksFile());
});

ipcMain.handle('archive:current', () => getArchiveFile());

ipcMain.handle('archive:hasFile', () => {
  const f = getArchiveFile();
  return !!(f && fs.existsSync(f));
});

ipcMain.handle('archive:choose', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Markdown', extensions: ['md'] }],
    defaultPath: app.getPath('documents'),
  });
  if (!result.canceled && result.filePaths[0]) {
    const cfg = readConfig();
    cfg.archiveFile = result.filePaths[0];
    writeConfig(cfg);
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('archive:createFromTemplate', async () => {
  const result = await dialog.showSaveDialog({
    title: 'Create Archive File',
    defaultPath: path.join(app.getPath('documents'), 'tasks-archive.md'),
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  });
  if (!result.canceled && result.filePath) {
    const templatePath = path.join(__dirname, '..', 'tasks-archive-template.md');
    fs.copyFileSync(templatePath, result.filePath);
    const cfg = readConfig();
    cfg.archiveFile = result.filePath;
    writeConfig(cfg);
    return result.filePath;
  }
  return null;
});

// ── Window ─────────────────────────────────────────────────────────────────

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'public', 'index.html'));
}

function buildMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Tasks File…',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const newPath = await ipcMain.emit ? null : null;
            const result = await dialog.showOpenDialog(mainWindow, {
              properties: ['openFile'],
              filters: [{ name: 'Markdown', extensions: ['md'] }],
              defaultPath: app.getPath('documents'),
            });
            if (!result.canceled && result.filePaths[0]) {
              const cfg = readConfig();
              cfg.tasksFile = result.filePaths[0];
              writeConfig(cfg);
              mainWindow.webContents.send('file:changed', result.filePaths[0]);
            }
          },
        },
        {
          label: 'Show Tasks File in Finder',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => shell.showItemInFinder(getTasksFile()),
        },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  app.setName('Markdown Kanban');
  app.setAboutPanelOptions({
    applicationName: 'Markdown Kanban',
    applicationVersion: app.getVersion(),
    copyright: 'Copyright © 2026 Markdown Kanban by https://github.com/psc808',
  });
  createWindow();
  buildMenu();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
