/*
 * Syntax check for every JavaScript file in the project (npm run check).
 * Runs `node --check` on each file so a typo fails fast, before the tests start the server.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const folders = ['database', 'lib', 'routes', 'scripts', 'public/js', 'test'];

function javaScriptFiles(folder) {
  const absolute = path.join(root, folder);
  if (!fs.existsSync(absolute)) return [];
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(folder, entry.name);
    if (entry.isDirectory()) return javaScriptFiles(relative);
    return entry.name.endsWith('.js') ? [relative] : [];
  });
}

const files = ['app.js', ...folders.flatMap(javaScriptFiles)];
let failed = 0;

for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'pipe' });
  } catch (error) {
    failed += 1;
    console.error(`✗ ${file}\n${error.stderr.toString()}`);
  }
}

if (failed > 0) {
  console.error(`${failed} of ${files.length} files have syntax errors.`);
  process.exit(1);
}

console.log(`✓ ${files.length} JavaScript files passed the syntax check.`);
