// Data layer backed by CouchDB.
//
// This uses PouchDB, which speaks the CouchDB replication protocol natively:
//   - If COUCHDB_URL is set (e.g. http://admin:password@localhost:5984/techlifehr,
//     or a hosted CouchDB/Cloudant URL), every document is read from / written
//     directly to that real CouchDB database over HTTP.
//   - If COUCHDB_URL is NOT set, PouchDB stores documents locally on disk in
//     CouchDB's own document format (so the app runs with zero external
//     services for local dev/demo) and can be replicated into a real CouchDB
//     cluster at any time with a single `db.couch.replicate.to(remoteCouchDB)` call.
//
// All records are documents with a `type` field (tenant, tenantFeature, user,
// candidate, formSubmission, notification, activityLog, interviewSession,
// interviewTranscript, integrationConfig ...). A Mango index on `type` gives
// us fast "table-like" queries without needing CouchDB design-doc views.

const fs = require("fs");
const path = require("path");
const PouchDB = require("pouchdb");
PouchDB.plugin(require("pouchdb-find"));

function resolveCouchUrl() {
  if (process.env.COUCHDB_URL) return process.env.COUCHDB_URL;
  const host = process.env.COUCHDB_HOST;
  if (!host) return null; // no real CouchDB configured -> fall back to embedded store
  const protocol = process.env.COUCHDB_PROTOCOL || "http";
  const port = process.env.COUCHDB_PORT || "5984";
  const dbName = process.env.COUCHDB_DBNAME || "techlifehr";
  const user = process.env.COUCHDB_USER;
  const password = process.env.COUCHDB_PASSWORD;
  const auth = user ? `${encodeURIComponent(user)}:${encodeURIComponent(password || "")}@` : "";
  return `${protocol}://${auth}${host}:${port}/${dbName}`;
}

const COUCHDB_URL = resolveCouchUrl();
const LOCAL_PATH = path.join(__dirname, "..", "data", "couch-local");
if (!COUCHDB_URL) fs.mkdirSync(LOCAL_PATH, { recursive: true });

const couch = COUCHDB_URL
  ? new PouchDB(COUCHDB_URL)
  : new PouchDB(LOCAL_PATH);

function genId(type) {
  return `${type}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
}

function toPublic(doc) {
  if (!doc) return null;
  const { _id, _rev, ...rest } = doc;
  return { id: _id, _rev, ...rest };
}

async function insert(type, record) {
  const _id = genId(type);
  const doc = { _id, type, ...record };
  const res = await couch.put(doc);
  return toPublic({ ...doc, _rev: res.rev });
}

// Note: we deliberately scan allDocs + filter in JS rather than using
// pouchdb-find's mango index. At this project's scale that's simpler and more
// predictable than chasing mango-index build races; swap to `couch.find()`
// with a persisted index once a real CouchDB with proper views is in place.
async function all(type, predicate) {
  const result = await couch.allDocs({ include_docs: true });
  let docs = result.rows
    .map((r) => r.doc)
    .filter((d) => d && !d._id.startsWith("_design/") && d.type === type)
    .map(toPublic);
  if (predicate) docs = docs.filter(predicate);
  return docs;
}

async function find(type, predicate) {
  const docs = await all(type, predicate);
  return docs[0] || null;
}

async function getById(id) {
  try {
    const doc = await couch.get(id);
    return toPublic(doc);
  } catch (e) {
    return null;
  }
}

async function update(type, id, patch) {
  const existing = await couch.get(id);
  const updated = { ...existing, ...patch, type: existing.type };
  const res = await couch.put(updated);
  return toPublic({ ...updated, _rev: res.rev });
}

async function remove(id) {
  try {
    const existing = await couch.get(id);
    await couch.remove(existing);
    return true;
  } catch (e) {
    return false;
  }
}

async function reset() {
  const everything = await couch.allDocs({ include_docs: true });
  await Promise.all(everything.rows.filter((r) => !r.id.startsWith("_design/")).map((r) => couch.remove(r.doc)));
}

// ---- Attachments (used for resume file storage on candidate documents) ----
async function putAttachment(docId, attachmentId, buffer, contentType) {
  const doc = await couch.get(docId);
  const res = await couch.putAttachment(docId, attachmentId, doc._rev, buffer, contentType);
  return res;
}

async function getAttachment(docId, attachmentId) {
  return couch.getAttachment(docId, attachmentId);
}

function info() {
  return { backend: COUCHDB_URL ? "remote-couchdb" : "embedded-pouchdb (couchdb protocol)", target: COUCHDB_URL || LOCAL_PATH };
}

module.exports = { insert, all, find, getById, update, remove, reset, info, couch, putAttachment, getAttachment };
