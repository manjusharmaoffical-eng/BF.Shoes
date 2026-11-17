import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const [app, html] = await Promise.all([
  readFile(new URL('../frontend/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../frontend/index.html', import.meta.url), 'utf8')
]);

test('catalog size checkboxes filter products by UK size labels without assuming stock', () => {
  assert.match(html, /data-size="3"/);
  assert.match(html, /data-size="12"/);
  assert.match(app, /\[data-size\].*addEventListener\('change'/);
  assert.match(app, /matchesSize=!state\.sizes\.length/);
  assert.match(app, /replace\(\/\^UK\\s\*\/i/);
  assert.match(app, /matchesColor && matchesSize && matchesPrice/);
});
