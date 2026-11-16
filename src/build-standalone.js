#!/usr/bin/env node
/*
 * Lager én frittstående HTML-fil (out/engineering-connection-explorer.html) med visning, data og
 * .drawio-filer innebygd. Krever ingen Node, server eller installasjon hos mottaker – bare en nettleser.
 * Kjør etter src/build.js.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const rd = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

let html = rd('web/index.html');
const css = rd('web/style.css');
const app = rd('web/app.js');
const data = rd('out/data.js');
const files = {
  'engineering-connections.drawio': rd('out/engineering-connections.drawio'),
  'engineering-connections-rev-b.drawio': rd('out/engineering-connections-rev-b.drawio'),
  'engineering-connections-feil.drawio': rd('out/engineering-connections-feil.drawio'),
  'rapport-basis.md': rd('out/rapport-basis.md'),
  'rapport-feil.md': rd('out/rapport-feil.md'),
  'endringer-rev-b.md': rd('out/endringer-rev-b.md'),
  'kabelliste-basis.csv': rd('out/kabelliste-basis.csv')
};
// </script> må ikke forekomme i innebygd JS
const safe = s => s.replace(/<\/script/gi, '<\\/script');

const downloads = `<script>
window.ECE_FILES = ${safe(JSON.stringify(files))};
(function () {
  function dl(name) {
    var t = name.endsWith('.drawio') ? 'application/xml' : name.endsWith('.csv') ? 'text/csv' : 'text/markdown';
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([window.ECE_FILES[name]], { type: t + ';charset=utf-8' }));
    a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  var sel = document.createElement('select'); sel.id = 'downloads';
  sel.innerHTML = '<option value="">Last ned …</option>' + Object.keys(window.ECE_FILES).map(function (n) { return '<option>' + n + '</option>'; }).join('');
  var framed = (function () { try { return window.self !== window.top; } catch (e) { return true; } })();
  var msg = document.createElement('span'); msg.style.cssText = 'font-size:11px;color:#616E7C;margin-left:6px';
  sel.onchange = function () {
    var name = sel.value; if (!name) return; sel.value = '';
    if (!framed) { dl(name); return; }
    // innebygd visning (f.eks. claude.ai) blokkerer nedlasting: kopier innholdet i stedet
    navigator.clipboard.writeText(window.ECE_FILES[name]).then(function () {
      msg.textContent = name + ' kopiert til utklippstavlen' + (name.endsWith('.drawio') ? ' – lagre som .drawio-fil, eller lim inn i draw.io' : '');
    }, function () { msg.textContent = 'Kopiering ble blokkert – åpne HTML-filen direkte for nedlasting.'; });
  };
  if (framed) sel.options[0].textContent = 'Kopier fil …';
  var old = document.querySelector('a.dl'); old.replaceWith(sel); sel.after(msg);
})();
</script>`;

html = html
  .replace('<link rel="stylesheet" href="style.css">', () => `<style>\n${css}\n</style>`)
  .replace('<script src="../out/data.js"></script>', () => `<script>\n${safe(data)}\n</script>`)
  .replace('<script src="app.js"></script>', () => `<script>\n${safe(app)}\n</script>\n${downloads}`);

if (/src="|href="(?!#)/.test(html.replace(/<a [^>]*href="[^"]*"/g, ''))) console.warn('Advarsel: eksterne referanser igjen i HTML');
const out = path.join(ROOT, 'out', 'engineering-connection-explorer.html');
fs.writeFileSync(out, html);
console.log('Skrevet ' + path.relative(process.cwd(), out) + ' (' + Math.round(html.length / 1024) + ' kB)');
