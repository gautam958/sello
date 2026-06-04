# Sello

Sello is a lightweight online **marketplace with bidding/booking**. Visitors browse a grid
of items, registered users place bids, and admins manage the product catalog (create, edit,
delete, upload images). The backend is a small Express REST API that persists data to flat
JSON files and emails the owner whenever a new bid is placed.

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

- **Marketplace listing** — public grid of enabled items with image, description, price, and
  live bid count (`index.html`).
- **Bidding / booking** — logged-in users place a bid through a modal; the default suggested
  bid is the current highest bid + 1 (or the base price if there are no bids yet).
- **Authentication** — username/password signup and login. Session is kept client-side in
  `sessionStorage`. Two roles: `user` and `admin`.
- **Admin dashboard** — full CRUD for products, image upload, enable/disable visibility, and
  per-item bid history (`admin.html`, admin role required).
- **Email notifications** — every new bid triggers a high-priority email to the owner via
  Nodemailer (Gmail).
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
├── admin.html         # Admin dashboard (product CRUD)
├── items.json         # Seed/persisted product data
├── users.json         # Seed/persisted user accounts
├── Images/            # Uploaded / seed product images
├── package.json       # Dependencies and `npm start` script
└── .github/workflows/ # Azure (API) + GitHub Pages (frontend) deployments
```

> Note: `.gitignore` lists `users.json` and `items.json`, but seed copies are currently
> committed so the app has data on first run. Treat them as seed data, not production state.

## Getting Started

### Prerequisites

- Node.js (the Azure workflow targets Node `24.x`; any modern LTS works locally)
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
> real deployment.**

## Configuration

A few values are currently hard-coded and should be turned into environment variables before
production use:

| Setting                | Location                         | Notes                                         |
| ---------------------- | -------------------------------- | --------------------------------------------- |
| `PORT`                 | `server.js` (`process.env.PORT`) | Defaults to `3000`.                           |
| CORS origin            | `server.js`                      | Locked to `https://gautam958.github.io`.      |
| Gmail user/password    | `server.js` (Nodemailer)         | Placeholder `your-email-address@gmail.com`.   |
| Notification recipient | `server.js`                      | Bid emails are sent to `gautam958@gmail.com`. |
| Hosted API URL         | `script.js` (`API_BASE_URL`)     | Azure URL used when served from GitHub Pages. |

To enable email, replace the Nodemailer `auth` block with a real Gmail address and an
[App Password](https://support.google.com/accounts/answer/185833).

## Data Model

**User** (`users.json`)

```json
{
  "username": "rupa",
  "password": "Abc@123",
  "email": "rupsa958@gmail.com",
  "role": "user",
  "createdAt": "2026-06-03T13:42:25.061Z",
  "lastLogin": "2026-06-03T16:28:43.582Z"
}
```

**Item** (`items.json`)

```json
{
  "id": "1",
  "name": "Vintage Leather Jacket",
  "description": "Genuine brown leather jacket, size L.",
  "price": 120,
  "status": "Available",
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

## API Reference

Base path: `/api`

| Method   | Endpoint               | Auth    | Body                                     | Description                         |
| -------- | ---------------------- | ------- | ---------------------------------------- | ----------------------------------- |
| `POST`   | `/api/signup`          | none    | `{ username, email, password }`          | Register a new `user`.              |
| `POST`   | `/api/login`           | none    | `{ username, password }`                 | Authenticate; returns user (no pw). |
| `GET`    | `/api/items`           | none    | —                                        | List all items.                     |
| `POST`   | `/api/items/book/:id`  | user    | `{ user, bidAmount }`                    | Place a bid; emails the owner.      |
| `POST`   | `/api/admin/items`     | admin\* | `multipart/form-data` (fields + `image`) | Create a product.                   |
| `PUT`    | `/api/admin/items/:id` | admin\* | `multipart/form-data` (fields + `image`) | Update a product.                   |
| `DELETE` | `/api/admin/items/:id` | admin\* | —                                        | Delete a product + its image.       |

\* Admin routes are gated on the **frontend** (`checkAdminAccess` in `script.js`); the API
itself does not currently verify the caller's role (see [Security Notes](#security-notes)).

**Example: place a bid**

```bash
curl -X POST http://localhost:3000/api/items/book/1 \
  -H "Content-Type: application/json" \
  -d '{ "user": "user1", "bidAmount": 130 }'
```

## Frontend Pages

| Page          | Purpose                                                                |
| ------------- | ---------------------------------------------------------------------- |
| `index.html`  | Marketplace grid; opens the bid modal (login required to bid).         |
| `login.html`  | Sign in; admins are redirected to `admin.html`, users to `index.html`. |
| `signup.html` | Register a new account (client-side password confirmation).            |
| `admin.html`  | Product CRUD, image upload, visibility toggle, and bid history.        |

Each page calls `initApp("<page>")`, which wires up the navbar and the page-specific logic in
`script.js`.

## Deployment

Two GitHub Actions workflows trigger on push to `main`:

- **`Azure-Deploy.yml`** — installs dependencies and deploys the Node API to the Azure Web
  App named `sello` using OIDC login.
- **`Github-Pages-Deploy.yml`** — publishes the repository root (static HTML/CSS/JS) to
  GitHub Pages.

When the site is served from GitHub Pages, `script.js` points API calls at the Azure backend
URL; CORS in `server.js` allows the `https://gautam958.github.io` origin.

## Security Notes

This project is a learning/demo app. Before using it for anything real, address:

- **Plaintext passwords** — passwords are stored as-is in `users.json`. Hash them (e.g.
  `bcrypt`) and never return them to the client.
- **No server-side authorization** — admin endpoints are only protected in the UI. Add real
  auth (sessions/JWT) and role checks on the API.
- **Secrets in source** — the Gmail credentials live in `server.js`. Move them to environment
  variables / secrets.
- **Flat-file storage** — concurrent writes to JSON files can race; a real datastore is
  recommended for production.

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
>   description, bid count, current price = highest bid or base price) with a "Book / Place
>   Bid" button. Clicking it (when logged in) opens a modal pre-filled with `highestBid + 1`
>   and submits a bid to `/api/items/book/:id`. Prompt unauthenticated users to log in.
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
