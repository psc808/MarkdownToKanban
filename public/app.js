'use strict';

// ── Done checkmark animation ───────────────────────────────────────────────

let doneCheckmarkTimer = null;

const SPARK_DIRS = [
  [0, -42], [30, -30], [42, 0], [30, 30],
  [0, 42], [-30, 30], [-42, 0], [-30, -30],
];

function flashDoneCheckmark() {
  const el = document.getElementById('done-checkmark');
  if (!el) return;
  if (doneCheckmarkTimer) clearTimeout(doneCheckmarkTimer);

  // Use WAAPI for sparks — CSS custom properties in @keyframes are unreliable in Chrome
  el.querySelectorAll('.spark').forEach((s, i) => {
    s.getAnimations().forEach(a => a.cancel());
    const [tx, ty] = SPARK_DIRS[i] || [0, 0];
    const delay = 180 + (i % 2) * 30;
    const dur   = 550 + (i % 2) * 100;
    const sx = tx * 0.35, sy = ty * 0.35;
    s.animate([
      { opacity: 1, transform: `translate(-50%, -50%) translate(${sx}px, ${sy}px)` },
      { opacity: 0.85, offset: 0.6 },
      { opacity: 0, transform: `translate(-50%, -50%) translate(${tx}px, ${ty}px)` },
    ], { duration: dur, delay, easing: 'ease-out', fill: 'forwards' });
  });

  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  doneCheckmarkTimer = setTimeout(() => {
    el.classList.remove('show');
    doneCheckmarkTimer = null;
  }, 1600);
}

// ── Constants ──────────────────────────────────────────────────────────────

const COLUMN_DEFS = [
  { status: 'Backlog',      cls: 'col-todo' },
  { status: 'Priority',    cls: 'col-priority' },
  { status: 'In Progress', cls: 'col-inprogress' },
  { status: 'Done',        cls: 'col-done' },
];

const CATEGORIES = [
  '#Other', '#Org', '#IrisConsumption', '#Automation',
  '#Blueprints', '#Sites', '#Map', '#Home', '#Marketplace', '#DevExperience',
];

const CAT_COLORS = {
  '#Other':           '#6b7280',
  '#Org':             '#8b5cf6',
  '#IrisConsumption': '#0ea5e9',
  '#Automation':      '#f59e0b',
  '#Blueprints':      '#3b82f6',
  '#Sites':           '#10b981',
  '#Map':             '#84cc16',
  '#Home':            '#f97316',
  '#Marketplace':     '#ec4899',
  '#DevExperience':   '#06b6d4',
};

// ── State ──────────────────────────────────────────────────────────────────

let allTasks = [];
let columnBodyMap = {};   // status → .column-body element
let columnCountMap = {};  // status → count badge element
let draggedCard = null;
let draggedTaskId = null;
let activeDropdown = null;
let sortOrder = localStorage.getItem('kanban-sort') || 'creation';
let categoryFilter = '';  // '' = show all, '#Map' = only that category
let customOrderMap = {};  // status → [taskId, ...] for custom sort
let dropIndicator = null; // visual insertion-line element during drag
let selectedTaskIds = new Set(); // ids of currently selected cards
let selectionAnchorId = null;   // task id of the last non-shift-clicked card (range anchor)

try {
  const saved = localStorage.getItem('kanban-custom-order');
  if (saved) customOrderMap = JSON.parse(saved);
} catch { customOrderMap = {}; }

// ── Helpers ────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderNotes(raw) {
  if (!raw) return '';
  return esc(raw)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g,
      (_, t, u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`)
    .replace(/\n/g, '<br>');
}

function fmtDate(raw) {
  if (!raw || raw === '–' || raw === '-') return null;
  const d = new Date(raw);
  return isNaN(d) ? raw : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function isOverdue(raw) {
  if (!raw || raw === '–') return false;
  const d = new Date(raw);
  return !isNaN(d) && d < new Date();
}

function getColTasks(tasks, status) {
  const filtered = tasks.filter(t => t.status === status && (!categoryFilter || t.category === categoryFilter));
  if (sortOrder === 'duedate') {
    return [...filtered].sort((a, b) => {
      const da = a.due && a.due !== '–' && a.due !== '-' ? new Date(a.due) : null;
      const db = b.due && b.due !== '–' && b.due !== '-' ? new Date(b.due) : null;
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return da - db;
    });
  }
  if (sortOrder === 'custom') {
    const order = customOrderMap[status];
    if (order && order.length) {
      const idxMap = new Map(order.map((id, i) => [id, i]));
      return [...filtered].sort((a, b) => {
        const ia = idxMap.has(a.id) ? idxMap.get(a.id) : Infinity;
        const ib = idxMap.has(b.id) ? idxMap.get(b.id) : Infinity;
        return ia < ib ? -1 : ia > ib ? 1 : 0;
      });
    }
    return [...filtered].reverse();
  }
  return [...filtered].sort((a, b) => {
    const da = a.created ? new Date(a.created) : null;
    const db = b.created ? new Date(b.created) : null;
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return db - da;
  });
}

function catStyle(cat) {
  const hex = CAT_COLORS[cat] || '#6b7280';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `background:rgba(${r},${g},${b},0.12);color:${hex};border-color:rgba(${r},${g},${b},0.35)`;
}

// ── Custom order helpers ────────────────────────────────────────────────────

function saveCustomOrder() {
  localStorage.setItem('kanban-custom-order', JSON.stringify(customOrderMap));
}

function captureColumnOrder(status) {
  const bodyEl = columnBodyMap[status];
  if (!bodyEl) return;
  customOrderMap[status] = [...bodyEl.querySelectorAll('.card')].map(c => Number(c.dataset.taskId));
}

function captureAllColumnsOrder() {
  for (const status of Object.keys(columnBodyMap)) captureColumnOrder(status);
}

// ── Drop indicator helpers ──────────────────────────────────────────────────

function getDropInsertBefore(bodyEl, clientY) {
  const cards = [...bodyEl.querySelectorAll('.card:not(.dragging)')];
  for (const card of cards) {
    const rect = card.getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) return card;
  }
  return null;
}

function updateDropIndicator(bodyEl, beforeEl) {
  if (!dropIndicator) {
    dropIndicator = document.createElement('div');
    dropIndicator.className = 'drop-indicator';
  }
  if (beforeEl) {
    bodyEl.insertBefore(dropIndicator, beforeEl);
  } else {
    const ph = bodyEl.querySelector('.column-empty');
    if (ph) bodyEl.insertBefore(dropIndicator, ph);
    else bodyEl.appendChild(dropIndicator);
  }
}

function removeDropIndicator() {
  if (dropIndicator && dropIndicator.parentNode) dropIndicator.parentNode.removeChild(dropIndicator);
}

// ── Multi-select helpers ────────────────────────────────────────────────────

function clearSelection() {
  selectedTaskIds.clear();
  selectionAnchorId = null;
  document.querySelectorAll('.card.selected').forEach(c => c.classList.remove('selected'));
  document.querySelectorAll('.card.drag-ghost').forEach(c => c.classList.remove('drag-ghost'));
}

function toggleCardSelection(taskId, cardEl) {
  if (selectedTaskIds.has(taskId)) {
    selectedTaskIds.delete(taskId);
    cardEl.classList.remove('selected');
  } else {
    selectedTaskIds.add(taskId);
    cardEl.classList.add('selected');
  }
}

function rectsOverlap(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function setupRubberBand(bodyEl) {
  let startX, startY, rubberEl;

  bodyEl.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('.card')) return;
    startX = e.clientX;
    startY = e.clientY;

    rubberEl = document.createElement('div');
    rubberEl.className = 'rubber-band';
    document.body.appendChild(rubberEl);

    const onMove = (ev) => {
      const x = Math.min(ev.clientX, startX);
      const y = Math.min(ev.clientY, startY);
      const w = Math.abs(ev.clientX - startX);
      const h = Math.abs(ev.clientY - startY);
      rubberEl.style.left   = `${x}px`;
      rubberEl.style.top    = `${y}px`;
      rubberEl.style.width  = `${w}px`;
      rubberEl.style.height = `${h}px`;
    };

    const onUp = (ev) => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (!rubberEl) return;
      const rect = rubberEl.getBoundingClientRect();
      rubberEl.remove();
      rubberEl = null;

      if (rect.width < 5 && rect.height < 5) {
        clearSelection();
        return;
      }

      if (!ev.shiftKey) clearSelection();
      bodyEl.querySelectorAll('.card').forEach(card => {
        const cr = card.getBoundingClientRect();
        if (rectsOverlap(rect, cr)) {
          selectedTaskIds.add(Number(card.dataset.taskId));
          card.classList.add('selected');
        }
      });
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

// ── API ────────────────────────────────────────────────────────────────────

const api = window.electronAPI || null;

async function apiPatch(id, changes) {
  if (api) { await api.updateTask(id, changes); return; }
  const res = await fetch(`/api/tasks/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(changes),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
}

