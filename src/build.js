#!/usr/bin/env node
/* Bygger alt fra CSV: modell, kontroller, layout, .drawio, rapporter og data til nettleservisningen. */
'use strict';
const fs = require('fs');
const path = require('path');
const ECE = require('./core');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const OUT = path.join(ROOT, 'out');
const LOCK = path.join(DATA, 'layout-lock.json');

const DATASETS = [
  { key: 'base', dir: 'base', title: 'Basis (gyldig)' },
  { key: 'errors', dir: 'errors', title: 'Feildatasett (3 bevisste feil)' },
  { key: 'revb', dir: 'rev-b', title: 'Revisjon B' }
];

function readDir(dir) {
  const files = {};
  for (const f of ECE.FILES) {
    const p = path.join(DATA, dir, f + '.csv');
    if (fs.existsSync(p)) files[f + '.csv'] = fs.readFileSync(p, 'utf8');
  }
  return files;
}

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  // låsefil for plasseringer: opprettes fra basis første gang, gjenbrukes deretter
  let lock = fs.existsSync(LOCK) ? JSON.parse(fs.readFileSync(LOCK, 'utf8')) : null;
  const results = {};
  for (const ds of DATASETS) {
    const r = ECE.runPipeline(readDir(ds.dir), { lock, title: ds.title, roomId: 'RM-210', logicalId: 'L-001' });
    if (ds.key === 'base') {
      // lagre kun basisens plasseringer – andre revisjoner skal arve dem, ikke endre dem
      if (!lock) { lock = r.lock; fs.writeFileSync(LOCK, JSON.stringify(lock, null, 2) + '\n'); }
    }
    results[ds.key] = Object.assign(r, { ds });
  }

  // simulert fjerning for hver kabel/patch (forhåndsberegnet til nettleseren)
  const impacts = {};
  for (const k of Object.keys(results)) {
    impacts[k] = {};
    for (const l of results[k].model.links) impacts[k][l.id] = ECE.removalImpact(results[k].model, l.id);
  }

  const diff = ECE.diffModels(results.base.model, results.revb.model);

  // filer
  fs.writeFileSync(path.join(OUT, 'engineering-connections.drawio'), results.base.drawio);
  fs.writeFileSync(path.join(OUT, 'engineering-connections-rev-b.drawio'), results.revb.drawio);
  fs.writeFileSync(path.join(OUT, 'engineering-connections-feil.drawio'), results.errors.drawio);
  fs.writeFileSync(path.join(OUT, 'rapport-basis.md'), results.base.report);
  fs.writeFileSync(path.join(OUT, 'rapport-feil.md'), results.errors.report);
  fs.writeFileSync(path.join(OUT, 'rapport-rev-b.md'), results.revb.report);
  fs.writeFileSync(path.join(OUT, 'endringer-rev-b.md'), ECE.buildDiffReport(diff));
  fs.writeFileSync(path.join(OUT, 'kabelliste-basis.csv'), cableCsv(results.base.model));

  const web = {
    generated: 'deterministisk fra CSV i data/',
    datasets: {},
    diff,
    impacts
  };
  for (const k of Object.keys(results)) {
    web.datasets[k] = { title: results[k].ds.title, model: ECE.modelToJSON(results[k].model), layout: results[k].layout };
  }
  fs.writeFileSync(path.join(OUT, 'data.js'), 'window.ECE_DATA = ' + JSON.stringify(web) + ';\n');

  // konsollsammendrag
  for (const k of Object.keys(results)) {
    const s = results[k].model.summary;
    console.log(`${results[k].ds.title.padEnd(32)} utstyr=${s.equipment} kabler=${s.cables} patcher=${s.patches} kanaler=${s.channels} feil=${s.errors} advarsler=${s.warnings}`);
    results[k].model.issues.filter(i => i.severity === 'error').forEach(i => console.log(`   FEIL ${i.code}: ${i.message}`));
  }
  console.log(`Revisjon B mot basis: +${diff.summary.added} / -${diff.summary.removed} / ~${diff.summary.changed}`);
  console.log('Skrevet til ' + path.relative(process.cwd(), OUT) + '/');
}

function cableCsv(model) {
  const q = v => /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
  const rows = [['tag', 'kategori', 'fra_tag', 'fra_port', 'fra_rom', 'til_tag', 'til_port', 'til_rom', 'type', 'lengde_m', 'status']];
  model.links.slice().sort((a, b) => a.id.localeCompare(b.id)).forEach(l => {
    const ra = model.equipment.get(l.a.tag), rb = model.equipment.get(l.b.tag);
    rows.push([l.id, l.kind === 'cable' ? 'kabel' : 'patch', l.a.tag, l.a.port, ra ? ra.room : '', l.b.tag, l.b.port, rb ? rb.room : '', l.cableType, l.length == null ? '' : l.length, l.problems.join('; ') || 'OK']);
  });
  return rows.map(r => r.map(q).join(',')).join('\n') + '\n';
}

main();
