# Team App - Role-Based Dashboard Skeleton

## What was fixed from the uploaded files
1. `middleware/auth.js` created - `checkAuthenticated`, `checkAdmin`,
   `checkTeacher`, `checkStudent` were referenced in `app.js` but never
   defined, which crashed every protected route.
2. DB credentials moved out of `app.js` into `.env` (see `.env.example`).
   **Rotate the Azure MySQL password** - it was previously hardcoded in
   plaintext in a file that may end up in your GitHub repo.
3. `register.ejs` now has a role selector (`student`/`teacher`) - it was
   missing entirely, so every registration inserted a `NULL` role.
4. `register.ejs`'s name input used `name="fullname"` but `app.js` reads
   `req.body.username` - fixed the mismatch so the name actually saves.
5. `/teacher` route + `teacher.ejs` added - was completely missing even
   though two team members (Jereil, Hein) are assigned to Teacher features.
6. Login now redirects by role (`/admin`, `/teacher`, `/student`) instead
   of sending everyone to one shared `/dashboard` view.

## File structure
```
team-app/
├── app.js
├── middleware/auth.js
├── views/
│   ├── index.ejs
│   ├── login.ejs
│   ├── register.ejs
│   ├── admin.ejs
│   ├── teacher.ejs
│   └── student.ejs
├── seed_demo_users.sql
├── .env.example
└── package.json
```

## Setup
```bash
npm install
cp .env.example .env   # then fill in your real (rotated) DB password
```
Run `seed_demo_users.sql` against your database, then:
```bash
npm start
```

## Demo credentials
| Role | Email | Password |
|---|---|---|
| Admin | admin@test.com | password123 |
| Teacher | teacher@test.com | password123 |
| Student | student@test.com | password123 |

## Known remaining issue - not fixed here
Passwords are hashed with `SHA1()`, which is cryptographically broken
(collision attacks are practical). It's left as-is here because changing
it means changing both the register and login queries together and
re-hashing any existing users - a deliberate team decision, not
something to silently swap out. If you want, ask and I'll do that
migration too.