async function apiDelete(id) {
  if (api) { await api.deleteTask(id); return; }
  const res = await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
}

async function apiCreate(fields) {
  if (api) { await api.createTask(fields); return; }
  const res = await fetch('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
}

// ── Column count sync ──────────────────────────────────────────────────────

function syncCounts() {
  for (const [status, bodyEl] of Object.entries(columnBodyMap)) {
    const count = bodyEl.querySelectorAll('.card').length;
    if (columnCountMap[status]) columnCountMap[status].textContent = count;

    const isEmpty = count === 0;
    let placeholder = bodyEl.querySelector('.column-empty');
    if (isEmpty && !placeholder) {
      placeholder = document.createElement('div');
      placeholder.className = 'column-empty';
      placeholder.textContent = 'No tasks';
      bodyEl.appendChild(placeholder);
    } else if (!isEmpty && placeholder) {
      placeholder.remove();
    }
  }
}

// ── Error toast ────────────────────────────────────────────────────────────

function showError(msg) {
  let toast = document.getElementById('error-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'error-toast';
    toast.className = 'error-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('visible');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('visible'), 4000);
}

// ── Drag and drop ──────────────────────────────────────────────────────────

function addDragToCard(card, task) {
  card.draggable = true;

  card.addEventListener('dragstart', (e) => {
    // If dragging an unselected card, clear selection and drag only this card
    if (!selectedTaskIds.has(task.id)) clearSelection();

    draggedCard = card;
    draggedTaskId = task.id;
    e.dataTransfer.effectAllowed = 'move';

    // Expand all column bodies to at least the source column's height so
    // dragging from a tall column into a short one always has a full drop target
    const sourceBody = columnBodyMap[task.status];
    if (sourceBody) {
      const h = sourceBody.getBoundingClientRect().height;
      Object.values(columnBodyMap).forEach(b => { b.style.minHeight = `${h}px`; });
    }

    // Defer class so drag ghost captures the un-dimmed card
    setTimeout(() => {
      card.classList.add('dragging');
      if (selectedTaskIds.has(task.id) && selectedTaskIds.size > 1) {
        document.querySelectorAll('.card.selected').forEach(c => {
          if (c !== card) c.classList.add('drag-ghost');
        });
      }
    }, 0);
  });

  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    document.querySelectorAll('.card.drag-ghost').forEach(c => c.classList.remove('drag-ghost'));
    Object.values(columnBodyMap).forEach(b => {
      b.style.minHeight = '';
      b.classList.remove('drag-over');
    });
    removeDropIndicator();
    hideDragColumnLabel();
    draggedCard = null;
    draggedTaskId = null;
  });
}

let dragLabelEl = null;
function showDragColumnLabel(status) {
  if (!dragLabelEl) {
    dragLabelEl = document.createElement('div');
    dragLabelEl.className = 'drag-column-label';
    document.body.appendChild(dragLabelEl);
  }
  dragLabelEl.textContent = status;
  dragLabelEl.style.display = 'block';
}
function hideDragColumnLabel() {
  if (dragLabelEl) dragLabelEl.style.display = 'none';
}

