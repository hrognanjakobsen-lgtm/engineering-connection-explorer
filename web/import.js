/* Engineering Connection Explorer – import av egne data i nettleseren.
 * Filene leses lokalt (FileReader/Blob). Ingenting sendes over nett. Beregning skjer med samme kjerne (src/core.js). */
(function () {
  'use strict';
  const ECE = window.ECE;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const MAPPINGS = Object.assign({ standard: ECE.DEFAULT_MAPPING }, window.ECE_MAPPINGS || {});
  const tables = {};          // kildenavn -> rader
  let last = null;            // siste importresultat

  /* ---------- lagring av filer (vanlig nedlasting, eller plattformens downloads i claude.ai) */
  const framed = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();
  let dlPromise = null;
  function downloadsApi() {
    if (!framed || !window.claude || !window.claude.use) return Promise.resolve(null);
    if (!dlPromise) dlPromise = window.claude.use('downloads').catch(() => null);
    return dlPromise;
  }
  async function saveFile(name, data) {
    const d = await downloadsApi();
    if (d) {
      try { await d.save({ filename: name, data: data instanceof Uint8Array ? new Blob([data]) : data }); return 'saved'; }
      catch (e) { if (e && e.code === 'declined') return 'declined'; throw new Error(e && e.code || 'unavailable'); }
    }
    if (framed && window.claude) throw new Error('nedlasting ikke tilgjengelig i denne visningen');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data]));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    return 'saved';
  }
  window.ECE_SAVE = saveFile;
  if (framed) downloadsApi();

  /* ---------- filer inn */
  async function inflateRaw(u8) {
    if (typeof DecompressionStream === 'undefined') throw new Error('Nettleseren kan ikke pakke ut .xlsx – lagre arkene som CSV');
    const s = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  async function readFiles(list) {
    const msgs = [];
    for (const f of Array.from(list)) {
      const bytes = new Uint8Array(await f.arrayBuffer());
      try {
        if (/\.(xlsx|xlsm)$/i.test(f.name)) {
          const sheets = await ECE.readXlsx(bytes, inflateRaw);
          Object.keys(sheets).forEach(n => { tables[n] = sheets[n]; });
          msgs.push(`${f.name}: ${Object.keys(sheets).length} ark`);
        } else if (/\.xls$/i.test(f.name)) {
          msgs.push(`${f.name}: gammelt .xls-format støttes ikke – lagre som .xlsx eller CSV`);
        } else {
          tables[f.name] = ECE.parseCSV(ECE.decodeText(bytes), f.name);
          msgs.push(`${f.name}: ${tables[f.name].length} rader`);
        }
      } catch (e) { msgs.push(`${f.name}: kunne ikke leses (${e.message})`); }
    }
    renderTables(msgs);
  }

  function renderTables(msgs) {
    const names = Object.keys(tables);
    $('impTables').innerHTML = (msgs && msgs.length ? `<div class="note">${msgs.map(esc).join(' · ')}</div>` : '') +
      (names.length ? `<table class="tbl"><tr><th>Kildetabell</th><th>Rader</th><th>Kolonner</th><th></th></tr>` + names.map(n => {
        const cols = tables[n].length ? Object.keys(tables[n][0]) : [];
        return `<tr><td class="tag">${esc(n)}</td><td>${tables[n].length}</td><td class="cols">${esc(cols.join(', '))}</td><td><button data-rm="${esc(n)}" title="Fjern">×</button></td></tr>`;
      }).join('') + '</table>' : '<p class="muted">Ingen filer lastet ennå.</p>');
    $('impTables').querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { delete tables[b.getAttribute('data-rm')]; renderTables(); });
  }

  /* ---------- mapping */
  function setMapping(key) {
    const m = MAPPINGS[key];
    if (m) $('mapText').value = JSON.stringify(m, null, 2);
    $('mapSel').value = key in MAPPINGS ? key : 'egen';
  }
  function currentMapping() {
    try { return JSON.parse($('mapText').value); }
    catch (e) { throw new Error('Mappingen er ikke gyldig JSON: ' + e.message); }
  }

  /* ---------- kjør */
  function run() {
    const res = $('impResult');
    if (!Object.keys(tables).length) { res.innerHTML = '<p class="missing">Last inn minst én fil først.</p>'; return; }
    let mapping;
    try { mapping = currentMapping(); } catch (e) { res.innerHTML = `<p class="missing">${esc(e.message)}</p>`; return; }
    try { localStorage.setItem('ece-mapping', $('mapText').value); } catch (e) { /* valgfritt */ }
    const t0 = performance.now();
    const r = ECE.runImport(tables, mapping, { title: 'Importerte data' });
    const impacts = {};
    r.model.links.forEach(l => { impacts[l.id] = ECE.removalImpact(r.model, l.id); });
    last = { r, mapping };
    const s = r.model.summary;
    const mapIssues = r.model.issues.filter(i => /^MAPPING/.test(i.code));
    res.innerHTML = `<p><b>Bygget på ${Math.round(performance.now() - t0)} ms.</b> ${s.rooms} rom · ${s.cabinets} kabinetter · ${s.equipment} utstyr · ${s.cables} kabler · ${s.patches} patcher · ${s.channels} kanaler ·
      <span class="sev ${s.errors ? 'error' : 'ok'}">${s.errors} feil</span> <span class="sev ${s.warnings ? 'warning' : 'ok'}">${s.warnings} advarsler</span> <span class="sev info">${s.infos} info</span></p>` +
      `<p class="note">Brukte tabeller: ${r.import.used.map(u => `${esc(u.target)} ← ${esc(u.source)} (${u.rows}${u.rows !== u.of ? ' av ' + u.of : ''})`).join(' · ') || 'ingen'}</p>` +
      (mapIssues.length ? '<ul class="list">' + mapIssues.map(i => `<li><span class="sev ${i.severity}">${i.severity === 'error' ? 'FEIL' : 'ADVARSEL'}</span> ${esc(i.message)}</li>`).join('') + '</ul>' : '') +
      `<p><button id="impShow" class="primary">Vis i oversikten</button> <button id="impZip">Last ned resultat (.zip)</button> <span id="impMsg" class="note"></span></p>`;
    $('impShow').onclick = () => {
      window.ECE_APP.addDataset('import', { title: 'Importerte data', model: ECE.modelToJSON(r.model), layout: r.layout }, impacts);
      close();
    };
    $('impZip').onclick = async () => {
      const zip = ECE.makeZip([
        ['importert.drawio', r.drawio], ['rapport-import.md', r.report], ['kabelliste-import.csv', ECE.buildCableCsv(r.model)],
        ['mapping.json', JSON.stringify(mapping, null, 2)], ['layout-lock.json', JSON.stringify(r.lock, null, 2)]
      ]);
      try { const st = await saveFile('ece-import-resultat.zip', zip); $('impMsg').textContent = st === 'saved' ? 'Lagret.' : ''; }
      catch (e) { $('impMsg').textContent = 'Kunne ikke laste ned: ' + e.message; }
    };
  }

  /* ---------- dialog */
  function open() { $('importDlg').hidden = false; }
  function close() { $('importDlg').hidden = true; }

  function init() {
    $('mapSel').innerHTML = Object.keys(MAPPINGS).map(k => `<option value="${esc(k)}">${esc(MAPPINGS[k].name || k)}</option>`).join('') + '<option value="egen">Egen (redigert)</option>';
    let saved = null; try { saved = localStorage.getItem('ece-mapping'); } catch (e) { /* valgfritt */ }
    if (saved) { $('mapText').value = saved; $('mapSel').value = 'egen'; } else setMapping('standard');
    $('mapSel').onchange = ev => setMapping(ev.target.value);
    $('mapText').oninput = () => { $('mapSel').value = 'egen'; };
    $('mapFile').onchange = async ev => { const f = ev.target.files[0]; if (f) { $('mapText').value = await f.text(); $('mapSel').value = 'egen'; } ev.target.value = ''; };
    $('mapLoad').onclick = () => $('mapFile').click();
    $('mapSave').onclick = async () => { try { await saveFile('mapping.json', $('mapText').value); } catch (e) { $('impResult').innerHTML = `<p class="missing">${esc(e.message)}</p>`; } };
    $('files').onchange = ev => { readFiles(ev.target.files); ev.target.value = ''; };
    const drop = $('drop');
    drop.ondragover = ev => { ev.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = ev => { ev.preventDefault(); drop.classList.remove('over'); readFiles(ev.dataTransfer.files); };
    $('impExample').onclick = () => {
      const ex = window.ECE_IMPORT_EXAMPLE || {};
      Object.keys(tables).forEach(k => delete tables[k]);
      Object.keys(ex).forEach(n => { tables[n] = ECE.parseCSV(ex[n], n); });
      setMapping('eksempel-eksport');
      renderTables(['Fiktivt eksempel lastet: ' + Object.keys(ex).join(', ')]);
    };
    $('impTemplate').onclick = async () => {
      try { await saveFile('ece-mal.xlsx', ECE.buildTemplateXlsx(null)); }
      catch (e) { $('impResult').innerHTML = `<p class="missing">Malen kunne ikke lastes ned her (${esc(e.message)}). Den ligger også i repoet: data/mal/ece-mal.xlsx</p>`; }
    };
    $('impRun').onclick = run;
    $('impClose').onclick = close;
    $('importBtn').onclick = open;
    $('importDlg').onclick = ev => { if (ev.target === $('importDlg')) close(); };
    renderTables();
  }
  init();
})();
