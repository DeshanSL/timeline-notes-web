# Personal Timeline App — Design Doc

A tiny private webapp for one person (your friend) to log thoughts and mood swings
on a visual timeline, with an optional "locked" mode for entries they don't want
anyone — including the server — to be able to read.

---

## 1. Goals / constraints recap

- Node.js server, run with `npm install && npm run start`. Nothing fancier needed.
- Simple login: username + password (single user, or a handful of users — no email/OAuth/etc).
- Timeline UI: write a note any time → it lands on a timeline with its date. Click a
  timeline entry to expand and read it.
- Persistence: lightest possible option — no database server to install/manage.
- Notes can optionally be **locked** with the login password:
  - Password is hashed once client-side, then hashed **again** server-side before
    storage (server never sees or stores a raw or single-hashed password).
  - Locked note *content* is encrypted **in the browser** before it's ever sent to
    the server — the server only ever stores ciphertext for locked notes.
  - The decryption key lives only in `localStorage`, never sent to the backend.
  - If it's missing (new browser/device, cleared storage), the app asks for the
    password again to regenerate it, and warns clearly that if the password is
    ever forgotten, locked notes are unrecoverable — permanently.

---

## 2. Tech stack

| Concern         | Choice                          | Why |
|-----------------|----------------------------------|-----|
| Server           | Node.js + Express                | Minimal, everyone knows it, one `npm run start`. |
| Persistence      | [`lowdb`](https://github.com/typicode/lowdb) (JSON file on disk) | No native bindings, no DB server, no install step beyond `npm install`. Human-readable file. Perfect for one user's data. |
| Auth hashing (server) | `bcryptjs`                  | Pure JS, no node-gyp/native build hassle (unlike `bcrypt`). |
| Sessions         | `express-session` (MemoryStore) + signed cookie | No Redis needed — fine for single-friend scale. Session just resets if the server restarts. |
| Client crypto    | Browser **Web Crypto API** (`SubtleCrypto`) | Built into every modern browser — zero frontend dependencies, and it's the same engine used for real encryption (PBKDF2 + AES-GCM). |
| Frontend         | Plain HTML/CSS/vanilla JS, served as static files by Express | No build step, no framework, easiest possible thing for a friend to just run. |

Total server dependencies: `express`, `express-session`, `bcryptjs`, `lowdb`, `nanoid` (for IDs). That's it.

---

## 3. Project structure

```
timeline-app/
├── package.json
├── server.js                # Express app, routes, session setup
├── db/
│   ├── users.json           # lowdb-managed
│   └── notes.json           # lowdb-managed
├── public/
│   ├── login.html
│   ├── timeline.html
│   ├── css/
│   │   └── style.css
│   └── js/
│       ├── crypto.js        # hashing + AES/PBKDF2 helpers (Web Crypto)
│       ├── auth.js          # login/signup page logic
│       └── timeline.js       # timeline page logic (render, lock/unlock, post note)
```

---

## 4. Data model

**`db/users.json`**
```json
{
  "users": [
    {
      "id": "u_abc123",
      "username": "friend",
      "passwordHash": "$2a$10$....",  // bcrypt hash of the client-side auth hash
      "createdAt": "2026-07-15T10:00:00.000Z"
    }
  ]
}
```

**`db/notes.json`**
```json
{
  "notes": [
    {
      "id": "n_xyz789",
      "userId": "u_abc123",
      "createdAt": "2026-07-15T14:32:00.000Z",
      "mood": "😊",
      "locked": false,
      "content": "Had a really good walk today."
    },
    {
      "id": "n_xyz790",
      "userId": "u_abc123",
      "createdAt": "2026-07-15T21:10:00.000Z",
      "mood": "😔",
      "locked": true,
      "cipher": {
        "ciphertext": "base64...",
        "iv": "base64..."
      }
    }
  ]
}
```

Note the server **never** stores `content` for a locked note — only `cipher`.
It has no way to read it, ever.

---

## 5. Auth flow — the double-hash requirement

The goal: the raw password never touches the network, and the server never stores
even the client's hash directly.

**Signup / Login (client-side, `crypto.js`):**
```
authHash = SHA-256( password + ":" + username )   // per-user salt via username
```
This `authHash` is what gets sent to the server in place of the raw password —
for both signup and every login attempt.

**Server-side (`server.js`):**
```
// On signup:
passwordHash = bcrypt.hash(authHash, 10)   // store this
// On login:
bcrypt.compare(incoming authHash, stored passwordHash)
```

So: hashed once in the browser (SHA-256), hashed again on the server (bcrypt,
salted + slow) before it's ever written to disk. Two independent layers, and
a network sniffer never sees the real password.

> Note: this `authHash` is used **only** for login verification. It is a
> different derivation from the note-encryption key described below, so that
> the bcrypt hash sitting on the server can never be used to derive the
> encryption key, even if the server's disk were compromised.

---

## 6. Locked notes — client-side encryption flow

This is the "zero-knowledge" part: the server is just dumb storage for ciphertext.

### 6.1 Deriving the encryption key

On the client, from the same password (but a different derivation path than the
auth hash above):

```js
// crypto.js
const encKey = await deriveKey(password, username)
// PBKDF2(password, salt = username, 100_000 iterations, SHA-256) -> AES-256-GCM key
```

This is **deterministic**: the same password + username always regenerates the
exact same key. That's what makes recovery-by-re-entering-password possible
across devices/browsers — and also why losing the password means losing the
key forever (there is no reset path, by design).

The derived key is exported and saved in `localStorage`:
```
localStorage["encKey:<username>"] = base64(rawKeyBytes)
```
It is **never sent to the backend**, in any request, ever.

### 6.2 Writing a locked note

1. User writes a note, toggles "🔒 Lock this note".
2. Browser generates a random IV, encrypts the note text with AES-GCM using
   `encKey` from localStorage.
3. Only `{ciphertext, iv, mood, locked: true}` is POSTed to the server —
   never the plaintext.

### 6.3 Reading locked notes

- As long as `encKey:<username>` is present in `localStorage` (normal case,
  same browser they logged in with), locked timeline entries decrypt
  automatically/instantly when clicked — no repeated password prompts.
- Unlocked (non-locked) notes are always just plain text, fetched normally.

### 6.4 Login-time key check

On successful login:
1. Check `localStorage["encKey:<username>"]`.
2. **If present** → proceed straight to the timeline; locked notes decrypt as
   normal.
3. **If missing** (new browser, cleared storage/cache, different device) →
   show a modal:

   > 🔒 **Unlock your private notes on this device**
   > Enter your password again to unlock notes on this browser.
   >
   > ⚠️ This password is never sent anywhere or stored by the server for this
   > purpose. If you forget it, there is no reset — locked notes will stay
   > encrypted forever and cannot be recovered by anyone, including us.

   Entering it re-derives the same `encKey` (deterministically) and stores it
   in `localStorage` again. No server round-trip needed for this step at all.

### 6.5 Timeline appearance for locked notes

Locked entries show a 🔒 icon and the date/mood only, with content replaced by
"•••" until decrypted — decryption happens instantly client-side using the
local key, so in practice it just looks like "click to expand" like any other
note (no extra prompt) as long as the key is present.

---

## 7. Timeline UI concept

- Vertical line down the left side of the page, one dot per note, grouped by day
  (date header shown once per day, e.g. "Tue, 15 Jul 2026").
- Each dot/card shows: time, mood emoji (color-coded ring around the dot per
  mood), and a one-line preview of the note (or "🔒 Locked note" if locked).
- Click a card → expands smoothly in place (or opens a soft modal) with the
  full note text, mood, and timestamp.
- A floating "+" button (or a top input bar) to write a new note: textarea +
  mood emoji picker + "🔒 Lock" toggle + Post button.
- New note animates into the top of the timeline immediately after posting.
- Soft, warm, "journal" aesthetic — rounded cards, soft shadows, muted pastel
  mood colors, generous whitespace. Not corporate/dashboard-y.

---

## 8. API endpoints

| Method | Path            | Body                                   | Notes |
|--------|-----------------|-----------------------------------------|-------|
| POST   | `/api/signup`    | `{ username, authHash }`               | Only used once to create the friend's account. |
| POST   | `/api/login`     | `{ username, authHash }`               | Sets session cookie. |
| POST   | `/api/logout`    | —                                        | Clears session. |
| GET    | `/api/notes`     | —                                        | Returns all notes for the logged-in user (locked notes include `cipher`, not `content`). |
| POST   | `/api/notes`     | `{ mood, locked, content }` **or** `{ mood, locked: true, cipher }` | Creates a note. |
| DELETE | `/api/notes/:id` | —                                        | Deletes a note (optional/nice-to-have). |

All `/api/notes*` routes require an active session.

---

## 9. Setup & running

**Plain Node:**
```bash
cd timeline-app
npm install
npm run start     # node server.js, serves on e.g. http://localhost:3000
```

**Docker Compose** (optional, if your friend prefers not to install Node at all):
```bash
cd timeline-app
docker compose up -d --build
```
One service only — there's no separate database container, since persistence
is just the `db/db.json` file the app manages itself (section 2). `db/` is
bind-mounted into the container so data survives rebuilds/restarts.

Either way, first run: visit `/signup` once to create an account, then use
`/login` from then on.

---

## 10. Honest caveats

- This is a small, personal-use app — good enough for "keep my friend's private
  server from being able to read the locked stuff," not audited banking-grade
  crypto.
- If exposed beyond `localhost` (e.g. deployed publicly), it should run behind
  HTTPS — the double client/server hashing helps, but TLS is still what
  protects the session cookie and general traffic.
- Losing the password = losing locked notes, permanently and unrecoverably,
  by design (that's the whole point of not letting the server hold the key).
  This will be stated clearly in the UI, not just this doc.

---

## 11. Decisions (finalized)

1. **Signup page**: included — `/signup.html`, separate from `/login.html`, linked to each other.
2. **Moods**: fixed emoji set of 8, each with a mood color used for timeline dot/card accents:
   😊 Happy, 🥰 Loved, 😌 Calm, 😐 Neutral, 😢 Sad, 😰 Anxious, 😡 Angry, 😴 Tired.
   Validated against this whitelist server-side too, not just in the UI.
3. **Delete**: hard delete — a 🗑 button on each timeline card, with a confirm prompt, permanently removes the note from `notes.json`. No trash/soft-delete.

Implementation note: persistence is a small hand-rolled JSON-file store
(`db/db.json` read/written with plain `fs`) rather than the `lowdb` package —
same "flat JSON file, no DB server" idea from section 2, but avoids `lowdb`'s
ESM-only v3+ vs. deprecated-v1 split. One less dependency, same effect.