function setupColumnDrop(colEl, bodyEl, status) {
  colEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    bodyEl.classList.add('drag-over');
    updateDropIndicator(bodyEl, getDropInsertBefore(bodyEl, e.clientY));
    showDragColumnLabel(status);
  });

  colEl.addEventListener('dragleave', (e) => {
    if (!colEl.contains(e.relatedTarget)) {
      bodyEl.classList.remove('drag-over');
      removeDropIndicator();
      hideDragColumnLabel();
    }
  });

  colEl.addEventListener('drop', async (e) => {
    e.preventDefault();
    bodyEl.classList.remove('drag-over');
    if (!draggedCard || !draggedTaskId) { removeDropIndicator(); return; }

    const isMultiDrag = selectedTaskIds.has(draggedTaskId) && selectedTaskIds.size > 1;

    if (isMultiDrag) {
      removeDropIndicator();

      // Collect all selected cards and their tasks in column DOM order
      const allCards = [...document.querySelectorAll('.card')];
      const selectedCards = allCards.filter(c => selectedTaskIds.has(Number(c.dataset.taskId)));

      // Insert all selected cards at the top of the target column (after add-task-btn)
      const addBtn = bodyEl.querySelector('.add-task-btn');
      const refNode = addBtn ? addBtn.nextSibling : bodyEl.firstChild;
      for (const c of selectedCards) {
        bodyEl.insertBefore(c, refNode);
      }

      // Update statuses and collect cross-column tasks
      const crossColumnTasks = [];
      for (const id of selectedTaskIds) {
        const t = allTasks.find(x => x.id === id);
        if (!t) continue;
        if (t.status !== status) {
          t.status = status;
          crossColumnTasks.push(t);
        }
      }

      if (crossColumnTasks.length > 0) {
        syncCounts();
        if (status === 'Done') flashDoneCheckmark();
      }

      captureAllColumnsOrder();
      sortOrder = 'custom';
      localStorage.setItem('kanban-sort', 'custom');
      saveCustomOrder();
      const sel2 = document.getElementById('sort-select');
      if (sel2) sel2.value = 'custom';

      for (const t of crossColumnTasks) {
        try {
          await apiPatch(t.id, { status });
        } catch (err) {
          showError('Could not save status change: ' + err.message);
        }
      }

      clearSelection();
      return;
    }

    const task = allTasks.find(t => t.id === draggedTaskId);
    if (!task) { removeDropIndicator(); return; }

    const oldStatus = task.status;
    const oldBody = columnBodyMap[oldStatus];
    const isSameColumn = oldStatus === status;

    // Capture where indicator sits before removing it
    const insertBefore = dropIndicator && dropIndicator.parentNode === bodyEl
      ? dropIndicator.nextSibling
      : null;
    removeDropIndicator();

    // Move card to the indicated position (DOM handles cross-column move automatically)
    if (insertBefore) {
      bodyEl.insertBefore(draggedCard, insertBefore);
    } else {
      const ph = bodyEl.querySelector('.column-empty');
      if (ph) bodyEl.insertBefore(draggedCard, ph);
      else bodyEl.appendChild(draggedCard);
    }

    // Update task status for cross-column moves
    if (!isSameColumn) {
      task.status = status;
      syncCounts();
      if (status === 'Done') flashDoneCheckmark();
    }

    // Capture all columns' current DOM order as the new custom order
    captureAllColumnsOrder();

    // Switch to custom sort and persist
    sortOrder = 'custom';
    localStorage.setItem('kanban-sort', 'custom');
    saveCustomOrder();
    const sel = document.getElementById('sort-select');
    if (sel) sel.value = 'custom';

    // Persist status change to server for cross-column moves
    if (!isSameColumn) {
      try {
        await apiPatch(task.id, { status });
      } catch (err) {
        task.status = oldStatus;
        if (oldBody) oldBody.appendChild(draggedCard);
        syncCounts();
        showError('Could not save status change: ' + err.message);
      }
    }
  });
}

// ── Inline edit: title ─────────────────────────────────────────────────────

function makeTitleEditable(titleEl, task) {
  if (titleEl.dataset.editing) return;
  titleEl.dataset.editing = '1';

  const original = task.title;

  const wrap = document.createElement('div');
  wrap.className = 'edit-wrap';

  const input = document.createElement('textarea');
  input.className = 'edit-input';
  input.value = original;
  input.rows = 1;
  input.style.resize = 'none';
  input.style.overflow = 'hidden';
  const autoResize = () => { input.style.height = 'auto'; input.style.height = input.scrollHeight + 'px'; };
  input.addEventListener('input', autoResize);

  const actions = document.createElement('div');
  actions.className = 'edit-actions';

  const saveBtn = document.createElement('button');
  saveBtn.className = 'edit-btn save-btn';
  saveBtn.textContent = '✓ Save';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'edit-btn cancel-btn';
  cancelBtn.textContent = 'Cancel';

  actions.append(saveBtn, cancelBtn);
  wrap.append(input, actions);

  titleEl.replaceWith(wrap);
  input.focus();
  input.select();

  const cancel = () => {
    wrap.replaceWith(titleEl);
    delete titleEl.dataset.editing;
  };

  const save = async () => {
    const newTitle = input.value.trim();
    if (!newTitle || newTitle === original) { cancel(); return; }
    saveBtn.disabled = true;
    try {
      await apiPatch(task.id, { title: newTitle });
      task.title = newTitle;
      titleEl.textContent = newTitle;
      cancel();
    } catch (err) {
      saveBtn.disabled = false;
      showError('Could not save title: ' + err.message);
    }
  };

  saveBtn.addEventListener('click', save);
  cancelBtn.addEventListener('click', cancel);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') save();
    if (e.key === 'Escape') cancel();
  });
}

// ── Inline edit: notes ─────────────────────────────────────────────────────

function makeNotesEditable(notesEl, task) {
  if (notesEl.dataset.editing) return;
  notesEl.dataset.editing = '1';

  const original = task.notes || '';

  const textarea = document.createElement('textarea');
  textarea.className = 'edit-textarea';
  textarea.value = original;
  // Auto-size to content
  const lineCount = (original.match(/\n/g) || []).length + 1;
  textarea.rows = Math.max(3, Math.min(lineCount + 1, 12));

  const actions = document.createElement('div');
  actions.className = 'edit-actions';

  const saveBtn = document.createElement('button');
  saveBtn.className = 'edit-btn save-btn';
  saveBtn.textContent = '✓ Save';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'edit-btn cancel-btn';
  cancelBtn.textContent = 'Cancel';

  actions.append(saveBtn, cancelBtn);

  notesEl.style.display = 'none';
  notesEl.after(textarea);
  textarea.after(actions);
  textarea.focus();

  const cancel = () => {
    textarea.remove();
    actions.remove();
    notesEl.style.display = '';
    delete notesEl.dataset.editing;
  };

  const save = async () => {
    const newNotes = textarea.value;
    saveBtn.disabled = true;
    try {
      await apiPatch(task.id, { notes: newNotes });
      task.notes = newNotes;
      if (newNotes.trim()) {
        notesEl.innerHTML = renderNotes(newNotes);
        notesEl.classList.remove('notes-empty');
      } else {
        notesEl.innerHTML = '<span class="notes-placeholder">Click to add notes…</span>';
        notesEl.classList.add('notes-empty');
      }
      cancel();
    } catch (err) {
      saveBtn.disabled = false;
      showError('Could not save notes: ' + err.message);
    }
  };

  saveBtn.addEventListener('click', save);
  cancelBtn.addEventListener('click', cancel);
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') cancel();
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
  });
}

// ── Category dropdown ──────────────────────────────────────────────────────

