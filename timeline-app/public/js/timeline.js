const MOODS = [
  { emoji: '😊', label: 'Happy', color: '#f4b942' },
  { emoji: '🥰', label: 'Loved', color: '#f28fb0' },
  { emoji: '😌', label: 'Calm', color: '#7fb9c9' },
  { emoji: '😐', label: 'Neutral', color: '#b8b0a4' },
  { emoji: '😢', label: 'Sad', color: '#6f8fc7' },
  { emoji: '😰', label: 'Anxious', color: '#c98fc9' },
  { emoji: '😡', label: 'Angry', color: '#d1615d' },
  { emoji: '😴', label: 'Tired', color: '#8e8ac9' },
];

let username = null;
let encKey = null;
let notes = [];
let selectedMood = MOODS[0].emoji;

const el = (id) => document.getElementById(id);

function moodColor(emoji) {
  const m = MOODS.find((m) => m.emoji === emoji);
  return m ? m.color : '#b8b0a4';
}

function formatDateHeading(date) {
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatTime(date) {
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function renderMoodPicker() {
  const container = el('mood-picker');
  container.innerHTML = '';
  MOODS.forEach((m) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mood-btn' + (m.emoji === selectedMood ? ' selected' : '');
    btn.textContent = m.emoji;
    btn.title = m.label;
    btn.addEventListener('click', () => {
      selectedMood = m.emoji;
      renderMoodPicker();
    });
    container.appendChild(btn);
  });
}

async function decryptNoteForDisplay(note) {
  if (!note.locked) return note.content;
  if (!encKey) return null;
  try {
    return await decryptText(encKey, note.cipher.ciphertext, note.cipher.iv);
  } catch {
    return null;
  }
}

async function renderTimeline() {
  const container = el('timeline');
  container.innerHTML = '';

  if (notes.length === 0) {
    container.innerHTML = '<p class="empty-state">Nothing here yet — write your first note above.</p>';
    return;
  }

  let lastDateKey = null;

  for (const note of notes) {
    const date = new Date(note.createdAt);
    const dateKey = date.toDateString();

    if (dateKey !== lastDateKey) {
      const heading = document.createElement('div');
      heading.className = 'date-heading';
      heading.textContent = formatDateHeading(date);
      container.appendChild(heading);
      lastDateKey = dateKey;
    }

    const card = document.createElement('div');
    card.className = 'note-card';
    card.style.setProperty('--mood-color', moodColor(note.mood));

    const top = document.createElement('div');
    top.className = 'note-card-top';
    const moodSpan = document.createElement('span');
    moodSpan.className = 'note-card-mood';
    moodSpan.textContent = note.mood;
    const timeSpan = document.createElement('span');
    timeSpan.textContent = formatTime(date) + (note.locked ? '  🔒' : '');
    top.appendChild(moodSpan);
    top.appendChild(timeSpan);

    const preview = document.createElement('div');
    preview.className = 'note-card-preview';

    if (note.locked) {
      const text = await decryptNoteForDisplay(note);
      if (text === null) {
        preview.textContent = 'Locked — enter your password to view';
        preview.classList.add('locked-text');
      } else {
        preview.textContent = text;
      }
    } else {
      preview.textContent = note.content;
    }

    card.appendChild(top);
    card.appendChild(preview);
    card.addEventListener('click', () => openNoteModal(note));
    container.appendChild(card);
  }
}

async function openNoteModal(note) {
  const text = note.locked ? await decryptNoteForDisplay(note) : note.content;
  el('modal-mood').textContent = note.mood;
  el('modal-date').textContent =
    new Date(note.createdAt).toLocaleString() + (note.locked ? '  ·  🔒 Locked' : '');
  el('modal-content').textContent =
    text === null ? 'This note is locked and could not be decrypted on this device.' : text;

  const deleteBtn = el('modal-delete-btn');
  deleteBtn.onclick = () => deleteNote(note.id);

  el('note-modal').classList.remove('hidden');
}

function closeNoteModal() {
  el('note-modal').classList.add('hidden');
}

async function deleteNote(id) {
  if (!confirm('Delete this note permanently? This cannot be undone.')) return;
  const res = await fetch(`/api/notes/${id}`, { method: 'DELETE' });
  if (res.ok) {
    notes = notes.filter((n) => n.id !== id);
    closeNoteModal();
    renderTimeline();
  }
}

async function loadNotes() {
  const res = await fetch('/api/notes');
  if (res.status === 401) {
    window.location.href = '/login.html';
    return;
  }
  notes = await res.json();
  renderTimeline();
}

async function postNote() {
  const textEl = el('note-text');
  const content = textEl.value.trim();
  if (!content) return;

  const locked = el('lock-checkbox').checked;
  let body;

  if (locked) {
    if (!encKey) {
      alert('Unlock your notes on this device first (see the unlock prompt) before locking a note.');
      return;
    }
    const cipher = await encryptText(encKey, content);
    body = { mood: selectedMood, locked: true, cipher };
  } else {
    body = { mood: selectedMood, locked: false, content };
  }

  const res = await fetch('/api/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (res.ok) {
    const note = await res.json();
    notes.unshift(note);
    textEl.value = '';
    el('lock-checkbox').checked = false;
    renderTimeline();
  }
}

async function maybePromptForUnlock() {
  encKey = await loadEncKey(username);
  if (encKey) return;

  const modal = el('unlock-modal');
  modal.classList.remove('hidden');

  return new Promise((resolve) => {
    const unlockBtn = el('unlock-btn');
    const skipBtn = el('skip-unlock-btn');
    const passwordInput = el('unlock-password');
    const errorEl = el('unlock-error');

    const finish = () => {
      modal.classList.add('hidden');
      unlockBtn.onclick = null;
      skipBtn.onclick = null;
      resolve();
    };

    unlockBtn.onclick = async () => {
      const password = passwordInput.value;
      if (!password) {
        errorEl.textContent = 'Please enter your password';
        return;
      }
      encKey = await deriveEncKey(password, username);
      await storeEncKey(username, encKey);
      finish();
    };

    skipBtn.onclick = () => {
      encKey = null;
      finish();
    };
  });
}

async function init() {
  const meRes = await fetch('/api/me');
  if (meRes.status === 401) {
    window.location.href = '/login.html';
    return;
  }
  const me = await meRes.json();
  username = me.username;
  el('username-display').textContent = username;

  await maybePromptForUnlock();
  renderMoodPicker();
  await loadNotes();

  el('post-btn').addEventListener('click', postNote);
  el('modal-close-btn').addEventListener('click', closeNoteModal);
  el('note-modal').addEventListener('click', (e) => {
    if (e.target.id === 'note-modal') closeNoteModal();
  });
  el('logout-btn').addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });
}

document.addEventListener('DOMContentLoaded', init);
