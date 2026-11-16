#!/usr/bin/env node
/*
 * Lager et FIKTIVT eksempel på en «fremmed» eksport fra basisdatasettet, for å demonstrere import og mapping:
 *  data/import-eksempel/*.csv          semikolon, desimalkomma, UTF-8 med BOM (slik norsk Excel lagrer)
 *  data/import-eksempel/eksempel-eksport.xlsx   samme innhold som Excel-ark
 *  data/mal/ece-mal.xlsx               tom Excel-mal med kanoniske ark/kolonner
 * Kolonnenavnene er oppdiktet og er IKKE PATCH MANAGER sitt faktiske format.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ECE = require('../src/core');
const ROOT = path.resolve(__dirname, '..');
const files = {};
ECE.FILES.forEach(n => { files[n + '.csv'] = fs.readFileSync(path.join(ROOT, 'data', 'base', n + '.csv'), 'utf8'); });
const raw = ECE.parseDataset(files);

const TYPE = { switch: 'Svitsj', server: 'Server', camera: 'IP-kamera', operator_station: 'Operatørstasjon', fiber_patch_panel: 'Fiberpanel', copper_patch_panel: 'Kobberpanel' };
const dec = v => v === '' || v == null ? '' : String(v).replace('.', ',');
const sheets = {
  Lokasjoner: [['Rom-ID', 'Romnavn', 'Område']].concat(raw.rooms.map(r => [r.room_id, r.name, r.area])),
  Skap: [['Skap-ID', 'I rom', 'Skapnavn', 'Høyde (HE)']].concat(raw.cabinets.map(r => [r.cabinet_id, r.room_id, r.name, r.height_u])),
  // kameraene har bevisst tom portliste – viser at utledede porter merkes som INFO
  Objekter: [['Objekt-ID', 'Beskrivelse', 'Objekttype', 'System', 'Rom', 'Skap', 'HE-posisjon', 'Porter', 'Modell']].concat(raw.equipment.map(r =>
    [r.tag, r.description, TYPE[r.type] || r.type, r.system, r.room_id, r.cabinet_id, r.rack_u, r.type === 'camera' ? '' : r.ports, r.model])),
  Forbindelser: [['Forbindelse-ID', 'Kategori', 'Fra objekt', 'Fra port', 'Til objekt', 'Til port', 'Kabeltype', 'Lengde (m)']]
    .concat(raw.cables.map(r => [r.cable_tag, 'Kabel', r.from_tag, r.from_port, r.to_tag, r.to_port, r.cable_type, dec(r.length_m)]))
    .concat(raw.patching.map(r => [r.patch_tag, 'Patch', r.from_tag, r.from_port, r.to_tag, r.to_port, r.cable_type, dec(r.length_m)])),
  Paneltilkoblinger: [['Panel', 'Front', 'Bak', 'Merknad']].concat(raw.internal.map(r => [r.tag, r.port_a, r.port_b, r.note])),
  Tjenester: [['Tjeneste-ID', 'Kilde', 'Mål', 'Tjeneste', 'Merknad']].concat(raw.logical_links.map(r => [r.link_id, r.from_tag, r.to_tag, r.service, r.note]))
};

const dir = path.join(ROOT, 'data', 'import-eksempel');
fs.mkdirSync(dir, { recursive: true });
const q = v => /[";\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v == null ? '' : v);
for (const [name, rows] of Object.entries(sheets)) fs.writeFileSync(path.join(dir, name + '.csv'), '﻿' + rows.map(r => r.map(q).join(';')).join('\r\n') + '\r\n');
fs.writeFileSync(path.join(dir, 'eksempel-eksport.xlsx'), ECE.writeXlsx(sheets));
fs.mkdirSync(path.join(ROOT, 'data', 'mal'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'data', 'mal', 'ece-mal.xlsx'), ECE.buildTemplateXlsx(null));
fs.writeFileSync(path.join(ROOT, 'data', 'mal', 'ece-mal-med-eksempel.xlsx'), ECE.buildTemplateXlsx(raw));
console.log('Skrevet data/import-eksempel/ (6 CSV + xlsx) og data/mal/ (Excel-maler)');
