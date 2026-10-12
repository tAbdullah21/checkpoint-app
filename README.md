# Checkpoint



## Working features

### Homepage and discovery

- Built-in catalogue of 16 games with local cover images.
- Clickable posters and titles throughout the homepage, profile, and library.
- Title search and genre filtering.
- Individual game pages with description, year, genre, platforms, score, reviews, and related titles.
- New Releases and Popular Games sections.
- Personalized Continue Playing for signed-in users.
- Latest real member reviews on the homepage.
- Responsive layouts with consistent poster proportions.

The catalogue is manually maintained. New Releases uses catalogue order and year data, Popular Games sorts by displayed scores, and related games use a simple genre comparison. These sections are not live store feeds or personalized AI recommendations.

Included catalogue entries: Elden Ring, Cyberpunk 2077, Red Dead Redemption 2, Forza Horizon 5, Baldur's Gate 3, Subnautica, EA Sports FC 27, Kingdom Come: Deliverance II, Clair Obscur: Expedition 33, Monster Hunter Wilds, Split Fiction, DOOM: The Dark Ages, Assassin's Creed Shadows, Battlefield 6, Resident Evil Requiem, and Death Stranding 2: On the Beach. This lists the dataset shipped in this build, rather than independently certifying its release metadata.

### Accounts

- Registration with server-side validation and duplicate-email prevention.
- Password hashing with bcryptjs.
- Login, logout, sessions, and personalized navigation.
- Circular account menu with profile, edit profile, library, and logout actions.
- Login protection for profile/library routes and review changes.
- Custom 404 and error pages.

### Profiles

- Editable display name and bio, with a 280-character bio limit and counter.
- Preferred platform and favorite genres.
- Manually entered Steam ID, PlayStation Network ID, and Xbox Gamertag.
- Independent visibility controls for each gaming ID.
- Only populated IDs marked visible appear, with platform logos; otherwise an empty state appears.
- Email omitted from the profile display and account menu.
- Up to four favorite games, Currently Playing, and library statistics.

The profile route shows the signed-in user's own profile. Public member browsing, uploaded avatars, and official platform account authentication are future work.

### Library

- Add games from the homepage or a game page.
- Want to Play, Playing, Played, and Completed statuses.
- Update status, select favorites, and remove games with a confirmation prompt.
- Save entries in SQLite, with a unique user/game pair preventing duplicates.
- Reflect saved games in the profile and Continue Playing sections.

### Ratings and reviews

- One 1-to-5-star written review per user per game.
- Create, edit, and delete your own review.
- Review validation and character counting.
- Member averages and rating counts update from saved reviews.
- Recent reviews appear on the homepage.
- Action notices, automatic dismissal, and deletion confirmations.

Games without member reviews use seeded preview scores. These are prototype data, not scores fetched from Steam, RAWG, IGDB, or another review service.

## Preview content and future work

| Area | Status |
| --- | --- |
| Accounts, profiles, libraries, search, game pages, ratings, reviews | Implemented |
| Community activity and player-list showcase | Interface preview content |
| Follows, likes, comments, custom user lists | Planned |
| External game API and automatic catalogue updates | Planned |
| Python content-based personalized game matching | Planned |
| Avatar uploads, public profiles, full profile privacy setting | Planned |
| Steam, PSN, Xbox account verification | Planned; current IDs are entered manually |

There is no Python module, game API integration, Jira configuration, or Figma design file in this package.

## Tools: what they do and why we use them

### Application technologies

