// The layers of docs/ARCHITECTURE.md, checked on the code itself by reading every require() call: models never
// use services or controllers, services never use controllers, controllers never use each other, and the
// services that the module table marks "No" never reach the database, not even through another service. The
// module tables and the counts in the layer diagram must match the folders.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');

const root = path.join(__dirname, '..', '..');
const architecture = fs.readFileSync(path.join(root, 'docs', 'ARCHITECTURE.md'), 'utf8');
const LAYERS = ['database', 'lib', 'routes'];

const modules = LAYERS.flatMap((layer) => fs.readdirSync(path.join(root, layer)).filter((name) => name.endsWith('.js')).sort().map((name) => `${layer}/${name}`));
const layerOf = (file) => file.split('/')[0];

// The project files a module requires, as paths such as "lib/text.js" (packages and node: modules left out).
function localRequires(file) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  return [...source.matchAll(/require\((['"])(\.{1,2}\/[^'"]+)\1\)/g)].map(([, , target]) => {
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), target));
    return /\.(js|json)$/.test(resolved) ? resolved : `${resolved}.js`;
  });
}

const graph = new Map(modules.map((file) => [file, localRequires(file)]));

// Everything a module uses, directly or through other modules.
function reachable(file, seen = new Set()) {
  for (const target of graph.get(file) || []) {
    if (!seen.has(target)) {
      seen.add(target);
      reachable(target, seen);
    }
  }
  return seen;
}

const violations = (from, isWrong) => modules
  .filter((file) => layerOf(file) === from)
  .flatMap((file) => graph.get(file).filter(isWrong).map((target) => `${file} -> ${target}`));

// The rows of the module table under a heading, as { file, columns }.
function moduleTable(heading, folder) {
  const section = architecture.split(heading)[1].split(/^##/m)[0];
  return [...section.matchAll(/^\| `([\w-]+\.js)` \|(.+)\|$/gm)].map(([, name, rest]) => ({
    file: `${folder}/${name}`,
    columns: rest.split('|').map((cell) => cell.trim()),
  }));
}

describe('layers', () => {
  it('reads the requires of every module', () => {
    assert.ok(modules.length >= 40, 'the modules are found');
    assert.ok(graph.get('routes/games.js').includes('database/database.js'), 'and their requires');
  });

  it('keeps the models free of services and controllers', () => {
    assert.deepEqual(violations('database', (target) => layerOf(target) !== 'database'), []);
  });

  it('keeps the services free of controllers', () => {
    assert.deepEqual(violations('lib', (target) => layerOf(target) === 'routes'), []);
  });

  it('keeps the controllers independent of each other', () => {
    assert.deepEqual(violations('routes', (target) => layerOf(target) === 'routes'), []);
  });

  it('lets no module load app.js', () => {
    assert.deepEqual(modules.filter((file) => graph.get(file).includes('app.js')), []);
  });

  it('has no circular requires', () => {
    const cycles = modules.filter((file) => reachable(file).has(file));
    assert.deepEqual(cycles, []);
  });
});

describe('the module tables in ARCHITECTURE.md', () => {
  const services = moduleTable('### Services (`lib/`)', 'lib');

  it('list every model, controller and service, and nothing that is gone', () => {
    for (const [heading, folder] of [['### Models (`database/`)', 'database'], ['### Controllers (`routes/`)', 'routes'], ['### Services (`lib/`)', 'lib']]) {
      const listed = moduleTable(heading, folder).map((row) => row.file).sort();
      assert.deepEqual(listed, modules.filter((file) => layerOf(file) === folder), heading);
    }
  });

  it('are right about which services stay away from the database', () => {
    const wrong = [];
    for (const { file, columns } of services) {
      const touchesDatabase = [...reachable(file)].some((target) => layerOf(target) === 'database');
      if (columns.at(-1) === 'No' && touchesDatabase) wrong.push(`${file} is marked "No" but reaches the database`);
      if (columns.at(-1) !== 'No' && !touchesDatabase) wrong.push(`${file} is marked "${columns.at(-1)}" but never reaches the database`);
    }
    assert.deepEqual(wrong, []);
  });

  it('give the right counts in the layer diagram', () => {
    const count = (folder) => modules.filter((file) => layerOf(file) === folder).length;
    const pure = services.filter((row) => row.columns.at(-1) === 'No').length;
    assert.ok(architecture.includes(`Controllers · routes/<br/>${count('routes')} routers`), `${count('routes')} routers`);
    assert.ok(architecture.includes(`Services · lib/<br/>${count('lib')} modules, ${pure} without database access`), `${count('lib')} services, ${pure} without the database`);
    assert.ok(architecture.includes(`Models · database/<br/>${count('database')} modules, the only code with SQL`), `${count('database')} models`);
  });
});
