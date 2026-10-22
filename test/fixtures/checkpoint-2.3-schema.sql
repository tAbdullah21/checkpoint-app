-- The schema of a database created by Checkpoint 2.3.0 (copied from sqlite_master), so the tests can check
-- that 2.4 opens and upgrades databases from the previous version. Do not edit: it records what 2.3 shipped.
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL CHECK(length(name) BETWEEN 2 AND 60),
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  , bio TEXT NOT NULL DEFAULT '' CHECK(length(bio) <= 280), steam_id TEXT NOT NULL DEFAULT '' CHECK(length(steam_id) <= 64), psn_id TEXT NOT NULL DEFAULT '' CHECK(length(psn_id) <= 32), xbox_id TEXT NOT NULL DEFAULT '' CHECK(length(xbox_id) <= 32), steam_visible INTEGER NOT NULL DEFAULT 1 CHECK(steam_visible IN (0, 1)), psn_visible INTEGER NOT NULL DEFAULT 1 CHECK(psn_visible IN (0, 1)), xbox_visible INTEGER NOT NULL DEFAULT 1 CHECK(xbox_visible IN (0, 1)), preferred_platform TEXT NOT NULL DEFAULT '' CHECK(preferred_platform IN ('', 'steam', 'playstation', 'xbox')), favorite_genres TEXT NOT NULL DEFAULT '' CHECK(length(favorite_genres) <= 250), profile_public INTEGER NOT NULL DEFAULT 1 CHECK(profile_public IN (0, 1))) STRICT;

CREATE TABLE games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    release_year INTEGER NOT NULL,
    genre TEXT NOT NULL,
    rating REAL NOT NULL,
    image TEXT NOT NULL
  , description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 600), platforms TEXT NOT NULL DEFAULT '' CHECK(length(platforms) <= 100), tags TEXT NOT NULL DEFAULT '' CHECK(length(tags) <= 200)) STRICT;

CREATE TABLE user_library (
    user_id INTEGER NOT NULL,
    game_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'want_to_play'
      CHECK(status IN ('want_to_play', 'playing', 'played', 'completed')),
    is_favorite INTEGER NOT NULL DEFAULT 0 CHECK(is_favorite IN (0, 1)),
    added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, game_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
  ) STRICT;

CREATE TABLE reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    game_id INTEGER NOT NULL,
    rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
    review_text TEXT NOT NULL CHECK(length(review_text) BETWEEN 3 AND 800),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, game_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
  ) STRICT;

CREATE INDEX reviews_game_updated_idx
    ON reviews (game_id, updated_at DESC);

CREATE TABLE follows (
    follower_id INTEGER NOT NULL,
    followed_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (follower_id, followed_id),
    CHECK (follower_id <> followed_id),
    FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (followed_id) REFERENCES users(id) ON DELETE CASCADE
  ) STRICT;

CREATE TABLE review_likes (
    user_id INTEGER NOT NULL,
    review_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, review_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE
  ) STRICT;

CREATE TABLE review_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    review_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 300),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) STRICT;

CREATE TABLE game_lists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL CHECK(length(title) BETWEEN 3 AND 60),
    description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 280),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) STRICT;

CREATE TABLE game_list_items (
    list_id INTEGER NOT NULL,
    game_id INTEGER NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (list_id, game_id),
    FOREIGN KEY (list_id) REFERENCES game_lists(id) ON DELETE CASCADE,
    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
  ) STRICT;

CREATE TABLE activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('library_add', 'status_change', 'review', 'follow', 'list_create', 'list_add')),
    game_id INTEGER,
    target_user_id INTEGER,
    list_id INTEGER,
    detail TEXT NOT NULL DEFAULT '' CHECK(length(detail) <= 40),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
    FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (list_id) REFERENCES game_lists(id) ON DELETE CASCADE
  ) STRICT;

CREATE INDEX activities_created_idx ON activities (created_at DESC, id DESC);

CREATE INDEX activities_user_idx ON activities (user_id, created_at DESC);

CREATE INDEX follows_followed_idx ON follows (followed_id);

CREATE INDEX review_likes_review_idx ON review_likes (review_id);

CREATE INDEX review_comments_review_idx ON review_comments (review_id, created_at);

CREATE INDEX game_lists_user_idx ON game_lists (user_id, updated_at DESC);

CREATE INDEX review_comments_user_idx ON review_comments (user_id);

CREATE INDEX activities_target_idx ON activities (target_user_id) WHERE target_user_id IS NOT NULL;

CREATE INDEX activities_list_idx ON activities (list_id) WHERE list_id IS NOT NULL;

CREATE TABLE notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    actor_id INTEGER NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('follow', 'review_like', 'review_comment')),
    key TEXT NOT NULL CHECK(length(key) <= 40),
    review_id INTEGER,
    comment_id INTEGER,
    read_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, key),
    CHECK (user_id <> actor_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE,
    FOREIGN KEY (comment_id) REFERENCES review_comments(id) ON DELETE CASCADE
  ) STRICT;

CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC, id DESC);

CREATE INDEX notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL;

CREATE INDEX notifications_actor_idx ON notifications (actor_id);

CREATE INDEX notifications_review_idx ON notifications (review_id) WHERE review_id IS NOT NULL;

CREATE INDEX notifications_comment_idx ON notifications (comment_id) WHERE comment_id IS NOT NULL;

CREATE TABLE sessions (
    sid TEXT PRIMARY KEY,
    user_id INTEGER,
    data TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) STRICT;

CREATE INDEX sessions_expiry_idx ON sessions (expires_at);

CREATE INDEX sessions_user_idx ON sessions (user_id) WHERE user_id IS NOT NULL;