| Tool | What it does in Checkpoint | Why it was chosen |
| --- | --- | --- |
| [Node.js](https://nodejs.org/en) 24+ | Runs server-side JavaScript, database access, and application checks. | Keeps the main backend in JavaScript and supplies SQLite access without an extra native dependency. |
| [Express](https://expressjs.com/) | Handles routes, forms, static assets, middleware, and errors. | A small, understandable web framework that is suitable for extending the prototype. |
| [EJS](https://ejs.co/) | Renders HTML using user, game, review, and library data. | Dynamic pages without a separate frontend framework or build pipeline. |
| HTML | Defines content, links, forms, and semantic structure. | Standard browser markup that is easy to maintain. |
| CSS and custom stylesheet | Defines colors, spacing, typography, poster ratios, and responsive layouts. | Gives Checkpoint its own design and supports different screen sizes. |
| [Bootstrap](https://getbootstrap.com/docs/5.3/getting-started/introduction/) 5.3.8 | Supplies CSS utilities and JavaScript components through a CDN. | Speeds up reusable responsive UI and components such as dropdowns. |
| Browser JavaScript | Adds character counters, confirmations, notification dismissal, and small interactions. | Provides interaction without a large client framework. |
| [SQLite](https://www.sqlite.org/index.html) | Stores accounts, games, libraries, and reviews in a local file. | SQL and persistence without installing a separate database server. |
| [node:sqlite](https://nodejs.org/api/sqlite.html), DatabaseSync | Connects Node.js to SQLite and executes prepared statements. | Built into the required Node.js runtime. This build does not use better-sqlite3. |
| [bcryptjs](https://github.com/dcodeIO/bcrypt.js) | Hashes passwords and compares hashes at login. | Prevents storing plaintext passwords; hashes are not reversible password recovery. |
| [express-session](https://github.com/expressjs/session) | Stores session data server-side and sends a session identifier cookie. | Straightforward login state across requests. |
| [dotenv](https://github.com/motdotla/dotenv) | Loads local settings from .env into process.env. | Separates configuration and the session secret from source code. |



### Planned supporting tools

| Tool | Intended role | Why it fits |
| --- | --- | --- |
| [Figma](https://www.figma.com/) | Wireframes and UI planning; no file is included here. | Discuss page structure before implementing it. |
| [Python](https://www.python.org/) | Future content-based matching using preferences, ratings, genres, platforms, and gaming history. | Keeps recommendation experiments separate from the main Node.js backend. It is not required now. |
| Game API, such as RAWG or IGDB | Future external game metadata/search. | Could expand the catalogue, but adds provider credentials, limits, and usage requirements. No API key is needed now. |

## How the application works

1. The browser requests a page or submits a form.
2. Express selects a route, checks the session when needed, and validates input.
3. Database functions execute prepared SQL statements against SQLite.
4. EJS renders the page with shared header, footer, and game-card partials.
5. Bootstrap, custom CSS, and browser JavaScript provide styling and interactions.
6. Successful changes can save a session notice displayed on the next page.

The application is server-rendered, with no React frontend or separate API server.

## Requirements and setup

1. Extract the package.
2. In VS Code choose File > Open Folder and open **checkpoint-app**, containing package.json.
3. Choose Terminal > New Terminal and check:

   ```bash
   node -v
   npm -v
   ```

4. Install locked dependencies and create local settings:

   ```bash
   npm ci
   cp .env.example .env
   ```


5. Start:

   ```bash
   npm run dev
   ```

6. Open [http://localhost:3000](http://localhost:3000).

The application creates data/checkpoint.db and seeds the games automatically. No user accounts are included. Keep the terminal running and press Control + C to stop. Later, start with npm run dev again. Use npm start to run without automatic restarting.


## Project structure

| Path | Responsibility |
| --- | --- |
| app.js | Express setup, sessions, homepage, middleware, routes, and errors. |
| routes/auth.js | Registration, login, logout, and validation. |
| routes/games.js | Search/filtering, game pages, and review actions. |
| routes/library.js | Library view, add/update/remove, statuses, and favorites. |
| routes/profile.js | Own-profile view/edit and preferences/ID validation. |
| database/database.js | SQLite connection, tables, migrations, seeds, and data functions. |
| views/*.ejs | Page templates: home, games, game, accounts, profile, library, and errors. |
| views/partials/ | Shared header, footer, and game card. |
| public/css/styles.css | Theme and responsive CSS. |
| public/js/main.js | Browser interactions. |
| public/images/covers/ | Local cover images. |
| public/images/platforms/ | Platform SVG marks. |
| public/images/posters/ | Earlier stylized artwork retained in the project. |
| public/images/checkpoint-mark.svg | Checkpoint brand mark. |
| scripts/smoke-test.js | Automated prototype checks. |
| data/ | Runtime database files, ignored by Git. |
| package.json and package-lock.json | Dependency declarations, scripts, and locked versions. |
| .env.example | Shareable settings template. |
| .gitignore | Excludes secrets, databases, installed dependencies, and generated files. |
| README.md | Features, tools, setup, architecture, and publishing instructions. |

## Database

| Table | Stores | Key rules |
| --- | --- | --- |
| users | Name, email, password hash, bio, gaming IDs, visibility, preferences, timestamps. | Unique case-insensitive email; field length/allowed-value constraints. |
| games | Title, slug, year, genre, seed score, image, description, platforms. | Unique slug. |
| user_library | User/game pair, status, favorite flag, timestamps. | Composite primary key; valid status; foreign keys. |
| reviews | User, game, stars, text, timestamps. | One review per user/game; 1–5 stars; text 3–800 characters; foreign keys. |

Foreign keys use cascading deletion for related library/review records. SQLite uses WAL mode. Migrations add missing columns from earlier versions.

## Routes

| Method | Path | Purpose |
| --- | --- | --- |
| GET | / | Homepage. |
| GET / POST | /register | Show form / create account. |
| GET / POST | /login | Show form / authenticate. |
| POST | /logout | Destroy session. |
| GET | /games | Browse, search, filter. |
| GET | /games/:slug | Game details and reviews. |
| POST | /games/:slug/review | Create/update own review. |
| POST | /games/:slug/review/delete | Delete own review. |
| GET | /library | Own library. |
| POST | /library/:slug/add | Add game with status. |
| POST | /library/:slug/update | Update status/favorite. |
| POST | /library/:slug/remove | Remove saved game. |
| GET | /profile | Own profile. |
| GET / POST | /profile/edit | Show edit form / save profile. |


Demo flow:

1. Register and log in.
2. Open the circular account menu and edit the profile.
3. Add gaming IDs, hide one, and confirm it is absent from the profile.
4. Search for a game and open its page.
5. Add it to Want to Play, then change it to Playing.
6. Submit a rating and review; edit it once.
7. Return home to show the review and Continue Playing.
8. Open the profile/library to show statistics and favorites.
9. Log out and confirm protected pages require login.

Manually inspect desktop, tablet, and phone widths, long titles, poster sizing, dropdowns, forms, and horizontal scrolling. HTTP tests do not establish visual correctness.