function showCategoryDropdown(anchorEl, task, tagEl) {
  if (activeDropdown) { activeDropdown.remove(); activeDropdown = null; }

  const dropdown = document.createElement('div');
  dropdown.className = 'cat-dropdown';
  activeDropdown = dropdown;

  for (const cat of CATEGORIES) {
    const btn = document.createElement('button');
    btn.className = 'cat-option' + (cat === task.category ? ' selected' : '');
    btn.textContent = cat;
    const hex = CAT_COLORS[cat] || '#6b7280';
    btn.style.color = hex;

    btn.addEventListener('mousedown', async (e) => {
      e.stopPropagation();
      dropdown.remove();
      activeDropdown = null;
      if (cat === task.category) return;

      const prev = task.category;
      // Optimistic update
      task.category = cat;
      tagEl.textContent = cat;
      tagEl.style.cssText = catStyle(cat);

      try {
        await apiPatch(task.id, { category: cat });
      } catch (err) {
        task.category = prev;
        tagEl.textContent = prev || '+ category';
        tagEl.style.cssText = prev ? catStyle(prev) : '';
        showError('Could not save category: ' + err.message);
      }
    });

    dropdown.appendChild(btn);
  }

  // Position: fixed, below the anchor (flip up if too close to bottom)
  const rect = anchorEl.getBoundingClientRect();
  dropdown.style.left = `${Math.min(rect.left, window.innerWidth - 175)}px`;
  dropdown.style.top = `${rect.bottom + 4}px`;
  document.body.appendChild(dropdown);

  // Flip up if it overflows viewport
  const ddRect = dropdown.getBoundingClientRect();
  if (ddRect.bottom > window.innerHeight - 8) {
    dropdown.style.top = `${rect.top - ddRect.height - 4}px`;
  }

  // Dismiss on next click anywhere
  setTimeout(() => {
    document.addEventListener('mousedown', function dismiss() {
      dropdown.remove();
      activeDropdown = null;
      document.removeEventListener('mousedown', dismiss);
    });
  }, 0);
}

// ── New task button + modal ────────────────────────────────────────────────

function openNewTaskModal(status) {
  document.getElementById('new-task-modal')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'new-task-modal';
  overlay.className = 'modal-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'modal';

  const heading = document.createElement('h3');
  heading.className = 'modal-heading';
  heading.textContent = 'New task';

  const statusNote = document.createElement('p');
  statusNote.className = 'modal-status-note';
  statusNote.textContent = `Adding to: ${status}`;

  // Title (required)
  const titleGroup = document.createElement('div');
  titleGroup.className = 'modal-field';
  const titleLabel = document.createElement('label');
  titleLabel.className = 'modal-label';
  titleLabel.innerHTML = 'Title <span class="modal-required">*</span>';
  titleLabel.htmlFor = 'ntask-title';
  const titleInput = document.createElement('input');
  titleInput.id = 'ntask-title';
  titleInput.className = 'modal-input';
  titleInput.type = 'text';
  titleInput.placeholder = 'Task title…';
  titleGroup.append(titleLabel, titleInput);

  // Due date (optional)
  const dueGroup = document.createElement('div');
  dueGroup.className = 'modal-field';
  const dueLabel = document.createElement('label');
  dueLabel.className = 'modal-label';
  dueLabel.textContent = 'Due date';
  dueLabel.htmlFor = 'ntask-due';
  const dueInput = document.createElement('input');
  dueInput.id = 'ntask-due';
  dueInput.className = 'modal-input';
  dueInput.type = 'date';
  dueGroup.append(dueLabel, dueInput);

  // Category (optional)
  const catGroup = document.createElement('div');
  catGroup.className = 'modal-field';
  const catLabel = document.createElement('label');
  catLabel.className = 'modal-label';
  catLabel.textContent = 'Category';
  catLabel.htmlFor = 'ntask-cat';
  const catSelect = document.createElement('select');
  catSelect.id = 'ntask-cat';
  catSelect.className = 'modal-input modal-select';
  const noneOpt = document.createElement('option');
  noneOpt.value = '';
  noneOpt.textContent = '— none —';
  catSelect.appendChild(noneOpt);
  for (const cat of CATEGORIES) {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    catSelect.appendChild(opt);
  }
  catGroup.append(catLabel, catSelect);

  // Description (optional, 200 chars)
  const descGroup = document.createElement('div');
  descGroup.className = 'modal-field';
  const descLabel = document.createElement('label');
  descLabel.className = 'modal-label';
  descLabel.textContent = 'Description';
  descLabel.htmlFor = 'ntask-desc';
  const descInput = document.createElement('textarea');
  descInput.id = 'ntask-desc';
  descInput.className = 'modal-textarea';
  descInput.placeholder = 'Optional notes…';
  descInput.maxLength = 200;
  descInput.rows = 3;
  const charCount = document.createElement('span');
  charCount.className = 'modal-char-count';
  charCount.textContent = '200 chars remaining';
  descInput.addEventListener('input', () => {
    const rem = 200 - descInput.value.length;
    charCount.textContent = `${rem} char${rem !== 1 ? 's' : ''} remaining`;
    charCount.classList.toggle('modal-char-count-low', rem <= 20);
  });
  descGroup.append(descLabel, descInput, charCount);

  // Actions
  const actions = document.createElement('div');
  actions.className = 'modal-actions';
  const createBtn = document.createElement('button');
  createBtn.className = 'edit-btn save-btn';
  createBtn.textContent = 'Create task';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'edit-btn cancel-btn';
  cancelBtn.textContent = 'Cancel';
  actions.append(createBtn, cancelBtn);

  dialog.append(heading, statusNote, titleGroup, dueGroup, catGroup, descGroup, actions);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  titleInput.focus();

  function onKeydown(e) {
    if (e.key === 'Escape') { close(); return; }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submit(); }
  }
  document.addEventListener('keydown', onKeydown);

  function close() {
    overlay.remove();
    document.removeEventListener('keydown', onKeydown);
  }

  async function submit() {
    const title = titleInput.value.trim();
    if (!title) { titleInput.focus(); return; }
    createBtn.disabled = true;
    createBtn.textContent = 'Creating…';
    try {
      await apiCreate({
        title,
        created: new Date().toISOString().slice(0, 10),
        due: dueInput.value || '–',
        status,
        category: catSelect.value,
        notes: descInput.value.trim(),
      });
      close();
      load();
    } catch (err) {
      createBtn.disabled = false;
      createBtn.textContent = 'Create task';
      showError('Could not create task: ' + err.message);
    }
  }

  createBtn.addEventListener('click', submit);
  cancelBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  titleInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
}

