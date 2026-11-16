#!/usr/bin/env node
/* Verifikasjon: kjør med `npm test`. Kontrollerer modell, feil, kjent sti, revisjon, layout og .drawio. */
'use strict';
const fs = require('fs');
const path = require('path');
const ECE = require('../src/core');
const ROOT = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  OK   ' + msg); } else { fail++; console.log('  FEIL ' + msg); } };
const read = dir => { const f = {}; ECE.FILES.forEach(n => { const p = path.join(ROOT, 'data', dir, n + '.csv'); if (fs.existsSync(p)) f[n + '.csv'] = fs.readFileSync(p, 'utf8'); }); return f; };
const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'layout-lock.json'), 'utf8'));
const run = dir => ECE.runPipeline(read(dir), { lock, roomId: 'RM-210', logicalId: 'L-001' });

const base = run('base'), errs = run('errors'), revb = run('rev-b');

console.log('\n1. Basisdatasett');
const bm = base.model;
ok(bm.summary.rooms === 4 && bm.summary.cabinets === 3, '4 rom og 3 kabinetter');
ok(bm.summary.equipment === 20, '20 utstyrstagger');
ok(bm.summary.errors === 0, 'ingen feil i basis (advarsler: ' + bm.summary.warnings + ')');
ok(bm.issues.every(i => i.severity !== 'error'), 'kun advarsler/info i basis');
const types = new Set(Array.from(bm.equipment.values()).map(e => e.type));
ok(['switch', 'fiber_patch_panel', 'copper_patch_panel', 'camera', 'server', 'operator_station'].every(t => types.has(t)), 'alle utstyrstyper finnes');
ok(bm.channels.every(c => c.complete), 'alle ' + bm.channels.length + ' registrerte kanaler er komplette');

console.log('\n2. Alle gyldige objekter og forbindelser vises');
for (const r of [base, revb]) {
  const L = r.layout;
  const tags = new Set(L.nodes.map(n => n.tag));
  ok(Array.from(r.model.equipment.keys()).every(t => tags.has(t)), `alt utstyr har en boks i oversikten (${tags.size})`);
  const shown = new Set([].concat.apply([], L.edges.map(e => e.links)));
  ok(r.model.links.filter(l => l.valid).every(l => shown.has(l.id)), `alle gyldige kabler/patcher inngår i en tegnet linje (${shown.size})`);
  const overlap = L.nodes.some((a, i) => L.nodes.some((b, j) => j > i && a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y));
  ok(!overlap, 'ingen overlappende utstyrsbokser');
  const inRoom = L.nodes.every(n => { const R = L.rooms.find(x => x.id === n.room); return R && n.x >= R.x && n.x + n.w <= R.x + R.w && n.y >= R.y && n.y + n.h <= R.y + R.h; });
  ok(inRoom, 'alle bokser ligger innenfor sitt rom');
  const lblHit = L.labels.some(lb => L.nodes.some(n => lb.x < n.x + n.w && lb.x + lb.w > n.x && lb.y < n.y + n.h && lb.y + lb.h > n.y)) ||
    L.labels.some((a, i) => L.labels.some((b, j) => j > i && a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y));
  ok(!lblHit, 'kabeletiketter overlapper verken bokser eller hverandre');
  const ortho = L.edges.every(e => e.points.every((p, i) => i === 0 || p.x === e.points[i - 1].x || p.y === e.points[i - 1].y));
  ok(ortho, 'alle linjer er ortogonale');
}

console.log('\n3. Tre bevisste feil oppdages');
const em = errs.model;
const E = em.issues.filter(i => i.severity === 'error');
ok(E.length === 3, 'nøyaktig 3 feil (fant ' + E.length + ')');
ok(E.some(i => i.code === 'UNKNOWN_ENDPOINT' && i.refs.indexOf('CAM-215') >= 0), 'ukjent endepunkt CAM-215 (W-210-015)');
ok(E.some(i => i.code === 'PORT_DOUBLE_USE' && /SW-210-01:3/.test(i.message)), 'dobbeltbruk av port SW-210-01:3');
ok(E.some(i => i.code === 'MISSING_ROOM' && i.refs.indexOf('CAM-313') >= 0), 'manglende rom for CAM-313');
ok(errs.layout.nodes.some(n => n.tag === 'CAM-215' && n.placeholder), 'ukjent endepunkt vises som plassholder');
ok(errs.layout.rooms.some(r => r.orphan) && errs.layout.nodes.some(n => n.tag === 'CAM-313' && n.room === '__ORPHAN__'), 'utstyr uten rom vises i egen gruppe');

