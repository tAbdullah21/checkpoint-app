const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../../public/js/theme.js'), 'utf8');
function browser(saved, blocked = false) {
  const events = {}; const button = { hidden: true, attrs: {}, setAttribute(k,v) { this.attrs[k]=v; }, addEventListener(k,f) { events[k]=f; } };
  const root = { dataset: {} }; const stored = { value: saved }; const meta = { setAttribute(k,v) { this[k]=v; } };
  vm.runInNewContext(source, {
    document: { documentElement: root, querySelector: () => meta, querySelectorAll: () => [button], addEventListener(k,f) { events[k]=f; } },
    window: { addEventListener(k,f) { events[k]=f; } },
    localStorage: { getItem() { if(blocked) throw Error(); return stored.value; }, setItem(k,v) { if(blocked) throw Error(); stored.value=v; } },
  });
  return { events, button, root, stored, meta };
}
it('applies saved light mode before DOM ready, then toggles and persists dark mode', () => {
  const b=browser('light'); assert.equal(b.root.dataset.theme,'light');
  b.events.DOMContentLoaded(); assert.equal(b.button.attrs['aria-label'],'Switch to dark mode');
  b.events.click(); assert.equal(b.root.dataset.theme,'dark'); assert.equal(b.stored.value,'dark');
  assert.equal(b.meta.content,'#05070c'); assert.equal(b.button.hidden,false);
});
it('defaults safely and switches when storage is blocked', () => {
  const b=browser(null,true); b.events.DOMContentLoaded();
  assert.equal(b.root.dataset.theme,'dark'); b.events.click(); assert.equal(b.root.dataset.theme,'light');
});
it('synchronizes the appearance between tabs and handles clearing preferences', () => {
  const b=browser('dark'); b.events.DOMContentLoaded();
  b.events.storage({ key:'checkpoint-theme', newValue:'light' }); assert.equal(b.root.dataset.theme,'light');
  b.events.storage({ key:null, newValue:null }); assert.equal(b.root.dataset.theme,'dark');
});
