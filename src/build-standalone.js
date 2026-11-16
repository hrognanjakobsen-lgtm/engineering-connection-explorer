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
// Enkel ZIP (lagret, ukomprimert) med alle filene – brukes der .drawio ikke kan lastes ned direkte
function crc32(buf) { let c, crc = 0xffffffff; for (let i = 0; i < buf.length; i++) { c = (crc ^ buf[i]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function makeZip(entries) {
  const parts = [], central = []; let off = 0;
  for (const [name, text] of entries) {
    const data = Buffer.from(text, 'utf8'), fn = Buffer.from(name, 'utf8'), crc = crc32(data);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(0, 8);
    h.writeUInt16LE(0, 10); h.writeUInt16LE(0x5a21, 12); h.writeUInt32LE(crc, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(fn.length, 26); h.writeUInt16LE(0, 28);
    parts.push(h, fn, data);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(0, 10);
    c.writeUInt16LE(0, 12); c.writeUInt16LE(0x5a21, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(fn.length, 28); c.writeUInt32LE(off, 42);
    central.push(c, fn); off += 30 + fn.length + data.length;
  }
  const cd = Buffer.concat(central), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(entries.length, 8); e.writeUInt16LE(entries.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat(parts.concat([cd, e]));
}
const zip = makeZip(Object.entries(files));
fs.writeFileSync(path.join(ROOT, 'out', 'engineering-connection-explorer-filer.zip'), zip);
// </script> må ikke forekomme i innebygd JS
const safe = s => s.replace(/<\/script/gi, '<\\/script');

const downloads = `<script>
window.ECE_FILES = ${safe(JSON.stringify(files))};
window.ECE_ZIP_B64 = '${zip.toString('base64')}';
(function () {
  function dl(name) {
    var t = name.endsWith('.drawio') ? 'application/xml' : name.endsWith('.csv') ? 'text/csv' : 'text/markdown';
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([window.ECE_FILES[name]], { type: t + ';charset=utf-8' }));
    a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  var sel = document.createElement('select'); sel.id = 'downloads';
  sel.innerHTML = '<option value="">Last ned …</option>' + Object.keys(window.ECE_FILES).map(function (n) { return '<option>' + n + '</option>'; }).join('');
  var ZIP = 'engineering-connection-explorer-filer.zip';
  sel.innerHTML += '<option>' + ZIP + '</option>';
  var framed = (function () { try { return window.self !== window.top; } catch (e) { return true; } })();
  var msg = document.createElement('span'); msg.style.cssText = 'font-size:11px;color:#616E7C;margin-left:6px';
  function zipBytes() { var b = atob(window.ECE_ZIP_B64), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  var saver = null;
  if (framed && window.claude && window.claude.use) {
    // claude.ai: nedlasting går via plattformens downloads-funksjon; .drawio leveres i zip
    window.claude.use('downloads').then(function (d) {
      saver = d;
      if (!d) return;
      sel.innerHTML = '<option value="">Last ned …</option><option value="' + ZIP + '">Alle .drawio-filer og rapporter (.zip)</option>' +
        Object.keys(window.ECE_FILES).filter(function (n) { return !/\.drawio$/.test(n); }).map(function (n) { return '<option>' + n + '</option>'; }).join('');
    });
  }
  sel.onchange = function () {
    var name = sel.value; if (!name) return; sel.value = '';
    if (saver) {
      var data = name === ZIP ? new Blob([zipBytes()]) : window.ECE_FILES[name];
      saver.save({ filename: name, data: data }).then(function () { msg.textContent = name + ' lagret'; }, function (e) { msg.textContent = e && e.code === 'declined' ? '' : 'Nedlasting ikke tilgjengelig her (' + (e && e.code) + ')'; });
      return;
    }
    if (name === ZIP) {
      var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([zipBytes()], { type: 'application/zip' })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { a.remove(); }, 500);
      if (!framed) return;
    } else if (!framed) { dl(name); return; }
    if (framed && name !== ZIP) navigator.clipboard.writeText(window.ECE_FILES[name]).then(function () { msg.textContent = name + ' kopiert til utklippstavlen'; }, function () { msg.textContent = 'Nedlasting blokkert her – åpne HTML-filen direkte.'; });
  };
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
