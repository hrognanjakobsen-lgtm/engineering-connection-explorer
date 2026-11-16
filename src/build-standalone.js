#!/usr/bin/env node
/*
 * Lager én frittstående HTML-fil (out/engineering-connection-explorer.html) med visning, kjerne,
 * importdialog, data og nedlastbare filer innebygd. Mottaker trenger bare en nettleser.
 * Kjøres av `npm run build` etter src/build.js.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ECE = require('./core');
const ROOT = path.resolve(__dirname, '..');
const rd = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

const files = {
  'engineering-connections.drawio': rd('out/engineering-connections.drawio'),
  'engineering-connections-rev-b.drawio': rd('out/engineering-connections-rev-b.drawio'),
  'engineering-connections-feil.drawio': rd('out/engineering-connections-feil.drawio'),
  'rapport-basis.md': rd('out/rapport-basis.md'),
  'rapport-feil.md': rd('out/rapport-feil.md'),
  'endringer-rev-b.md': rd('out/endringer-rev-b.md'),
  'kabelliste-basis.csv': rd('out/kabelliste-basis.csv')
};
const ZIPNAME = 'engineering-connection-explorer-filer.zip';
const zip = ECE.makeZip(Object.entries(files));
fs.writeFileSync(path.join(ROOT, 'out', ZIPNAME), zip);

// </script> må ikke forekomme i innebygd JS
const safe = s => s.replace(/<\/script/gi, '<\\/script');
const inline = p => `<script>\n${safe(rd(p))}\n</script>`;

const downloads = `<script>
window.ECE_FILES = ${safe(JSON.stringify(files))};
window.ECE_ZIP_B64 = '${Buffer.from(zip).toString('base64')}';
(function () {
  var ZIP = '${ZIPNAME}';
  var framed = (function () { try { return window.self !== window.top; } catch (e) { return true; } })();
  function zipBytes() { var b = atob(window.ECE_ZIP_B64), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  var sel = document.createElement('select'); sel.id = 'downloads';
  var names = Object.keys(window.ECE_FILES).filter(function (n) { return !(framed && /\\.drawio$/.test(n)); }); // claude.ai tillater ikke .drawio – de ligger i zip
  sel.innerHTML = '<option value="">Last ned …</option><option value="' + ZIP + '">Alle .drawio-filer og rapporter (.zip)</option>' + names.map(function (n) { return '<option>' + n + '</option>'; }).join('');
  var msg = document.createElement('span'); msg.className = 'note'; msg.style.marginLeft = '6px';
  sel.onchange = function () {
    var name = sel.value; if (!name) return; sel.value = '';
    window.ECE_SAVE(name, name === ZIP ? zipBytes() : window.ECE_FILES[name]).then(function (st) { msg.textContent = st === 'saved' ? '' : ''; },
      function (e) { msg.textContent = 'Nedlasting ikke tilgjengelig her (' + e.message + ')'; });
  };
  var old = document.querySelector('a.dl'); old.replaceWith(sel); sel.after(msg);
})();
</script>`;

let html = rd('web/index.html');
const rep = (a, b) => { if (html.indexOf(a) < 0) throw new Error('Fant ikke ' + a); html = html.replace(a, () => b); };
rep('<link rel="stylesheet" href="style.css">', `<style>\n${rd('web/style.css')}\n</style>`);
rep('<script src="../src/core.js"></script>', inline('src/core.js'));
rep('<script src="../out/data.js"></script>', inline('out/data.js'));
rep('<script src="../out/import-config.js"></script>', inline('out/import-config.js'));
rep('<script src="app.js"></script>', inline('web/app.js'));
rep('<script src="import.js"></script>', inline('web/import.js') + '\n' + downloads);

if (/<script src=|<link [^>]*href=/.test(html)) throw new Error('Eksterne referanser igjen i frittstående HTML');
const out = path.join(ROOT, 'out', 'engineering-connection-explorer.html');
fs.writeFileSync(out, html);
console.log('Skrevet ' + path.relative(process.cwd(), out) + ' (' + Math.round(html.length / 1024) + ' kB)');