console.log('\n4. Kjent forbindelsessti');
const lg = bm.logical.find(l => l.id === 'L-001');
const hops = ECE.routeHops(bm, lg.route);
const first = hops.nodes[0], last = hops.nodes[hops.nodes.length - 1];
ok(first.tag === 'CAM-211' && first.port === 'ETH0', 'L-001 starter i CAM-211:ETH0');
ok(last.tag === 'SRV-110-01' && last.port === 'NIC1', 'L-001 ender i SRV-110-01:NIC1');
const viaLinks = hops.conns.filter(c => c.kind === 'cable' || c.kind === 'patch').map(c => c.id).join(',');
ok(viaLinks === 'W-210-011,PC-210-001,PC-210-005,W-110-210,PC-110-004,PC-110-003', 'L-001 via forventede kabler: ' + viaLinks);
const ch1 = bm.channels.find(c => c.ends[0].tag === 'CAM-211');
ok(ch1 && ch1.ends[1].tag === 'SW-210-01' && ch1.ends[1].port === '1', 'CAM-211 fysisk kanal ender i SW-210-01:1 via CPP-210-01 R01/F01');

console.log('\n5. Revisjon B');
const diff = ECE.diffModels(bm, revb.model);
const sig = diff.changes.map(c => c.change + ':' + c.kind + ':' + c.id).sort().join(' ');
const expected = ['changed:equipment:CAM-214', 'changed:link:PC-110-002', 'removed:link:W-210-014', 'removed:link:PC-210-004', 'added:link:W-310-014', 'added:link:PC-310-005',
  'removed:internal:CPP-210-01:F04↔R04', 'added:internal:CPP-310-01:F04↔R04'].sort().join(' ');
ok(sig === expected, 'endringslisten er nøyaktig de faktiske endringene');
const cam = diff.changes.find(c => c.id === 'CAM-214');
ok(cam.fields.length === 1 && cam.fields[0].before === 'RM-210' && cam.fields[0].after === 'RM-310', 'CAM-214 flyttet RM-210 → RM-310');
const pc = diff.changes.find(c => c.id === 'PC-110-002');
ok(pc.fields[0].before === 'SW-110-01:6' && pc.fields[0].after === 'SW-110-01:7', 'PC-110-002 flyttet fra port 6 til 7');
const moved = revb.layout.nodes.filter(n => n.tag !== 'CAM-214').filter(n => { const b = base.layout.nodes.find(x => x.tag === n.tag); return !b || b.x !== n.x || b.y !== n.y; });
ok(moved.length === 0, 'stabile plasseringer: kun CAM-214 har ny posisjon i revisjon B');

console.log('\n6. Simulert kabelfjerning');
const imp = ECE.removalImpact(bm, 'W-110-210');
ok(imp.brokenChannels.length === 1, 'W-110-210 bryter 1 registrert kanal (opplink Nord)');
ok(imp.logical.length === 1 && imp.logical[0].id === 'L-001' && !imp.logical[0].alternative, 'L-001 bruker kjeden; ingen annen registrert kjede');
const imp2 = ECE.removalImpact(bm, 'PC-110-003');
ok(imp2.logical.length === 4, 'fjerning av serverpatch PC-110-003 berører alle 4 registrerte logiske forbindelser');

console.log('\n7. draw.io-fil');
const xml = fs.readFileSync(path.join(ROOT, 'out', 'engineering-connections.drawio'), 'utf8');
const diagrams = xml.match(/<diagram [^>]*>[\s\S]*?<\/diagram>/g) || [];
ok(diagrams.length === 3, '3 sider: ' + diagrams.map(d => d.match(/name="([^"]+)"/)[1]).join(' | '));
ok(!/<!--/.test(xml), 'ingen XML-kommentarer');
let refsOk = true, idsOk = true;
diagrams.forEach(d => {
  const ids = (d.match(/<mxCell id="([^"]+)"/g) || []).map(s => s.slice(12, -1));
  if (new Set(ids).size !== ids.length) idsOk = false;
  const set = new Set(ids);
  (d.match(/(source|target|parent)="([^"]+)"/g) || []).forEach(m => { const v = m.split('"')[1]; if (!set.has(v)) refsOk = false; });
});
ok(idsOk, 'unike celle-ID-er per side');
ok(refsOk, 'alle source/target/parent-referanser finnes');
ok(bm.equipment.size && Array.from(bm.equipment.keys()).every(t => diagrams[0].indexOf('dev-' + t) >= 0), 'side 1 inneholder alt utstyr');
ok(/W-110-210/.test(diagrams[2]) && /SRV-110-01/.test(diagrams[2]) && /CAM-211/.test(diagrams[2]), 'side 3 viser L-001 med kabeltagger');

console.log(`\nResultat: ${pass} OK, ${fail} feil`);
process.exit(fail ? 1 : 0);
