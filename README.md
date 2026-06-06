# Sello

Sello is a lightweight online **marketplace with bidding/booking**. Visitors browse a grid
of items, registered users place bids, and admins manage the product catalog (create, edit,
delete, upload images, and book items to specific users). The backend is a small Express REST
API that persists data to flat JSON files and sends email notifications on login, bidding, and
booking.

The project is intentionally simple — no database, no build step, no framework on the
frontend — which makes it easy to read, run locally, and deploy as a static site (GitHub
Pages) talking to a Node API (Azure Web App).

---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Configuration](#configuration)
- [Data Model](#data-model)
- [API Reference](#api-reference)
- [Frontend Pages](#frontend-pages)
- [Deployment](#deployment)
- [Security Notes](#security-notes)
- [Detailed Prompt (recreate Sello from scratch)](#detailed-prompt-recreate-sello-from-scratch)

---

## Features

- **Marketplace listing** — public grid of enabled items with image, description, price
  (in **HK$**), live bid count, and an availability status badge (`index.html`).
- **Marketplace filters & randomized order** — a filter bar sits above the item grid with a
  **search** input (matches name + description), a **status** dropdown (All / Available /
  Booked), a **sort** dropdown (Default / Price ↑ / Price ↓ / Most Bids / Name A→Z), and a
  **Reset** button. By default the first item from the server is pinned as a **featured**
  card at the top and the remaining items are shuffled on every page load (Fisher–Yates), so
  items that would otherwise sit at the bottom regularly surface near the top. Choosing any
  explicit sort overrides the random order; Reset restores the featured + shuffled view.
- **Status badge** — each card shows an _Available_ (green) or _Booked_ (red) badge overlaid
  on the item image. Booked items cannot be bid on.
- **Image lightbox** — clicking any item image opens a full-size popup overlay.
- **Bidding / booking** — logged-in users place a bid through a modal; the default suggested
  bid is the current highest bid + 1 (or the base price if there are no bids yet).
- **Authentication** — username/password signup and login, with a **mandatory mobile number**
  on signup. Two roles: `user` and `admin`.
- **Server-side auth & role checks** — login issues an HMAC-SHA256 signed token that the
  frontend stores in `sessionStorage` and sends as `Authorization: Bearer <token>`. Every
  admin route is verified server-side by middleware (`authenticate` + `requireAdmin`), so
  admin access is no longer gated only in the UI.
- **Hashed passwords** — passwords are stored as a salted **`scrypt`** hash (never plaintext);
  legacy plaintext seed users are auto-upgraded on first login and on a one-time startup
  migration.
- **Admin-viewable passwords** — alongside the hash, an **AES-256-GCM** encrypted copy is
  stored so the admin User Management screen can reveal the real password on demand. The
  encryption key lives server-side (env), never in `users.json`.
- **Admin dashboard** — full CRUD for products, image upload, enable/disable visibility,
  per-item bid history, and **status management**: an admin can mark an item _Booked_ and
  must select the user it is booked for (`admin.html`, admin role required).
- **Admin User Management** — a dedicated **Manage Users** page (`users.html`, top-menu link,
  admin only) to create, edit (email/mobile/role/password), and delete users, including a
  password column with a show/hide toggle. The booked-user dropdown identifies users as
  `username | email | mobile`.
- **Visitor analytics** — a dedicated **Visitors** page (`visitors.html`, top-menu link,
  admin only) tracks who visited the site. Every page load pings `POST /api/track` with a
  stable anonymous visitor id stored in `localStorage` (`sello_vid`). The server resolves the
  request IP to **city / country / timezone** via [ipapi.co](https://ipapi.co) (cached 24h
  in-memory to stay under free-tier limits), hashes the IP with SHA-256 for privacy, and
  links the visit to the logged-in username when available. The admin dashboard shows KPI
  cards (Total, New Today, Returning, Active, Countries) and a filterable table with
  location, device/UA, referrer, visited path, first/last seen, and visit count. Records are
  capped at the newest 5,000 in `visitors.json`; admins can clear the log.
- **Activity logging** — a dedicated **Logs** page (`logs.html`, top-menu link, admin only)
  shows an append-only audit trail so the admin can review user behaviour and spot potential
  bugs. The server records `signup`, `login`, `login_failed`, `bid`, `booking`, user changes,
  item changes, **email delivery** (`email_sent` / `email_failed`), and server `error` events
  to `logs.json` (capped at the newest 1000 entries). Every email attempt is logged: successes
  record the recipient, subject, and SMTP response; failures record the recipient, subject, and
  the **exact SMTP error** (e.g. `code: EAUTH | responseCode: 535 | response: ...`) so email
  delivery problems can be diagnosed straight from the Logs page. The page is colour-coded by
  type and supports filtering by type, refreshing, and clearing.
- **Email notifications** (via Nodemailer / Gmail):
  - **Signup** → notifies the owner (`OWNER_EMAIL`) with the new user's username, email, mobile, and role.
  - **Login** → notifies the owner (`OWNER_EMAIL`).
  - **New bid** → high-priority email to the owner **and** a separate confirmation to the bidder.
  - **Booking** → confirmation to the booked user **and** the owner.
- **Scrolling marquee** — a pickup-instructions banner sits directly below the navigation on
  every page.
- **App icon** — an SVG favicon (`favicon.svg`) is linked from every page.
- **Zero-database persistence** — users and items are stored in `users.json` / `items.json`;
  uploaded images are stored on disk.

## Tech Stack

| Layer       | Technology                                                        |
| ----------- | ----------------------------------------------------------------- |
| Backend     | Node.js, [Express 5](https://expressjs.com/)                      |
| File I/O    | `fs-extra`                                                        |
| Uploads     | `multer` (disk storage)                                           |
| Email       | `nodemailer` (Gmail service)                                      |
| CORS        | `cors`                                                            |
| Frontend    | Vanilla HTML, CSS, and JavaScript (no framework, no bundler)      |
| Persistence | Flat JSON files (`users.json`, `items.json`) + local image folder |
| CI/CD       | GitHub Actions → Azure Web App (API) and GitHub Pages (frontend)  |

## Architecture

```
                 ┌──────────────────────────┐
  Browser ─────▶ │  Static frontend          │   index / login / signup / admin
                 │  HTML + style.css         │   + script.js (fetch calls)
                 └────────────┬─────────────┘
                              │  fetch(API_BASE_URL + ...)
                              ▼
                 ┌──────────────────────────┐
                 │  Express API (server.js)  │   PORT 3000
                 │   /api/*  endpoints        │
                 └───┬───────────┬──────┬────┘
                     │           │      │
            users.json     items.json  images/   (flat-file persistence + uploads)
                                          │
                                          ▼
                                   Nodemailer (Gmail) — bid notification email
```

The frontend chooses its API base automatically (see `script.js`):

- When served from `https://gautam958.github.io` → it calls the hosted Azure API.
- Otherwise (e.g. local dev where Express serves the static files) → it calls the relative
  `/api` path.

## Project Structure

```
sello/
├── server.js          # Express REST API (auth, items, bidding, admin CRUD, email)
├── script.js          # Frontend logic: rendering, fetch calls, auth, admin dashboard
├── style.css          # Design system / styling
├── index.html         # Marketplace (item grid + bid modal)
├── login.html         # Login page
├── signup.html        # Registration page
├── admin.html         # Admin dashboard (product CRUD + status/booking)
├── users.html         # Admin User Management page (CRUD + viewable passwords)
├── logs.html          # Admin Activity Logs page (audit trail viewer)
├── visitors.html      # Admin Visitor Analytics page (geo + KPI dashboard)
├── favicon.svg        # App icon (sell / price-tag), linked from every page
├── items.json         # Seed/persisted product data
├── users.json         # Seed/persisted user accounts
├── logs.json          # Append-only activity log (auto-created, capped at 1000)
├── visitors.json      # Visitor records (auto-created, capped at 5000)
├── Images/            # Uploaded / seed product images
├── package.json       # Dependencies and `npm start` script
└── .github/workflows/ # Azure (API) + GitHub Pages (frontend) deployments
```

> Note: `.gitignore` lists `users.json` and `items.json`, but seed copies are currently
> committed so the app has data on first run. Treat them as seed data, not production state.

## Getting Started

### Prerequisites

- Node.js **18+** required (the visitor geo lookup uses the global `fetch` API). The Azure
  workflow targets Node `24.x`; any modern LTS works locally.
- npm

### Install & run

```bash
npm install
npm start
```

`npm start` runs `node server.js`, which listens on `http://localhost:3000`.

Because the server serves API routes (not the HTML pages), the simplest local workflow is to
open the HTML files directly or serve the folder statically. With the API running on
port 3000, `script.js` falls back to the relative `/api` base, so serving the static files
from the **same origin** as the API is recommended. A quick option:

```bash
# terminal 1 — API
npm start

# terminal 2 — static files on the same host (example)
npx serve .        # then open the printed URL
```

### Default accounts (seed data)

| Username | Password           | Role  |
| -------- | ------------------ | ----- |
| `admin`  | `adminpassword123` | admin |
| `user1`  | `userpassword123`  | user  |

> These are seed credentials for local development only. **Change or remove them before any
> real deployment.** On first start with the current `server.js`, these plaintext seed
> passwords are automatically migrated to a `scrypt` hash + AES-encrypted copy — the
> credentials above keep working and remain viewable on the admin Manage Users page.

## Configuration

A few values are currently hard-coded and should be turned into environment variables before
production use:

Email is configured through **environment variables** (with safe placeholder defaults so the
app still boots without real credentials — emails are simply logged on failure):

| Setting                 | Env var            | Default                        | Notes                                                                                             |
| ----------------------- | ------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------- |
| Gmail account           | `EMAIL_USER`       | `your-email-address@gmail.com` | Gmail address used as the sender.                                                                 |
| Gmail app password      | `EMAIL_PASS`       | `your-app-password`            | Gmail [App Password](https://support.google.com/accounts/answer/185833), not your login password. |
| Notification recipient  | `OWNER_EMAIL`      | `gautam958@gmail.com`          | Receives login / bid / booking notifications.                                                     |
| Auth token secret       | `AUTH_SECRET`      | `sello-dev-secret-change-me`   | Signs/verifies login tokens (HMAC-SHA256). Set a strong value in production.                      |
| Password encryption key | `PASSWORD_ENC_KEY` | falls back to `AUTH_SECRET`    | Key for the AES-256-GCM reversible password copy used by the admin screen.                        |
| Server port             | `PORT`             | `3000`                         | `server.js` (`process.env.PORT`).                                                                 |

Other values still hard-coded:

| Setting        | Location                     | Notes                                         |
| -------------- | ---------------------------- | --------------------------------------------- |
| CORS origin    | `server.js`                  | Locked to `https://gautam958.github.io`.      |
| Hosted API URL | `script.js` (`API_BASE_URL`) | Azure URL used when served from GitHub Pages. |

To enable real email delivery, start the server with the credentials set, e.g.:

```bash
EMAIL_USER=you@gmail.com EMAIL_PASS="your app password" OWNER_EMAIL=you@gmail.com npm start
```

## Data Model

**User** (`users.json`)

```json
{
  "username": "rupa",
  "password": "scrypt$<salt>$<hash>",
  "passwordEnc": "enc$<iv>$<tag>$<ciphertext>",
  "email": "rupsa958@gmail.com",
  "mobile": "+852 9123 4567",
  "role": "user",
  "createdAt": "2026-06-03T13:42:25.061Z",
  "lastLogin": "2026-06-03T16:28:43.582Z"
}
```

`mobile` is required at signup. `password` holds a salted `scrypt` hash (used to verify
logins); `passwordEnc` holds an AES-256-GCM encrypted copy of the real password so the admin
screen can display it. **Plaintext passwords are never stored**, and `passwordEnc` cannot be
decrypted without the server-side key.

**Item** (`items.json`)

```json
{
  "id": "1",
  "name": "Vintage Leather Jacket",
  "description": "Genuine brown leather jacket, size L.",
  "price": 120,
  "status": "Available",
  "bookedUser": "",
  "image": "/images/jacket.jpg",
  "enabled": true,
  "bids": [
    {
      "userId": "rupa",
      "bidAmount": 100,
      "timestamp": "2026-06-03T13:55:31.082Z"
    }
  ],
  "highestBid": 100
}
```

`status` is `"Available"` or `"Booked"`; when `Booked`, `bookedUser` holds the username the
item is reserved for (prices are displayed to users in **HK$**).

## API Reference

Base path: `/api`

| Method   | Endpoint                     | Auth  | Body                                                             | Description                                                                                            |
| -------- | ---------------------------- | ----- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `POST`   | `/api/signup`                | none  | `{ username, email, password, mobile }`                          | Register a new `user` (mobile required; password hashed + encrypted); emails the owner.                |
| `POST`   | `/api/login`                 | none  | `{ username, password }`                                         | Authenticate; returns user (no pw) **and a signed `token`**; emails the owner.                         |
| `GET`    | `/api/items`                 | none  | —                                                                | List **enabled** items with display fields only (`bidsCount`, `highestBid`; no `bids[]`/`bookedUser`). |
| `POST`   | `/api/items/book/:id`        | user  | `{ user, bidAmount }`                                            | Place a bid; emails the owner and the bidder.                                                          |
| `GET`    | `/api/admin/users`           | admin | —                                                                | List all users incl. recovered plaintext password (for the admin screen).                              |
| `POST`   | `/api/admin/users`           | admin | `{ username, email, mobile, role, password }`                    | Create a user (password hashed + encrypted).                                                           |
| `PUT`    | `/api/admin/users/:username` | admin | `{ email?, mobile?, role?, password? }`                          | Update a user; re-hashes/encrypts when a new password is given.                                        |
| `DELETE` | `/api/admin/users/:username` | admin | —                                                                | Delete a user (cannot delete your own account).                                                        |
| `POST`   | `/api/admin/items`           | admin | `multipart/form-data` (fields + `image`, `status`, `bookedUser`) | Create a product; emails on booking.                                                                   |
| `PUT`    | `/api/admin/items/:id`       | admin | `multipart/form-data` (fields + `image`, `status`, `bookedUser`) | Update a product; emails when newly booked.                                                            |
| `DELETE` | `/api/admin/items/:id`       | admin | —                                                                | Delete a product + its image.                                                                          |
| `GET`    | `/api/admin/logs`            | admin | `?type=&limit=` (query, optional)                                | List activity logs newest-first; optional filter by `type` and cap by `limit`.                         |
| `DELETE` | `/api/admin/logs`            | admin | —                                                                | Clear all activity logs.                                                                               |
| `POST`   | `/api/track`                 | none  | `{ visitorId, path, referrer }`                                  | Record a visit; server adds hashed IP, geo (city/country), UA, and links to logged-in user if any.     |
| `GET`    | `/api/admin/visitors`        | admin | —                                                                | List visitor records newest-first with location, device, path history, and visit counts.               |
| `DELETE` | `/api/admin/visitors`        | admin | —                                                                | Clear all visitor records.                                                                             |

Admin routes (`admin` in the table) are verified **server-side**: the request must carry a
valid `Authorization: Bearer <token>` whose payload has `role === "admin"`. Missing/invalid
tokens get `401`; non-admins get `403`. The frontend obtains the token from `/api/login` and
sends it on every admin call.

**Example: place a bid**

```bash
curl -X POST http://localhost:3000/api/items/book/1 \
  -H "Content-Type: application/json" \
  -d '{ "user": "user1", "bidAmount": 130 }'
```

## Frontend Pages

| Page            | Purpose                                                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `index.html`    | Marketplace grid with filter bar (search, status, sort, reset); first item featured, rest shuffled; opens the bid modal (login required to bid). |
| `login.html`    | Sign in; admins are redirected to `admin.html`, users to `index.html`.                                                                           |
| `signup.html`   | Register a new account (mobile number + client-side password confirmation).                                                                      |
| `admin.html`    | Product CRUD, image upload, visibility toggle, bid history, and status/booking.                                                                  |
| `users.html`    | **Manage Users** (admin only): create/edit/delete users + viewable passwords (show/hide).                                                        |
| `logs.html`     | **Logs** (admin only): activity audit trail with type filter, refresh, and clear.                                                                |
| `visitors.html` | **Visitors** (admin only): visitor analytics with KPI cards, geo, and device breakdown.                                                          |

Each page calls `initApp("<page>")`, which wires up the navbar and the page-specific logic in
`script.js`. The **Manage Users**, **Logs**, and **Visitors** links appear in the top menu
only for admins. Every public page also fires a one-shot `trackVisit()` ping so the Visitors
dashboard stays up to date.

## Deployment

Two GitHub Actions workflows trigger on push to `main`:

- **`Azure-Deploy.yml`** — installs dependencies and deploys the Node API to the Azure Web
  App named `sello` using OIDC login.
- **`Github-Pages-Deploy.yml`** — publishes the repository root (static HTML/CSS/JS) to
  GitHub Pages.

When the site is served from GitHub Pages, `script.js` points API calls at the Azure backend
URL; CORS in `server.js` allows the `https://gautam958.github.io` origin.

## Security Notes

This project is a learning/demo app. The following hardening is now in place (no database):

- **Hashed passwords** — passwords are stored as a salted `scrypt` hash, never plaintext.
  Legacy plaintext seed users are migrated automatically. Logins are verified with a
  constant-time comparison.
- **Reversible admin-viewable copy** — an AES-256-GCM encrypted copy (`passwordEnc`) lets the
  admin screen show the real password. The key lives only on the server
  (`PASSWORD_ENC_KEY` / `AUTH_SECRET`), so a leaked `users.json` cannot be decrypted.
  Note: storing recoverable passwords is intentionally less secure than hash-only — it exists
  because admin visibility was an explicit product requirement.
- **Server-side authorization** — admin endpoints require a valid signed token with an
  `admin` role; they are no longer protected only in the UI.
- **Minimal data exposure** — the public `/api/items` returns only enabled items with display
  fields (no `bids[]`, no `bookedUser`); the old public `/api/users` endpoint was removed in
  favor of admin-only `/api/admin/users`.
- **Secrets via env** — Gmail credentials (`EMAIL_USER`/`EMAIL_PASS`), the token secret
  (`AUTH_SECRET`), and the password key (`PASSWORD_ENC_KEY`) are read from environment
  variables. Supply strong values in production; the built-in defaults are for local dev only.

Still worth doing before real production use:

- **Flat-file storage** — concurrent writes to JSON files can race; a real datastore is
  recommended.
- **Token storage** — tokens live in `sessionStorage`; consider httpOnly cookies to reduce
  XSS exposure.
- **Reconsider password recovery** — for maximum security, prefer admin password _reset_
  (set a new one) over _view_, which avoids storing any recoverable form.

## Detailed Prompt (recreate Sello from scratch)

The following is a complete, self-contained prompt you can give to an AI coding assistant (or
use as a build spec) to reconstruct this application:

> Build a small online marketplace web app called **Sello** with a bidding/auction feature.
> Use **Node.js + Express** for the backend and **plain HTML, CSS, and vanilla JavaScript**
> for the frontend — no frontend framework and no build step. Persist all data in flat JSON
> files (no database).
>
> **Backend (`server.js`, Express, port from `process.env.PORT` or 3000):**
>
> - Use `express.json()`, `cors` (allow origin `https://gautam958.github.io`, methods
>   GET/POST/PUT/DELETE, credentials), `fs-extra` for file I/O, `multer` (disk storage) for
>   image uploads into an `images/` folder served statically at `/images`, and `nodemailer`
>   (Gmail service) for email.
> - Persist users in `users.json` and items in `items.json`. Add helper `readData`/`writeData`
>   functions that read/write JSON.
> - Endpoints:
>   - `POST /api/signup` — body `{ username, email, password }`; reject duplicate usernames;
>     store new user with `role: "user"` and `createdAt`.
>   - `POST /api/login` — body `{ username, password }`; on success set `lastLogin`, return the
>     user object **without** the password.
>   - `GET /api/items` — return all items.
>   - `POST /api/items/book/:id` — body `{ user, bidAmount }`; reject negative bids; append a
>     bid `{ userId, bidAmount, timestamp }` to the item's `bids` array; update `highestBid`;
>     send a high-priority notification email to the owner with the item and bid details.
>   - `POST /api/admin/items` — `multipart/form-data` with `name, description, price, enabled`
>     and optional `image`; create an item with a unique id (`Date.now()`), `status:
"Available"`, empty `bids`, `highestBid: 0`, and the uploaded filename (or `default.jpg`).
>   - `PUT /api/admin/items/:id` — update fields; if a new image is uploaded, delete the old
>     file and store the new filename.
>   - `DELETE /api/admin/items/:id` — remove the item and its image file.
>   - `GET /` — simple status text.
>
> **Frontend (`index.html`, `login.html`, `signup.html`, `admin.html`, `script.js`,
> `style.css`):**
>
> - Keep auth state in `sessionStorage` under key `sello_user`. Build a dynamic navbar that
>   shows Login/Register when logged out and a Welcome message + Logout (plus an Admin link for
>   admins) when logged in.
> - Define `API_BASE_URL` that points to a hosted backend when served from
>   `https://gautam958.github.io`, otherwise the relative `/api`.
> - `index.html`: fetch `/api/items`, render only `enabled` items as cards (image, name,
>   description, bid count, and the **fixed base price** — bids do not overwrite the displayed
>   price; only the admin can change it) with a "Book / Place Bid" button. Clicking it (when
>   logged in) opens a modal pre-filled with `highestBid + 1` and submits a bid to
>   `/api/items/book/:id`. Prompt unauthenticated users to log in.
>   - `login.html` / `signup.html`: forms that POST to `/api/login` and `/api/signup`; signup
>     confirms the password client-side; after login redirect admins to `admin.html`.
> - `admin.html`: guard with an admin-role check (redirect non-admins). Provide a create/update
>   form (with image upload and an "enabled" checkbox) that POSTs/PUTs `multipart/form-data`,
>   and an inventory table listing every item with image, fields, highest bid, visibility, bid
>   history, and Edit/Delete buttons.
> - Style everything with a clean, modern design system in `style.css` (CSS variables for
>   colors, spacing, shadows; card grid; modal; responsive forms).
>
> **Deployment:** add GitHub Actions workflows to deploy the API to an Azure Web App and the
> static frontend to GitHub Pages on push to `main`. Include `package.json` with an
> `npm start` script (`node server.js`) and dependencies: `express`, `cors`, `fs-extra`,
> `multer`, `nodemailer`. Seed `users.json` with an `admin` and a `user1` account and
> `items.json` with a couple of sample products.
>
> **Security & user-management additions (no database, Node built-in `crypto` only):**
>
> - On signup require a mandatory `mobile` field. Hash passwords with `crypto.scrypt`
>   (random salt, format `scrypt$<salt>$<hash>`) and also store an AES-256-GCM encrypted copy
>   `passwordEnc` (format `enc$<iv>$<tag>$<ciphertext>`) so an admin screen can display the
>   real password. Derive the encryption key from `PASSWORD_ENC_KEY` (falling back to
>   `AUTH_SECRET`) — never store it in `users.json`. Verify logins with `crypto.timingSafeEqual`.
> - On `POST /api/login`, after verifying credentials, issue a signed token
>   (base64url JSON payload + HMAC-SHA256 signature using `AUTH_SECRET`, ~7-day expiry) and
>   return it alongside the user. Auto-upgrade any legacy plaintext password to hash+encrypted
>   on login, and run a one-time migration over `users.json` at startup.
> - Add `authenticate` middleware (verifies the `Authorization: Bearer <token>`) and
>   `requireAdmin` (also checks `role === "admin"`). Protect all `/api/admin/*` routes with it.
> - Make `/api/items` return only `enabled` items with display fields (`bidsCount`,
>   `highestBid`) — never the full `bids[]` or `bookedUser`. Remove any public `/api/users`
>   endpoint; instead add admin-only user CRUD: `GET/POST /api/admin/users`,
>   `PUT/DELETE /api/admin/users/:username` (GET returns each user's recovered password; DELETE
>   forbids deleting your own account).
> - Frontend: store the token in `sessionStorage` (`sello_token`) on login and send it via an
>   `Authorization: Bearer` header on every admin call. Add a dedicated **`users.html`**
>   Manage Users page (top-menu link shown only to admins) with a create form and a table
>   (username, email, mobile, password with show/hide toggle, role, created, last login,
>   edit/delete). In the admin booking dropdown, label users as `username | email | mobile`.