function openEditTaskModal(task) {
  document.getElementById('edit-task-modal')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'edit-task-modal';
  overlay.className = 'modal-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'modal';

  const heading = document.createElement('h3');
  heading.className = 'modal-heading';
  heading.textContent = 'Edit task';

  // Title (required)
  const titleGroup = document.createElement('div');
  titleGroup.className = 'modal-field';
  const titleLabel = document.createElement('label');
  titleLabel.className = 'modal-label';
  titleLabel.innerHTML = 'Title <span class="modal-required">*</span>';
  titleLabel.htmlFor = 'etask-title';
  const titleInput = document.createElement('input');
  titleInput.id = 'etask-title';
  titleInput.className = 'modal-input';
  titleInput.type = 'text';
  titleInput.value = task.title;
  titleGroup.append(titleLabel, titleInput);

  // Status
  const statusGroup = document.createElement('div');
  statusGroup.className = 'modal-field';
  const statusLabel = document.createElement('label');
  statusLabel.className = 'modal-label';
  statusLabel.textContent = 'Status';
  statusLabel.htmlFor = 'etask-status';
  const statusSelect = document.createElement('select');
  statusSelect.id = 'etask-status';
  statusSelect.className = 'modal-input modal-select';
  for (const { status } of COLUMN_DEFS) {
    const opt = document.createElement('option');
    opt.value = status;
    opt.textContent = status;
    if (status === task.status) opt.selected = true;
    statusSelect.appendChild(opt);
  }
  statusGroup.append(statusLabel, statusSelect);

  // Due date
  const dueGroup = document.createElement('div');
  dueGroup.className = 'modal-field';
  const dueLabel = document.createElement('label');
  dueLabel.className = 'modal-label';
  dueLabel.textContent = 'Due date';
  dueLabel.htmlFor = 'etask-due';
  const dueInput = document.createElement('input');
  dueInput.id = 'etask-due';
  dueInput.className = 'modal-input';
  dueInput.type = 'date';
  if (task.due && task.due !== '–' && task.due !== '-') dueInput.value = task.due;
  dueGroup.append(dueLabel, dueInput);

  // Category
  const catGroup = document.createElement('div');
  catGroup.className = 'modal-field';
  const catLabel = document.createElement('label');
  catLabel.className = 'modal-label';
  catLabel.textContent = 'Category';
  catLabel.htmlFor = 'etask-cat';
  const catSelect = document.createElement('select');
  catSelect.id = 'etask-cat';
  catSelect.className = 'modal-input modal-select';
  const noneOpt = document.createElement('option');
  noneOpt.value = '';
  noneOpt.textContent = '— none —';
  catSelect.appendChild(noneOpt);
  for (const cat of CATEGORIES) {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    if (cat === task.category) opt.selected = true;
    catSelect.appendChild(opt);
  }
  catGroup.append(catLabel, catSelect);

  // Notes
  const descGroup = document.createElement('div');
  descGroup.className = 'modal-field';
  const descLabel = document.createElement('label');
  descLabel.className = 'modal-label';
  descLabel.textContent = 'Notes';
  descLabel.htmlFor = 'etask-desc';
  const descInput = document.createElement('textarea');
  descInput.id = 'etask-desc';
  descInput.className = 'modal-textarea';
  descInput.placeholder = 'Optional notes…';
  descInput.rows = 4;
  descInput.value = task.notes || '';
  descGroup.append(descLabel, descInput);

  // Actions
  const actions = document.createElement('div');
  actions.className = 'modal-actions';
  const saveBtn = document.createElement('button');
  saveBtn.className = 'edit-btn save-btn';
  saveBtn.textContent = 'Save changes';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'edit-btn cancel-btn';
  cancelBtn.textContent = 'Cancel';
  actions.append(saveBtn, cancelBtn);

  dialog.append(heading, titleGroup, statusGroup, dueGroup, catGroup, descGroup, actions);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  titleInput.focus();
  titleInput.select();

  function onKeydown(e) {
    if (e.key === 'Escape') { close(); return; }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submit(); }
  }
  document.addEventListener('keydown', onKeydown);

  function close() {
    overlay.remove();
    document.removeEventListener('keydown', onKeydown);
  }

  async function submit() {
    const title = titleInput.value.trim();
    if (!title) { titleInput.focus(); return; }
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';

    const changes = {};
    if (title !== task.title) changes.title = title;
    if (statusSelect.value !== task.status) changes.status = statusSelect.value;
    const newDue = dueInput.value || '–';
    const oldDue = (task.due && task.due !== '–' && task.due !== '-') ? task.due : '–';
    if (newDue !== oldDue) changes.due = newDue;
    if (catSelect.value !== (task.category || '')) changes.category = catSelect.value;
    if (descInput.value !== (task.notes || '')) changes.notes = descInput.value;

    if (Object.keys(changes).length === 0) { close(); return; }

    try {
      await apiPatch(task.id, changes);
      close();
      load();
    } catch (err) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save changes';
      showError('Could not save task: ' + err.message);
    }
  }

  saveBtn.addEventListener('click', submit);
  cancelBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  titleInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
}

function openDeleteConfirmModal(task, card) {
  document.getElementById('delete-confirm-modal')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'delete-confirm-modal';
  overlay.className = 'modal-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'modal modal-narrow';

  const heading = document.createElement('h3');
  heading.className = 'modal-heading';
  heading.textContent = 'Delete task?';

  const msg = document.createElement('p');
  msg.className = 'modal-delete-msg';
  msg.textContent = `"${task.title}" will be permanently removed from the file.`;

  const actions = document.createElement('div');
  actions.className = 'modal-actions';

  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'edit-btn delete-confirm-btn';
  confirmBtn.textContent = 'Delete';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'edit-btn cancel-btn';
  cancelBtn.textContent = 'Cancel';

  actions.append(confirmBtn, cancelBtn);
  dialog.append(heading, msg, actions);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  confirmBtn.focus();

  function onKeydown(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKeydown);

  function close() {
    overlay.remove();
    document.removeEventListener('keydown', onKeydown);
  }

  async function doDelete() {
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Deleting…';
    try {
      await apiDelete(task.id);
      close();
      await load();
    } catch (err) {
      close();
      showError('Could not delete task: ' + err.message);
    }
  }

  confirmBtn.addEventListener('click', doDelete);
  cancelBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
}

