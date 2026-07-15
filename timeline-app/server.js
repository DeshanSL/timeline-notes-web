const crypto = require('crypto');
const path = require('path');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { readDB, writeDB } = require('./db');

const PORT = process.env.PORT || 30001;
const SESSION_SECRET = crypto.randomBytes(32).toString('hex');

// Must match the mood set the frontend offers (public/js/timeline.js).
const ALLOWED_MOODS = ['😊', '🥰', '😌', '😐', '😢', '😰', '😡', '😴'];

const app = express();
app.use(express.json());
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    },
  })
);

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not logged in' });
  }
  next();
}

// ---- Auth ----

app.post('/api/signup', (req, res) => {
  const { username, authHash } = req.body || {};
  if (typeof username !== 'string' || typeof authHash !== 'string') {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  const cleanUsername = username.trim();
  if (!cleanUsername || !authHash) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const db = readDB();
  if (db.users.some((u) => u.username.toLowerCase() === cleanUsername.toLowerCase())) {
    return res.status(409).json({ error: 'That username is already taken' });
  }

  const user = {
    id: crypto.randomUUID(),
    username: cleanUsername,
    passwordHash: bcrypt.hashSync(authHash, 10),
    createdAt: new Date().toISOString(),
  };
  db.users.push(user);
  writeDB(db);

  req.session.userId = user.id;
  req.session.username = user.username;
  res.json({ username: user.username });
});

app.post('/api/login', (req, res) => {
  const { username, authHash } = req.body || {};
  if (typeof username !== 'string' || typeof authHash !== 'string') {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const db = readDB();
  const user = db.users.find((u) => u.username.toLowerCase() === username.trim().toLowerCase());
  if (!user || !bcrypt.compareSync(authHash, user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  req.session.userId = user.id;
  req.session.username = user.username;
  res.json({ username: user.username });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not logged in' });
  }
  res.json({ username: req.session.username });
});

// ---- Notes ----

app.get('/api/notes', requireAuth, (req, res) => {
  const db = readDB();
  const notes = db.notes
    .filter((n) => n.userId === req.session.userId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(notes);
});

app.post('/api/notes', requireAuth, (req, res) => {
  const { mood, locked, content, cipher } = req.body || {};

  if (!ALLOWED_MOODS.includes(mood)) {
    return res.status(400).json({ error: 'Invalid mood' });
  }

  const note = {
    id: crypto.randomUUID(),
    userId: req.session.userId,
    createdAt: new Date().toISOString(),
    mood,
    locked: !!locked,
  };

  if (note.locked) {
    if (!cipher || typeof cipher.ciphertext !== 'string' || typeof cipher.iv !== 'string') {
      return res.status(400).json({ error: 'Locked notes require encrypted cipher data' });
    }
    note.cipher = { ciphertext: cipher.ciphertext, iv: cipher.iv };
  } else {
    if (typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: 'Note content is required' });
    }
    note.content = content;
  }

  const db = readDB();
  db.notes.push(note);
  writeDB(db);
  res.json(note);
});

app.delete('/api/notes/:id', requireAuth, (req, res) => {
  const db = readDB();
  const idx = db.notes.findIndex((n) => n.id === req.params.id && n.userId === req.session.userId);
  if (idx === -1) {
    return res.status(404).json({ error: 'Note not found' });
  }
  db.notes.splice(idx, 1);
  writeDB(db);
  res.json({ ok: true });
});

// ---- Static frontend ----

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.redirect(req.session.userId ? '/timeline.html' : '/login.html');
});

app.listen(PORT, () => {
  console.log(`Timeline app running at http://localhost:${PORT}`);
});
