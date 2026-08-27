-- league-ify storage on D1.
--
-- Two tables, because the shape of the data demanded it rather than because a
-- document store wanted normalising:
--
--   documents  seasons, goals, settings, notifications, profile, meta  (~26 KB)
--   matches    one row per ranked game                        (~1.7 KB each)
--
-- The live database measured 673 KB compact, and 647 KB of that (96.1%, over
-- 374 matches) was the matches array. Keeping it as one blob would push a
-- single stored value toward D1's value-size ceiling and grow by another
-- 1.7 KB every game. Splitting also means logging a match writes one row
-- instead of rewriting two thirds of a megabyte.
--
-- Everything else is deliberately NOT shredded. shared/types.ts is 1439 lines
-- and store.ts has 50 methods that treat the database as one in-memory object;
-- turning Season, Goal, Tuning and the rest into tables would be a rewrite of
-- the whole application for no gain at this stage. If a query ever needs an
-- index into that data, project it into a side table — do not dismantle the
-- document.
--
-- Applied against the site's existing `dhole-workshop` D1 database, which
-- already holds admin_users / admin_sessions. league-ify reuses that auth
-- rather than inventing a second login.
--
--   npx wrangler d1 execute dhole-workshop --local --file=migrations/0001_league_ify.sql
--   npx wrangler d1 execute dhole-workshop --remote --file=migrations/0001_league_ify.sql

CREATE TABLE IF NOT EXISTS documents (
  doc_key    TEXT PRIMARY KEY,
  body       TEXT    NOT NULL,
  updated_at INTEGER NOT NULL,

  -- Matches the DocKey union in server/storage/contract.ts. A typo in a key
  -- would otherwise create a second, silently empty database.
  CHECK (
    doc_key IN ('live', 'demo', 'profile', 'meta')
    OR doc_key LIKE 'profiles/%'
  ),
  CHECK (length(body) > 0)
);

CREATE TABLE IF NOT EXISTS matches (
  doc_key    TEXT    NOT NULL,
  match_id   TEXT    NOT NULL,
  -- Position in the document's matches array. The engine is handed that array
  -- as-is, so its order is meaningful and has to survive the round trip.
  -- Storing it explicitly rather than leaning on rowid: rowid ordering is an
  -- implementation detail, it does not survive a re-insert, and SQLite will
  -- not let you put rowid in an index anyway.
  ord        INTEGER NOT NULL,
  body       TEXT    NOT NULL,
  updated_at INTEGER NOT NULL,

  PRIMARY KEY (doc_key, match_id),
  CHECK (length(body) > 0)
);

-- Hydration reads every match for one document, in array order. This is the
-- only access path the adapter uses today.
CREATE INDEX IF NOT EXISTS idx_matches_doc ON matches (doc_key, ord);

-- Timestamps are unix SECONDS, matching the site's existing schema and
-- lib/db.js nowSeconds(). Storing milliseconds here is how "synced 2 minutes
-- ago" becomes "synced in 55 years".