function openDeleteAllDoneModal(doneTasks) {
  document.getElementById('delete-all-done-modal')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'delete-all-done-modal';
  overlay.className = 'modal-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'modal modal-narrow';

  const heading = document.createElement('h3');
  heading.className = 'modal-heading';
  heading.textContent = 'Delete all done tasks?';

  const msg = document.createElement('p');
  msg.className = 'modal-delete-msg';
  msg.textContent = `All ${doneTasks.length} task${doneTasks.length !== 1 ? 's' : ''} in the Done column will be permanently removed from the file.`;

  const actions = document.createElement('div');
  actions.className = 'modal-actions';

  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'edit-btn delete-confirm-btn';
  confirmBtn.textContent = 'Delete all';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'edit-btn cancel-btn';
  cancelBtn.textContent = 'Cancel';

  actions.append(confirmBtn, cancelBtn);
  dialog.append(heading, msg, actions);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  confirmBtn.focus();

  function onKeydown(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKeydown);

  function close() {
    overlay.remove();
    document.removeEventListener('keydown', onKeydown);
  }

  async function doDeleteAll() {
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Deleting…';
    try {
      const freshTasks = api ? await api.getTasks() : await fetch('/api/tasks').then(r => r.json());
      const toDelete = freshTasks
        .filter(t => t.status === 'Done')
        .sort((a, b) => b.id - a.id);
      for (const task of toDelete) await apiDelete(task.id);
      close();
      await load();
    } catch (err) {
      close();
      showError('Could not delete tasks: ' + err.message);
    }
  }

  confirmBtn.addEventListener('click', doDeleteAll);
  cancelBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
}

function buildAddTaskBtn(status) {
  const btn = document.createElement('button');
  btn.className = 'add-task-btn';
  btn.textContent = '+ New task';
  btn.addEventListener('click', () => openNewTaskModal(status));
  return btn;
}

// ── Card builder ───────────────────────────────────────────────────────────

function buildCard(task) {
  const card = document.createElement('div');
  card.className = 'card';
  card.dataset.taskId = task.id;

  addDragToCard(card, task);

  // Selection via CMD+click (toggle) or Shift+click (top-to-here range)
  card.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const interactive = e.target.closest('.card-title, .card-edit-btn, .card-delete-btn, .cat-tag, .due-edit-btn, .due-date-input, .card-notes, button, input, textarea, a');
    if (interactive) return;

    if (e.shiftKey) {
      // Select all cards from the top of this column down to (and including) this card
      e.preventDefault();
      e.stopPropagation();
      const bodyEl = card.closest('.column-body');
      if (bodyEl) {
        const allCards = [...bodyEl.querySelectorAll('.card')];
        const currentIdx = allCards.indexOf(card);
        if (currentIdx !== -1) {
          allCards.slice(0, currentIdx + 1).forEach(c => {
            selectedTaskIds.add(Number(c.dataset.taskId));
            c.classList.add('selected');
          });
        }
      }
      return;
    }

    if (e.metaKey || e.ctrlKey) {
      // Defer entirely to click handler — avoids double-toggle with mousedown+click
      e.stopPropagation();
      return;
    }

    // Plain click on an already-selected card: keep selection for potential drag, deselect on click
    if (selectedTaskIds.has(task.id)) {
      e.stopPropagation();
      selectionAnchorId = task.id;
    }
    // Plain click on unselected card: do nothing here — let dragstart / click handle it
  });

  card.addEventListener('click', (e) => {
    if (e.button !== 0) return;
    const interactive = e.target.closest('.card-title, .card-edit-btn, .card-delete-btn, .cat-tag, .due-edit-btn, .due-date-input, .card-notes, button, input, textarea, a');
    if (interactive) return;
    if (e.shiftKey) return;

    if (e.metaKey || e.ctrlKey) {
      toggleCardSelection(task.id, card);
      return;
    }

    // Plain click: clear entire selection
    clearSelection();
  });

  // Card header: title + delete button
  const headerEl = document.createElement('div');
  headerEl.className = 'card-header';

  const titleEl = document.createElement('div');
  titleEl.className = 'card-title';
  titleEl.textContent = task.title;
  titleEl.title = 'Click to edit';
  titleEl.addEventListener('click', () => makeTitleEditable(titleEl, task));

  const editBtn = document.createElement('button');
  editBtn.className = 'card-edit-btn';
  editBtn.title = 'Edit task';
  editBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
  editBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openEditTaskModal(task);
  });

  const trashBtn = document.createElement('button');
  trashBtn.className = 'card-delete-btn';
  trashBtn.title = 'Delete task';
  trashBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
  trashBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openDeleteConfirmModal(task, card);
  });

  const tagEl = document.createElement('span');
  tagEl.className = 'cat-tag';
  tagEl.title = 'Click to change category';
  if (task.category) {
    tagEl.textContent = task.category;
    tagEl.style.cssText = catStyle(task.category);
  } else {
    tagEl.textContent = '+ category';
    tagEl.classList.add('cat-tag-empty');
  }
  tagEl.addEventListener('click', (e) => {
    e.stopPropagation();
    showCategoryDropdown(tagEl, task, tagEl);
  });

  headerEl.append(titleEl, editBtn, trashBtn);

  // Meta
  const metaEl = document.createElement('div');
  metaEl.className = 'card-meta';
  const dueFormatted = fmtDate(task.due);
  const overdue = isOverdue(task.due);
  metaEl.innerHTML = `
    <div class="meta-row">
      <span class="meta-label">Created</span>
      <span class="meta-value">${fmtDate(task.created) || '<span class="none">—</span>'}</span>
    </div>
    <div class="meta-row">
      <span class="meta-label">Due</span>
      <span class="meta-value due-value ${overdue ? 'overdue' : ''}" title="Click calendar to change due date">
        <span class="due-text">${dueFormatted || '<span class="none">—</span>'}</span>
        <button class="due-edit-btn" title="Pick due date" aria-label="Pick due date"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></button>
        <input class="due-date-input" type="date" value="${(task.due && task.due !== '–' && task.due !== '-') ? task.due : ''}">
      </span>
    </div>
    <div class="meta-row">
      <span class="meta-label">Source</span>
      <span class="meta-value">${task.source ? esc(task.source) : '<span class="none">—</span>'}</span>
    </div>`;

  // Due date inline edit
  const dueDateInput = metaEl.querySelector('.due-date-input');
  const dueEditBtn = metaEl.querySelector('.due-edit-btn');
  const dueValueSpan = metaEl.querySelector('.due-value');
  const dueTextSpan = metaEl.querySelector('.due-text');
  dueEditBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    dueDateInput.showPicker ? dueDateInput.showPicker() : dueDateInput.click();
  });
  dueDateInput.addEventListener('change', async () => {
    const newDue = dueDateInput.value || '–';
    await apiPatch(task.id, { due: newDue });
    task.due = newDue;
    const formatted = fmtDate(newDue);
    dueTextSpan.innerHTML = formatted || '<span class="none">—</span>';
    if (isOverdue(newDue)) dueValueSpan.classList.add('overdue');
    else dueValueSpan.classList.remove('overdue');
  });

  // Notes
  const notesEl = document.createElement('div');
  notesEl.className = 'card-notes' + (task.notes ? '' : ' notes-empty');
  notesEl.title = 'Click to edit';
  notesEl.innerHTML = task.notes
    ? renderNotes(task.notes)
    : '<span class="notes-placeholder">Click to add notes…</span>';
  notesEl.addEventListener('click', (e) => {
    if (e.target.tagName === 'A') return; // let links open normally
    makeNotesEditable(notesEl, task);
  });

  card.append(headerEl, tagEl, metaEl, notesEl);
  return card;
}

