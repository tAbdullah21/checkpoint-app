# Checkpoint

A student-built web application for discovering, tracking, rating, and reviewing video games, with a dark interface, green and light-blue accents, local covers, profiles, and personal libraries.

This package contains the **v0.9.0 application**, prepared for a first GitHub upload with expanded documentation. This update changes documentation and ignore rules only.

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

### Development tools

| Tool | What it does | Why we use it |
| --- | --- | --- |
| [npm](https://docs.npmjs.com/) | Installs dependencies and runs package.json scripts. | Standard Node.js dependency and command management. |
| package-lock.json | Records the resolved dependency tree. | Reproducible installation with npm ci; commit this file. |
| [nodemon](https://nodemon.io/) | Restarts the server after development file changes. | Saves manual restarts. |
| Node.js built-in modules and fetch | Provide file/path handling, temporary test files, HTTP requests, and syntax checks. | Avoid extra packages for basic operations. |
| scripts/smoke-test.js | Checks routes, assets, authentication, profiles, libraries, reviews, and migrations. | Detects regressions across the connected application flow. |
| [VS Code](https://code.visualstudio.com/) | Editor, terminal, and Git interface. | Develop, run, and publish from one application on macOS. |
| Browser, such as Brave | Displays the app and supports responsive inspection. | Visual and interaction checks that HTTP tests cannot replace. |
| [Git](https://git-scm.com/) | Records commits, branches, and differences locally. | Change history and recovery of previous work. |
| [GitHub](https://github.com/) | Hosts the repository, issues, and pull requests after publishing. | Shareable source, review, and progress history. |
| [GitHub Projects](https://docs.github.com/en/issues/planning-and-tracking-with-projects) | Optional task board with owners, status, and dates. | Measurable project monitoring without a second task service. |

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

You need Node.js 24+, npm, an editor, and a browser. Git is needed for publishing. You do not need Python, a game API key, a separate SQLite installer, or a database account.

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

5. Generate a random session secret:

   ```bash
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

   Copy the result into .env as the value of SESSION_SECRET. Keep PORT=3000.

6. Start:

   ```bash
   npm run dev
   ```

7. Open [http://localhost:3000](http://localhost:3000).

The application creates data/checkpoint.db and seeds the games automatically. No user accounts are included. Keep the terminal running and press Control + C to stop. Later, start with npm run dev again. Use npm start to run without automatic restarting.

### Keep data from an older build

Stop the old server, back up data/checkpoint.db, and copy it into this project's data folder before starting. If DATABASE_PATH was changed, use that location instead. Automatic schema upgrades preserve existing account and library data. The database is intentionally excluded from GitHub.

### Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| PORT | 3000 | HTTP port. |
| SESSION_SECRET | Development fallback in code | Signs session cookies; set a random secret in .env. |
| DATABASE_PATH | data/checkpoint.db | Optional database path; a relative path resolves from the working directory. |
| NODE_ENV | Unset | production enables secure-only cookies; deployment needs HTTPS and appropriate proxy configuration. |

Commit .env.example with placeholders. Keep .env private.

## Commands

| Command | Purpose |
| --- | --- |
| npm ci | Install exactly from package-lock.json. |
| npm install | Install/update dependencies when intentionally changing package definitions. |
| npm run dev | Development server with nodemon. |
| npm start | Server without automatic restarts. |
| npm run check | JavaScript syntax checks. |
| npm run test:smoke | Automated application checks using a temporary database. |

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

## Testing and demonstration

```bash
npm run check
npm run test:smoke
```

The smoke test starts a local server with an isolated temporary SQLite database and cleans it up afterward. Leave TEST_BASE_URL unset for an ordinary isolated run. Checks cover rendering, assets, validation, duplicate emails, sessions, privacy, preferences, libraries, favorites, reviews, search/filtering, errors, and migrations.

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

## Publish to GitHub from VS Code

Publishing here uploads source code. Running the website online requires a separate Node.js hosting deployment. GitHub Pages cannot execute this Express/SQLite backend.

### 1. Open the correct folder

Extract this package and open checkpoint-app in VS Code. Publish its contents rather than uploading the ZIP.

### 2. Check Git

```bash
git --version
```

If macOS prompts for Command Line Tools, install them. If Git is missing, start the installer:

```bash
xcode-select --install
```

### 3. Set your commit identity

Use your own name and your email, or the exact GitHub no-reply address shown under GitHub Settings > Emails:

```bash
git config --global user.name "YOUR NAME"
git config --global user.email "YOUR EMAIL OR GITHUB NO-REPLY EMAIL"
```

These identify commit authors and do not sign you into GitHub.

### 4. Create your first commit

Run from checkpoint-app:

```bash
git init
git add .
git status
```

The staged files should include source, images, README.md, .gitignore, .env.example, and package-lock.json. They should exclude .env, node_modules, and database files. Check ignore rules:

```bash
git check-ignore .env node_modules/ data/checkpoint.db
```

Then:

```bash
git commit -m "Initial Checkpoint prototype"
git branch -M main
```

### 5. Publish

1. Press Command + Shift + P in VS Code.
2. Run **Publish to GitHub**.
3. Sign in and authorize VS Code if prompted.
4. Name the repository **checkpoint-app**.
5. Choose private or public according to the intended audience.
6. Complete publishing and open the resulting GitHub page.
7. Confirm README.md appears on the repository's main page.

For a private repository, invite intended reviewers from repository Settings > Collaborators. No local accounts or saved games are uploaded.

Official guides:
- [VS Code repositories and remotes](https://code.visualstudio.com/docs/sourcecontrol/repos-remotes)
- [GitHub: adding locally hosted code](https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github)

### Alternative: create an empty GitHub repository and push

After making the first local commit, create an empty repository on GitHub without initializing another README, license, or .gitignore. Replace YOUR_USERNAME:

```bash
git remote add origin https://github.com/YOUR_USERNAME/checkpoint-app.git
git push -u origin main
```

HTTPS terminal authentication needs a supported credential method, such as Git Credential Manager or a personal access token. Your GitHub password is not a Git push credential. VS Code publishing is usually simpler for the first upload.

## Updating GitHub later

After editing and testing:

```bash
git status
git add .
git commit -m "Describe the change"
git push
```

Alternatively stage, commit, and sync from VS Code's Source Control view. Use specific commit messages. Ignore rules do not remove files already committed, so keep secrets and databases out from the first commit.

## Project monitoring

Once configured, GitHub can support the SPMP monitoring process:

- Use issues for tasks, bugs, and change requests.
- Use a Projects board with Todo, In Progress, In Review, and Done.
- Give tasks an owner, due date, priority, and completion criterion.
- Record planned versus completed tasks weekly, with reasons for delay.
- Weekly completion = completed planned tasks / total planned tasks × 100; use N/A when no tasks were planned.
- Escalate tasks more than three days overdue and record reassignment, division, or rescheduling and its reason.
- Record scope/schedule impact and decisions on change requests.
- Review risks weekly, including probability, impact, owner, mitigation, and status.
- Use branches/pull requests and record actual authors/reviewers. If no second reviewer is available, record that limitation.
- Place a matching-quality target such as 70% in the SRS/STS with its dataset, metric, and evaluation method. This build does not implement matching evaluation.

This package does not automatically create a Projects board or enforce review rules.

## Troubleshooting

| Problem | Action |
| --- | --- |
| node/npm not found | Install Node.js 24+ and restart VS Code. |
| Cannot resolve node:sqlite | Upgrade the runtime to Node.js 24+. |
| package.json not found | Open the terminal inside checkpoint-app. |
| Missing dependency | Run npm ci. |
| Port already in use | Stop the old server or change PORT in .env and restart. |
| Old styling visible | Press Command + Shift + R. |
| Missing older account/library | Restore the backed-up database before starting. |
| Dropdown/styling fails offline | Bootstrap uses a CDN; uncached assets need internet. Covers are local. |
| Logged out after server restart | In-memory sessions reset; persistent account/library data remains. |
| Git asks for identity | Set user.name and user.email as above. |
| origin already exists | Inspect git remote -v before changing its URL. |
| README absent on GitHub | Commit README.md at the repository root. |

## Current limitations

This academic prototype is primarily configured for local use. Sessions use express-session's default in-memory store. A public deployment needs persistent sessions, required secret configuration, HTTPS/cookie/proxy configuration, CSRF protection, login rate limiting, backups, and a review of asset rights. Those deployment changes are not included here.

Email verification, password reset, account deletion, admin moderation, avatar uploads, public profile browsing, Python matching, and external game APIs are not implemented. Local covers do not guarantee complete offline operation because Bootstrap loads from a CDN. There is no separate frontend build command.

## Artwork and ownership

Game covers, platform marks, names, and trademarks belong to their respective owners. This package retains assets from the existing academic prototype; inclusion does not grant redistribution rights. Check the relevant requirements before public distribution and replace/remove assets where permission is unavailable.

No open-source code license has been selected. Choose a license intentionally if you want to permit reuse of your own code. A code license does not license third-party artwork.
