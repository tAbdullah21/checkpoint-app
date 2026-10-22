// Documentation checks: the Markdown files may only name files, headings, npm scripts and test suites that
// exist, every setting the code reads is documented, and every functional requirement is traced to its tests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');

const root = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const docs = ['README.md', 'CHANGELOG.md', ...fs.readdirSync(path.join(root, 'docs')).filter((name) => name.endsWith('.md')).sort().map((name) => `docs/${name}`)];

// Every file in the project, apart from installed packages and local data.
function projectFiles(directory = '') {
  return fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) return ['node_modules', 'data', 'coverage', '.git'].includes(entry.name) ? [] : projectFiles(relative);
    return [relative];
  });
}

// Fenced code blocks hold commands and examples, not references.
function prose(markdown) {
  return markdown.replace(/^```[^\n]*\n[\s\S]*?^```/gm, '');
}

// The anchors GitHub gives headings: the text in lower case without punctuation, spaces turned into hyphens,
// and -1, -2 … after repeated headings.
function headingAnchors(markdown) {
  const anchors = new Set();
  const seen = new Map();
  for (const [, heading] of prose(markdown).matchAll(/^#{1,6}\s+(.+?)\s*$/gm)) {
    const text = heading.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[[\]`*]/g, '').replace(/<[^>]+>/g, '');
    const anchor = text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replace(/ /g, '-');
    const repeats = seen.get(anchor);
    seen.set(anchor, repeats === undefined ? 0 : repeats + 1);
    anchors.add(repeats === undefined ? anchor : `${anchor}-${repeats + 1}`);
  }
  return anchors;
}

// Links to other files of the project: inline links and reference definitions, without web addresses.
function relativeLinks(markdown) {
  const text = prose(markdown).replace(/`[^`\n]*`/g, '');
  const inline = [...text.matchAll(/\]\(([^)\s]+)\)/g)].map((match) => match[1]);
  const references = [...text.matchAll(/^\[[^\]]+\]:\s*(\S+)/gm)].map((match) => match[1]);
  return [...inline, ...references].filter((target) => !/^[a-z][a-z+.-]*:/i.test(target));
}

// The traceability matrix: one row per functional requirement.
function traceabilityRows() {
  const section = read('docs/REQUIREMENTS.md').split(/^## \d+\. Traceability matrix$/m)[1].split(/^## /m)[0];
  return section.split('\n').filter((line) => /^\| FR-\d+/.test(line));
}

describe('documentation links', () => {
  it('point to files that exist', () => {
    const broken = [];
    for (const file of docs) {
      for (const link of relativeLinks(read(file))) {
        const target = link.split('#')[0];
        if (target && !fs.existsSync(path.join(root, path.dirname(file), target))) broken.push(`${file}: ${link}`);
      }
    }
    assert.deepEqual(broken, []);
  });

  it('point to headings that exist', () => {
    const broken = [];
    for (const file of docs) {
      for (const link of relativeLinks(read(file)).filter((target) => target.includes('#'))) {
        const [target, anchor] = link.split('#');
        const linked = target ? path.posix.join(path.posix.dirname(file), target) : file;
        if (linked.endsWith('.md') && fs.existsSync(path.join(root, linked)) && !headingAnchors(read(linked)).has(anchor)) {
          broken.push(`${file}: ${link}`);
        }
      }
    }
    assert.deepEqual(broken, []);
  });
});

describe('names used in the documentation', () => {
  it('name files and folders that exist', () => {
    const files = projectFiles();
    const names = new Set(files.map((file) => path.posix.basename(file)));
    const missing = [];
    for (const file of docs) {
      for (const [, name] of prose(read(file)).matchAll(/`([^`\s]+)`/g)) {
        const looksLikePath = /^(lib|routes|database|views|public|test|scripts|docs|\.github)\/[\w./-]+$/.test(name);
        // A download name such as checkpoint-data-YYYY-MM-DD.json is a pattern, not a file.
        const looksLikeFile = /^[\w.-]+\.(js|json|ejs|css|py|md|yml)$/.test(name) && !name.includes('YYYY');
        if (looksLikePath && !fs.existsSync(path.join(root, name))) missing.push(`${file}: ${name}`);
        else if (!looksLikePath && looksLikeFile && !names.has(name)) missing.push(`${file}: ${name}`);
      }
    }
    assert.deepEqual(missing, []);
  });

  it('name npm scripts that exist', () => {
    const { scripts } = JSON.parse(read('package.json'));
    const missing = [];
    for (const file of docs) {
      for (const [, script] of read(file).matchAll(/npm run ([\w:-]+)/g)) {
        if (!scripts[script]) missing.push(`${file}: npm run ${script}`);
      }
    }
    assert.deepEqual(missing, []);
  });

  it('explain every setting the code reads', () => {
    const settings = new Set();
    for (const file of projectFiles().filter((name) => name.endsWith('.js') && !name.startsWith('test/'))) {
      for (const [, name] of read(file).matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) settings.add(name);
    }
    const documented = read('README.md') + read('PROJECT-GUIDE.md') + read('docs/TESTING.md');
    assert.ok(settings.has('SESSION_SECRET'), 'the scan finds settings');
    assert.deepEqual([...settings].filter((name) => !new RegExp(`\\b${name}\\b`).test(documented)), []);
  });

  it('give the version in package.json as the newest changelog entry', () => {
    const { version } = JSON.parse(read('package.json'));
    const newest = read('CHANGELOG.md').match(/^## \[(\d+\.\d+\.\d+)\]/m)[1];
    assert.equal(newest, version);
  });
});

describe('traceability matrix', () => {
  it('traces every functional requirement exactly once', () => {
    const defined = [...read('docs/REQUIREMENTS.md').matchAll(/^\| (FR-\d+) \| The system shall/gm)].map((match) => match[1]);
    const traced = traceabilityRows().map((row) => row.match(/^\| (FR-\d+)/)[1]);
    assert.ok(defined.length >= 20, 'the requirements are found');
    assert.deepEqual([...traced].sort(), [...defined].sort());
    assert.equal(new Set(traced).size, traced.length, 'no requirement is listed twice');
  });

  it('names test suites and tests that exist', () => {
    const missing = [];
    for (const row of traceabilityRows()) {
      const tests = [...row.matchAll(/`(test\/[^`]+\.test\.js)`(?: \(([^)]+)\))?/g)];
      if (tests.length === 0) missing.push(`${row.slice(0, 12)}: no test file`);
      for (const [, file, names] of tests) {
        const source = read(file);
        const titles = new Set([...source.matchAll(/\b(?:describe|it)\((['"])(.+?)\1,/g)].map((match) => match[2].toLowerCase()));
        for (const name of names ? names.split(/,\s*/) : []) {
          if (!titles.has(name.toLowerCase())) missing.push(`${file}: ${name}`);
        }
      }
    }
    assert.deepEqual(missing, []);
  });
});