// ── Board renderer ─────────────────────────────────────────────────────────

function render(tasks) {
  allTasks = tasks;
  columnBodyMap = {};
  columnCountMap = {};

  const board = document.getElementById('board');
  board.innerHTML = '';

  const knownStatuses = new Set(COLUMN_DEFS.map(c => c.status));
  const extras = [...new Set(tasks.map(t => t.status))].filter(s => !knownStatuses.has(s));
  const columns = [...COLUMN_DEFS, ...extras.map(s => ({ status: s, cls: 'col-other' }))];

  for (const { status, cls } of columns) {
    const colTasks = getColTasks(tasks, status);

    const col = document.createElement('div');
    col.className = 'column';

    const header = document.createElement('div');
    header.className = `column-header ${cls}`;

    const titleSpan = document.createElement('span');
    titleSpan.className = 'column-title';
    titleSpan.textContent = status;

    const countBadge = document.createElement('span');
    countBadge.className = 'column-count';
    countBadge.textContent = colTasks.length;
    columnCountMap[status] = countBadge;

    header.append(titleSpan, countBadge);

    if (status === 'Done') {
      const deleteAllBtn = document.createElement('button');
      deleteAllBtn.className = 'col-delete-all-btn';
      deleteAllBtn.title = 'Delete all done tasks';
      deleteAllBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
      deleteAllBtn.addEventListener('click', () => openDeleteAllDoneModal(colTasks));
      header.appendChild(deleteAllBtn);
    }

    const body = document.createElement('div');
    body.className = 'column-body';
    body.dataset.status = status;
    columnBodyMap[status] = body;
    setupColumnDrop(col, body, status);
    setupRubberBand(body);

    body.appendChild(buildAddTaskBtn(status));

    if (colTasks.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'column-empty';
      empty.textContent = 'No tasks';
      body.appendChild(empty);
    } else {
      for (const task of colTasks) body.appendChild(buildCard(task));
    }

    col.append(header, body);
    board.appendChild(col);
  }

  const total = tasks.length;
  document.getElementById('task-count').textContent =
    `${total} task${total !== 1 ? 's' : ''}`;
}

// ── Load ───────────────────────────────────────────────────────────────────

async function load() {
  const btn = document.getElementById('refresh-btn');
  btn.disabled = true;
  btn.textContent = 'Loading…';
  try {
    let tasks;
    if (api) {
      tasks = await api.getTasks();
    } else {
      const res = await fetch('/api/tasks');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      tasks = await res.json();
      if (tasks.error) throw new Error(tasks.error);
    }
    render(tasks);
  } catch (err) {
    document.getElementById('board').innerHTML =
      `<div class="board-error">Could not load tasks: ${esc(err.message)}</div>`;
    document.getElementById('task-count').textContent = '';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Refresh';
  }
}

document.getElementById('refresh-btn').addEventListener('click', load);

// ── Sort control ───────────────────────────────────────────────────────────

(function initSort() {
  const sel = document.getElementById('sort-select');
  sel.value = sortOrder;
  sel.addEventListener('change', () => {
    sortOrder = sel.value;
    localStorage.setItem('kanban-sort', sortOrder);
    render(allTasks);
  });
})();

// ── Category filter ────────────────────────────────────────────────────────

(function initCategoryFilter() {
  const sel = document.getElementById('category-filter');
  CATEGORIES.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', () => {
    categoryFilter = sel.value;
    render(allTasks);
  });
})();

// ── Keyboard shortcuts ─────────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (document.querySelector('.modal-overlay')) return;
    e.preventDefault();
    openNewTaskModal('Backlog');
  }
});

// ── Theme toggle ───────────────────────────────────────────────────────────

