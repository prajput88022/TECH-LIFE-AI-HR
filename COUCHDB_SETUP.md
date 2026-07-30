# Setting up CouchDB and creating users to log in

This covers two *different* things people often conflate:

1. **CouchDB itself** — the database server this app stores all its data in.
2. **The app's own login users** — Superadmin, HR, Management. These are documents *inside*
   CouchDB, not CouchDB server accounts. You never log into the Tech-Life AI HR web app with a
   CouchDB admin username/password.

---

## 1. Setting up CouchDB

### Option A — Docker (fastest way to get a real CouchDB running)

```bash
docker run -d --name techlife-couchdb \
  -p 5984:5984 \
  -e COUCHDB_USER=admin \
  -e COUCHDB_PASSWORD=change-this-password \
  couchdb:latest
```

This starts CouchDB with one server admin account (`admin` / `change-this-password`) — this is
CouchDB's own admin, used to manage the database server itself (via Fauxton, CouchDB's built-in
web UI, or the CouchDB HTTP API). It is **not** a Tech-Life AI HR login.

### Option B — Native install (Ubuntu/Debian)

```bash
sudo apt-get update
sudo apt-get install -y couchdb
```

The installer will interactively ask you to set an admin password and choose "standalone" mode
— accept the defaults unless you know you need a cluster.

### Creating the default database

CouchDB doesn't require you to manually create a database — **Tech-Life AI HR creates it
automatically** the first time it connects, using whatever database name you configure (default:
`techlifehr`). You don't need to touch Fauxton or run any `PUT /techlifehr` command yourself.

If you'd rather create it explicitly first (e.g. to set specific permissions), you can:

```bash
curl -X PUT http://admin:change-this-password@localhost:5984/techlifehr
```

Or via Fauxton: open `http://localhost:5984/_utils`, log in with your CouchDB admin credentials,
click **Databases → Create Database**, name it `techlifehr` (or whatever you'll put in
`COUCHDB_DBNAME`), and leave partitioning off.

### Pointing the app at it

Edit your `.env` file (copy from `.env.sample` if you haven't already):

```bash
# Option 1 — one combined URL
COUCHDB_URL=http://admin:change-this-password@localhost:5984/techlifehr

# Option 2 — separate parts (equivalent to the above, avoids putting the password inline)
COUCHDB_HOST=localhost
COUCHDB_PORT=5984
COUCHDB_PROTOCOL=http
COUCHDB_USER=admin
COUCHDB_PASSWORD=change-this-password
COUCHDB_DBNAME=techlifehr
```

Leave **both** blank/unset and the app falls back to an embedded, file-based CouchDB-protocol
store under `./data/couch-local` — useful for a quick local trial, but use a real CouchDB (one of
the two options above) for anything beyond that.

Start the app:

```bash
npm install
npm start
```

Watch the console — it prints which backend it connected to:

```
Data layer: {"backend":"real-couchdb","target":"http://localhost:5984/techlifehr"}
```

(or `"embedded-pouchdb (couchdb protocol)"` if no CouchDB was configured).

---

## 2. Creating users to log in to the *app*

The app has three kinds of logins, created in this order:

### Step 1 — the first Superadmin (automatic, first boot only)

The very first time the server starts against an empty database, it automatically creates one
Superadmin account using these `.env` values (or the built-in defaults if you don't set them):

```bash
SUPERADMIN_EMAIL=superadmin@techlife.ai
SUPERADMIN_PASSWORD=SuperAdmin@123
```

**Change `SUPERADMIN_PASSWORD` in `.env` before your first real deployment** — the default is
only meant for local trial use. This seeding only ever happens once (it checks whether any
Superadmin document already exists first), so changing `.env` after the first boot won't create
a second one — see "changing the Superadmin password later" below if you need that.

Log in at: `http://localhost:4000/superadmin.html`

### Step 2 — create an organization (tenant)

Logged in as Superadmin:

1. Go to **Organizations → + New organization**.
2. Give it a name and a short **organization code** (e.g. `acme`) — this code is what its users
   will type at login, so pick something short and memorable.
3. Choose which features to turn on for it, then **Create organization**.

### Step 3 — create HR / Management users for that organization

Still as Superadmin, from that organization's card, click **Manage features & users**, then
under "Add a user":

1. Enter their **name**, **email**, a **temporary password**, and choose **HR** or
   **Management**.
2. Click **Create user**.
3. Tell that person their **organization code**, **email**, and **temporary password** directly
   — the app does not email credentials automatically.

They log in at `http://localhost:4000/index.html` under the **Organization Login** tab, using the
organization code + their email + password.

### Step 4 — candidates/employees never get a login at all

Candidates and employees don't have passwords or accounts. HR/Management adds them by name +
email/phone, and the app sends them a private, unguessable link (`/invite.html?token=...`) by
email/WhatsApp/call — opening that link *is* their access. There's nothing to "create" for them
beyond adding the candidate record.

---

## Changing the Superadmin password later

Since the seed only runs once, to change the Superadmin's password after that first boot, either:

- **From the UI**: no self-service password-reset screen exists yet (see `RECOMMENDATIONS.md`) —
  for now, the most direct route is updating the `passwordHash` field on that user's document
  directly in CouchDB (via Fauxton or the HTTP API), using a bcrypt hash. From the project folder:
  ```bash
  node -e "console.log(require('bcryptjs').hashSync('YourNewPassword123', 10))"
  ```
  then paste the resulting hash into the Superadmin's `passwordHash` field in Fauxton.
- **Or**, for a fresh environment, just delete the CouchDB database (or the `data/couch-local`
  folder if using the embedded store) and restart — the seed will run again with whatever
  `SUPERADMIN_EMAIL`/`SUPERADMIN_PASSWORD` is currently in `.env`. (This wipes all data — only
  do this on a fresh/dev instance, never in production.)

## Demo data (seeded alongside the first Superadmin)

On that same first boot, a demo organization is also seeded so there's something to explore
immediately:

| Role | Login |
|---|---|
| HR | Organization code `demo` · `hr@demo.com` / `Demo@123` |
| Management | Organization code `demo` · `management@demo.com` / `Demo@123` |

Change or remove these the same way as the Superadmin password once you're past initial
evaluation.