(function initTheme() {
  const btn = document.getElementById('theme-btn');
  const html = document.documentElement;

  function applyTheme(dark) {
    html.dataset.theme = dark ? 'dark' : '';
    btn.textContent = dark ? '☀' : '🌙';
    btn.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
  }

  const saved = localStorage.getItem('kanban-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(saved ? saved === 'dark' : prefersDark);

  btn.addEventListener('click', () => {
    const dark = html.dataset.theme !== 'dark';
    applyTheme(dark);
    localStorage.setItem('kanban-theme', dark ? 'dark' : 'light');
  });
})();

// ── Welcome screen (Electron only, shown when no file is configured) ────────

function showWelcome() {
  const board = document.getElementById('board');
  board.innerHTML = '';
  board.style.display = 'flex';

  const wrap = document.createElement('div');
  wrap.className = 'welcome-wrap';

  const icon = document.createElement('div');
  icon.className = 'welcome-icon';
  icon.textContent = '📋';

  const heading = document.createElement('h2');
  heading.className = 'welcome-heading';
  heading.textContent = 'Welcome to Kanban';

  const sub = document.createElement('p');
  sub.className = 'welcome-sub';
  sub.textContent = 'Choose a tasks file to get started.';

  const btns = document.createElement('div');
  btns.className = 'welcome-btns';

  const pickBtn = document.createElement('button');
  pickBtn.className = 'edit-btn save-btn welcome-btn';
  pickBtn.textContent = 'Open existing file…';

  const newBtn = document.createElement('button');
  newBtn.className = 'edit-btn cancel-btn welcome-btn';
  newBtn.textContent = 'Create new file from template…';

  btns.append(pickBtn, newBtn);
  wrap.append(icon, heading, sub, btns);
  board.appendChild(wrap);

  pickBtn.addEventListener('click', async () => {
    const path = await api.chooseFile();
    if (path) load();
  });

  newBtn.addEventListener('click', async () => {
    const path = await api.createFromTemplate();
    if (path) load();
  });
}

// ── Settings modal (Electron only) ─────────────────────────────────────────

async function openSettingsModal() {
  document.getElementById('settings-modal')?.remove();

  const [currentFile, currentArchive] = api
    ? await Promise.all([api.getCurrentFile(), api.getArchiveFile()])
    : [null, null];

  const overlay = document.createElement('div');
  overlay.id = 'settings-modal';
  overlay.className = 'modal-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'modal';

  const heading = document.createElement('h3');
  heading.className = 'modal-heading';
  heading.textContent = 'Settings';

  // ── Tasks file ────────────────────────────────────────────────────────────

  const fileSection = document.createElement('div');
  fileSection.className = 'modal-field';

  const fileLabel = document.createElement('div');
  fileLabel.className = 'modal-label';
  fileLabel.textContent = 'Tasks file';

  const filePath = document.createElement('div');
  filePath.className = 'settings-filepath';
  filePath.textContent = currentFile || '— no file selected —';
  filePath.title = currentFile || '';

  const fileActions = document.createElement('div');
  fileActions.className = 'settings-file-actions';

  const changeBtn = document.createElement('button');
  changeBtn.className = 'edit-btn save-btn';
  changeBtn.textContent = 'Change file…';

  const fromTemplateBtn = document.createElement('button');
  fromTemplateBtn.className = 'edit-btn cancel-btn';
  fromTemplateBtn.textContent = 'Create from template…';

  fileActions.append(changeBtn, fromTemplateBtn);
  fileSection.append(fileLabel, filePath, fileActions);

  // ── Archive file ──────────────────────────────────────────────────────────

  const archiveSection = document.createElement('div');
  archiveSection.className = 'modal-field';

  const archiveLabel = document.createElement('div');
  archiveLabel.className = 'modal-label';
  archiveLabel.textContent = 'Archived tasks file';

  const archiveDesc = document.createElement('div');
  archiveDesc.className = 'settings-field-desc';
  archiveDesc.textContent = 'Used by agents to move completed or outdated tasks out of the main board.';

  const archivePath = document.createElement('div');
  archivePath.className = 'settings-filepath';
  archivePath.textContent = currentArchive || '— no file selected —';
  archivePath.title = currentArchive || '';

  const archiveActions = document.createElement('div');
  archiveActions.className = 'settings-file-actions';

  const archiveChangeBtn = document.createElement('button');
  archiveChangeBtn.className = 'edit-btn save-btn';
  archiveChangeBtn.textContent = 'Change file…';

  const archiveTemplateBtn = document.createElement('button');
  archiveTemplateBtn.className = 'edit-btn cancel-btn';
  archiveTemplateBtn.textContent = 'Create from template…';

  archiveActions.append(archiveChangeBtn, archiveTemplateBtn);
  archiveSection.append(archiveLabel, archiveDesc, archivePath, archiveActions);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────

  const shortcutsSection = document.createElement('div');
  shortcutsSection.className = 'modal-field';

  const shortcutsLabel = document.createElement('div');
  shortcutsLabel.className = 'modal-label';
  shortcutsLabel.textContent = 'Keyboard shortcuts';

  const isMac = navigator.platform.toUpperCase().includes('MAC');
  const mod = isMac ? '⌘' : 'Ctrl';

  const shortcuts = [
    { keys: `${mod} C`, desc: 'New task' },
    { keys: `${mod} ↵`, desc: 'Save task (in modal)' },
  ];

  const shortcutsList = document.createElement('div');
  shortcutsList.className = 'settings-shortcuts';
  shortcuts.forEach(({ keys, desc }) => {
    const row = document.createElement('div');
    row.className = 'settings-shortcut-row';
    const kbd = document.createElement('kbd');
    kbd.className = 'settings-kbd';
    kbd.textContent = keys;
    const label = document.createElement('span');
    label.textContent = desc;
    row.append(kbd, label);
    shortcutsList.appendChild(row);
  });

  const multiSelectLabel = document.createElement('div');
  multiSelectLabel.className = 'modal-label';
  multiSelectLabel.style.marginTop = '14px';
  multiSelectLabel.textContent = 'Multi-select';

  const multiSelectItems = [
    { keys: `${mod} + Click`,         desc: 'Toggle card selection (any column)' },
    { keys: 'Shift + Click',          desc: 'Select from top of column to clicked card' },
    { keys: 'Drag on empty area',     desc: 'Rubber-band select cards' },
    { keys: 'Shift + Rubber-band',    desc: 'Add to existing selection' },
    { keys: 'Drag selected card',     desc: 'Move all selected to top of column' },
  ];

  const multiSelectList = document.createElement('div');
  multiSelectList.className = 'settings-shortcuts';
  multiSelectItems.forEach(({ keys, desc }) => {
    const row = document.createElement('div');
    row.className = 'settings-shortcut-row';
    const kbd = document.createElement('kbd');
    kbd.className = 'settings-kbd';
    kbd.textContent = keys;
    const label = document.createElement('span');
    label.textContent = desc;
    row.append(kbd, label);
    multiSelectList.appendChild(row);
  });

  shortcutsSection.append(shortcutsLabel, shortcutsList, multiSelectLabel, multiSelectList);

  // ── Close ─────────────────────────────────────────────────────────────────

  const closeBtn = document.createElement('button');
  closeBtn.className = 'edit-btn cancel-btn';
  closeBtn.style.marginTop = '4px';
  closeBtn.textContent = 'Close';

  dialog.append(heading, fileSection, archiveSection, shortcutsSection, closeBtn);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  function close() { overlay.remove(); }

  function onKeydown(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKeydown, { once: true });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  closeBtn.addEventListener('click', close);

  changeBtn.addEventListener('click', async () => {
    const path = await api.chooseFile();
    if (path) { close(); load(); }
  });

  fromTemplateBtn.addEventListener('click', async () => {
    const path = await api.createFromTemplate();
    if (path) { close(); load(); }
  });

  archiveChangeBtn.addEventListener('click', async () => {
    const path = await api.chooseArchiveFile();
    if (path) {
      archivePath.textContent = path;
      archivePath.title = path;
    }
  });

  archiveTemplateBtn.addEventListener('click', async () => {
    const path = await api.createArchiveFromTemplate();
    if (path) {
      archivePath.textContent = path;
      archivePath.title = path;
    }
  });
}

// ── Gear button ─────────────────────────────────────────────────────────────

const settingsBtn = document.getElementById('settings-btn');
if (settingsBtn) {
  if (!api) { settingsBtn.style.display = 'none'; }
  else { settingsBtn.addEventListener('click', openSettingsModal); }
}

// ── Init ───────────────────────────────────────────────────────────────────

async function init() {
  if (api) {
    const hasFile = await api.hasFile();
    if (!hasFile) { showWelcome(); return; }
  }
  load();
}

// Reload when the user picks a different file via the File menu (Electron only)
if (api) api.onFileChanged(() => load());

init();
