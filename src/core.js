/*
 * Engineering Connection Explorer - kjerne.
 * Ren JavaScript uten avhengigheter: kjøres i Node (CLI), i nettleseren og i n8n Code-noder.
 * Alt er deterministisk: samme CSV-inndata gir samme modell, kontroller, stier og layout.
 */
'use strict';

/* ------------------------------------------------------------------ CSV */

function detectDelimiter(text) {
  const first = String(text).replace(/^\uFEFF/, '').split(/\r?\n/).find(l => l.trim() !== '') || '';
  let inQ = false; const n = { ',': 0, ';': 0, '\t': 0 };
  for (const c of first) { if (c === '"') inQ = !inQ; else if (!inQ && n[c] != null) n[c]++; }
  const best = Object.keys(n).sort((a, b) => n[b] - n[a])[0];
  return n[best] > 0 ? best : ',';
}

function parseCSV(text, fileName, delimiter) {
  const delim = delimiter || detectDelimiter(text);
  const rows = [];
  let i = 0, field = '', row = [], inQ = false, line = 1, rowLine = 1;
  text = String(text).replace(/^﻿/, '');
  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { rows.push({ cells: row, line: rowLine }); row = []; };
  while (i < text.length) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else { if (c === '\n') line++; field += c; }
    } else if (c === '"') inQ = true;
    else if (c === delim) pushField();
    else if (c === '\r') { /* ignorer */ }
    else if (c === '\n') { pushField(); pushRow(); line++; rowLine = line; }
    else field += c;
    i++;
  }
  if (field !== '' || row.length) { pushField(); pushRow(); }
  const data = rows.filter(r => !(r.cells.length === 1 && r.cells[0].trim() === '') && !String(r.cells[0]).startsWith('#'));
  if (!data.length) return [];
  const header = data[0].cells.map(h => h.trim());
  return data.slice(1).map(r => {
    const o = {};
    header.forEach((h, k) => { o[h] = (r.cells[k] == null ? '' : String(r.cells[k])).trim(); });
    Object.defineProperty(o, '__src', { value: { file: fileName || '', line: r.line }, enumerable: false });
    return o;
  });
}

const FILES = ['rooms', 'cabinets', 'equipment', 'cables', 'patching', 'internal', 'logical_links'];

/** files: { 'rooms.csv': text, ... } -> raw tabeller */
function parseDataset(files) {
  const raw = {};
  for (const f of FILES) {
    const name = f + '.csv';
    raw[f] = files[name] != null ? parseCSV(files[name], name) : [];
  }
  return raw;
}

/** "F01-F12;R01-R12" -> [F01..F12, R01..R12]  ,  "1-28" -> ["1".."28"] */
function expandPorts(spec) {
  const out = [];
  for (const part of String(spec || '').split(/[;|]/).map(s => s.trim()).filter(Boolean)) {
    const m = part.match(/^([A-Za-z\/]*)(\d+)-([A-Za-z\/]*)(\d+)$/);
    if (m && m[1] === m[3]) {
      const pad = m[2].length > 1 && m[2].startsWith('0') ? m[2].length : 0;
      for (let n = +m[2]; n <= +m[4]; n++) out.push(m[1] + (pad ? String(n).padStart(pad, '0') : String(n)));
    } else out.push(part);
  }
  return out;
}

/* ------------------------------------------------------------ TYPER */

const TYPES = {
  switch:             { label: 'Svitsj',              active: true,  short: 'SW'  },
  server:             { label: 'Server',              active: true,  short: 'SRV' },
  camera:             { label: 'Kamera',              active: true,  short: 'CAM' },
  operator_station:   { label: 'Operatørstasjon',     active: true,  short: 'OWS' },
  fiber_patch_panel:  { label: 'Fiberpatchpanel',     active: false, short: 'FPP' },
  copper_patch_panel: { label: 'Kobberpatchpanel',    active: false, short: 'CPP' }
};

const SEV_ORDER = { error: 0, warning: 1, info: 2 };
const pk = (tag, port) => tag + '|' + port;

/* ------------------------------------------------- MODELL + KONTROLL */

function buildModel(raw, opts) {
  opts = opts || {};
  const issues = (opts.preIssues || []).slice();
  const src = r => r && r.__src ? r.__src : null;
  const issue = (severity, code, message, refs, row) =>
    issues.push({ severity, code, message, refs: refs || [], source: src(row) });

  const rooms = new Map(), cabinets = new Map(), equipment = new Map();

  for (const r of raw.rooms) {
    if (!r.room_id) { issue('error', 'MISSING_ID', 'Rom uten room_id', [], r); continue; }
    if (rooms.has(r.room_id)) { issue('error', 'DUPLICATE_ID', `Rom ${r.room_id} er registrert flere ganger`, [r.room_id], r); continue; }
    rooms.set(r.room_id, { id: r.room_id, name: r.name, area: r.area, col: r.grid_col === '' || r.grid_col == null || isNaN(+r.grid_col) ? null : +r.grid_col, row: r.grid_row === '' || r.grid_row == null || isNaN(+r.grid_row) ? null : +r.grid_row, src: src(r) });
  }
  for (const r of raw.cabinets) {
    if (cabinets.has(r.cabinet_id)) { issue('error', 'DUPLICATE_ID', `Kabinett ${r.cabinet_id} er registrert flere ganger`, [r.cabinet_id], r); continue; }
    if (!rooms.has(r.room_id)) issue('error', 'UNKNOWN_ROOM', `Kabinett ${r.cabinet_id} viser til ukjent rom «${r.room_id || '(tomt)'}»`, [r.cabinet_id], r);
    cabinets.set(r.cabinet_id, { id: r.cabinet_id, room: r.room_id, name: r.name, heightU: +r.height_u || null, src: src(r) });
  }
  for (const r of raw.equipment) {
    const tag = r.tag;
    if (!tag) { issue('error', 'MISSING_ID', 'Utstyr uten tag', [], r); continue; }
    if (equipment.has(tag)) { issue('error', 'DUPLICATE_ID', `Utstyrstag ${tag} er registrert flere ganger`, [tag], r); continue; }
    const t = TYPES[r.type];
    if (!t) issue('error', 'UNKNOWN_TYPE', `${tag}: ukjent utstyrstype «${r.type}»`, [tag], r);
    const e = {
      tag, description: r.description, type: r.type, typeLabel: t ? t.label : r.type, active: t ? t.active : true,
      system: r.system || '', room: r.room_id || '', cabinet: r.cabinet_id || '', rackU: r.rack_u ? +r.rack_u : null,
      portSpec: r.ports, ports: expandPorts(r.ports), model: r.model || '', src: src(r), problems: []
    };
    if (!e.room) { issue('error', 'MISSING_ROOM', `${tag} mangler rom (room_id er tomt)`, [tag], r); e.problems.push('Mangler rom'); }
    else if (!rooms.has(e.room)) { issue('error', 'UNKNOWN_ROOM', `${tag} viser til ukjent rom «${e.room}»`, [tag], r); e.problems.push('Ukjent rom'); }
    if (e.cabinet) {
      const c = cabinets.get(e.cabinet);
      if (!c) { issue('error', 'UNKNOWN_CABINET', `${tag} viser til ukjent kabinett «${e.cabinet}»`, [tag], r); e.problems.push('Ukjent kabinett'); }
      else if (e.room && c.room !== e.room) { issue('error', 'CABINET_ROOM_MISMATCH', `${tag} står i ${e.cabinet} (rom ${c.room}), men er registrert i rom ${e.room}`, [tag], r); e.problems.push('Kabinett/rom stemmer ikke'); }
    }
    if (!e.system) issue('warning', 'MISSING_SYSTEM', `${tag} mangler system`, [tag], r);
    equipment.set(tag, e);
  }

  /* --- porter: valgfritt utledet fra kabler/patcher/interne når eksporten mangler portliste (alltid synlig som INFO) */
  for (const e of equipment.values()) {
    if (e.ports.length || !opts.derivePorts) continue;
    const ps = new Set();
    raw.cables.concat(raw.patching).forEach(r => { if (r.from_tag === e.tag && r.from_port) ps.add(r.from_port); if (r.to_tag === e.tag && r.to_port) ps.add(r.to_port); });
    raw.internal.forEach(r => { if (r.tag === e.tag) { if (r.port_a) ps.add(r.port_a); if (r.port_b) ps.add(r.port_b); } });
    e.ports = Array.from(ps).sort((a, b) => a.localeCompare(b, 'nb', { numeric: true }));
    e.portsDerived = true;
    if (e.ports.length) issue('info', 'PORTS_DERIVED', `${e.tag}: portliste mangler i kilden – utledet fra registrerte kabler (${e.ports.length} porter)`, [e.tag], e.src ? { __src: e.src } : null);
  }
  for (const e of equipment.values()) if (!e.ports.length) issue('warning', 'MISSING_PORTS', `${e.tag} har ingen porter registrert`, [e.tag], e.src ? { __src: e.src } : null);

  /* --- kabler og patcher: samme struktur, ulik kategori */
  const links = [];
  const linkIds = new Set();
  const addLinks = (rows, kind, idField) => {
    for (const r of rows) {
      const id = r[idField];
      const l = {
        id, kind, a: { tag: r.from_tag, port: r.from_port }, b: { tag: r.to_tag, port: r.to_port },
        cableType: r.cable_type || '', length: r.length_m === '' || r.length_m == null ? null : +r.length_m,
        src: src(r), problems: [], valid: true
      };
      if (!id) { issue('error', 'MISSING_ID', `${kind === 'patch' ? 'Patch' : 'Kabel'} uten tag`, [], r); continue; }
      if (linkIds.has(id)) { issue('error', 'DUPLICATE_ID', `Kabeltag ${id} er registrert flere ganger`, [id], r); continue; }
      linkIds.add(id);
      for (const end of [l.a, l.b]) {
        const e = equipment.get(end.tag);
        if (!end.tag) { issue('error', 'MISSING_ENDPOINT', `${id}: mangler endepunkt`, [id], r); l.valid = false; l.problems.push('Mangler endepunkt'); }
        else if (!e) { issue('error', 'UNKNOWN_ENDPOINT', `${id}: endepunkt ${end.tag} finnes ikke i utstyrslisten`, [id, end.tag], r); l.valid = false; l.problems.push(`Ukjent endepunkt ${end.tag}`); end.unknown = true; }
        else if (!end.port || e.ports.indexOf(end.port) < 0) { issue('error', 'UNKNOWN_PORT', `${id}: port «${end.port}» finnes ikke på ${end.tag}`, [id, end.tag], r); l.valid = false; l.problems.push(`Ukjent port ${end.tag}:${end.port}`); }
      }
      if (!l.cableType) issue('warning', 'MISSING_CABLE_TYPE', `${id}: kabeltype er ikke registrert`, [id], r);
      if (l.length == null || isNaN(l.length)) { l.length = null; issue('warning', 'MISSING_LENGTH', `${id}: lengde er ikke registrert`, [id], r); l.problems.push('Lengde mangler'); }
      links.push(l);
    }
  };
  addLinks(raw.cables, 'cable', 'cable_tag');
  addLinks(raw.patching, 'patch', 'patch_tag');

  /* --- portbruk: hver port kan ha maks én kabel/patch */
  const portLink = new Map();
  for (const l of links) {
    if (!l.valid) continue;
    for (const end of [l.a, l.b]) {
      const k = pk(end.tag, end.port);
      if (portLink.has(k)) {
        const first = portLink.get(k);
        issue('error', 'PORT_DOUBLE_USE', `Port ${end.tag}:${end.port} brukes av både ${first.id} og ${l.id}`, [end.tag, first.id, l.id], l.src ? { __src: l.src } : null);
        l.valid = false; l.problems.push(`Port ${end.tag}:${end.port} er allerede brukt av ${first.id}`);
        first.problems.push(`Port ${end.tag}:${end.port} er også brukt av ${l.id}`); first.conflict = true;
      }
    }
    if (l.valid) for (const end of [l.a, l.b]) portLink.set(pk(end.tag, end.port), l);
  }
  for (const l of links) if (l.src && issues.some(x => x.code === 'PORT_DOUBLE_USE' && x.refs.indexOf(l.id) >= 0 && !x.source)) { /* noop */ }

  /* --- interne forbindelser i patchpaneler */
  const internal = new Map();
  const internals = [];
  for (const r of raw.internal) {
    const e = equipment.get(r.tag);
    const ref = `${r.tag}:${r.port_a}↔${r.port_b}`;
    if (!e) { issue('error', 'UNKNOWN_ENDPOINT', `Intern forbindelse ${ref}: ${r.tag} finnes ikke`, [r.tag], r); continue; }
    if (e.active) { issue('error', 'INTERNAL_ON_ACTIVE', `Intern forbindelse ${ref}: ${r.tag} er aktivt utstyr, ikke et panel`, [r.tag], r); continue; }
    let ok = true;
    for (const p of [r.port_a, r.port_b]) {
      if (e.ports.indexOf(p) < 0) { issue('error', 'UNKNOWN_PORT', `Intern forbindelse ${ref}: port «${p}» finnes ikke`, [r.tag], r); ok = false; }
      else if (internal.has(pk(r.tag, p))) { issue('error', 'PORT_DOUBLE_USE', `Intern forbindelse ${ref}: port ${p} har allerede en intern forbindelse`, [r.tag], r); ok = false; }
    }
    if (!ok) continue;
    internal.set(pk(r.tag, r.port_a), r.port_b);
    internal.set(pk(r.tag, r.port_b), r.port_a);
    internals.push({ tag: r.tag, a: r.port_a, b: r.port_b, note: r.note || '', src: src(r) });
  }

  const model = { rooms, cabinets, equipment, links, linkById: new Map(links.map(l => [l.id, l])), portLink, internal, internals, issues, logical: [] };

  /* --- fysiske kanaler (sporing gjennom passive paneler) */
  model.channels = computeChannels(model);
  for (const ch of model.channels) {
    for (const end of [ch.ends[0], ch.ends[1]]) {
      if (end.status === 'open') issue('warning', 'OPEN_END', `Registrert sti ender åpent i ${end.tag}:${end.port} — ${end.reason}`, [end.tag].concat(ch.links), null);
    }
  }

  /* --- logiske forbindelser (holdes adskilt fra fysisk kabling) */
  for (const r of raw.logical_links) {
    const lg = { id: r.link_id, from: r.from_tag, to: r.to_tag, service: r.service || '', note: r.note || '', src: src(r) };
    const unknown = [lg.from, lg.to].filter(t => !equipment.has(t));
    if (unknown.length) { issue('error', 'UNKNOWN_ENDPOINT', `Logisk forbindelse ${lg.id}: ukjent endepunkt ${unknown.join(', ')}`, [lg.id].concat(unknown), r); lg.route = null; }
    else {
      lg.route = findRoute(model, lg.from, lg.to);
      if (!lg.route) issue('warning', 'NO_PHYSICAL_ROUTE', `Logisk forbindelse ${lg.id} (${lg.from} → ${lg.to}): ingen registrert fysisk kjede funnet`, [lg.id, lg.from, lg.to], r);
    }
    model.logical.push(lg);
  }

  issues.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || a.code.localeCompare(b.code) || a.message.localeCompare(b.message));
  model.summary = {
    rooms: rooms.size, cabinets: cabinets.size, equipment: equipment.size,
    cables: links.filter(l => l.kind === 'cable').length, patches: links.filter(l => l.kind === 'patch').length,
    internal: internals.length, channels: model.channels.length,
    errors: issues.filter(i => i.severity === 'error').length,
    warnings: issues.filter(i => i.severity === 'warning').length,
    infos: issues.filter(i => i.severity === 'info').length
  };
  return model;
}

/* --------------------------------------------------- STISPORING */

function otherEnd(link, end) {
  return (link.a.tag === end.tag && link.a.port === end.port) ? link.b : link.a;
}

/**
 * Følger en kabel/patch i begge retninger gjennom registrerte interne
 * panelforbindelser til den når aktivt utstyr, en åpen ende eller ukjent utstyr.
 * Returnerer { nodes:[{tag,port}], conns:[{kind,id}], ends:[endA,endB] }.
 */
function walkFromLink(model, link) {
  const walk = (start, via) => {
    const nodes = [], conns = [];
    let cur = start, seen = new Set([via.id]);
    for (let guard = 0; guard < 200; guard++) {
      const e = model.equipment.get(cur.tag);
      if (!e) return { nodes, conns, end: { tag: cur.tag, port: cur.port, status: 'unknown', reason: 'Ukjent utstyr' } };
      if (e.active) return { nodes, conns, end: { tag: cur.tag, port: cur.port, status: 'ok' } };
      const ip = model.internal.get(pk(cur.tag, cur.port));
      if (!ip) return { nodes, conns, end: { tag: cur.tag, port: cur.port, status: 'open', reason: `intern forbindelse for port ${cur.port} er ikke registrert` } };
      const next = { tag: cur.tag, port: ip };
      const l = model.portLink.get(pk(next.tag, next.port));
      if (!l) {
        nodes.push(next); conns.push({ kind: 'internal', id: `${cur.tag}:${cur.port}↔${ip}` });
        return { nodes, conns, end: { tag: next.tag, port: next.port, status: 'open', reason: `ingen kabel/patch registrert på port ${ip}` } };
      }
      if (seen.has(l.id)) return { nodes, conns, end: { tag: cur.tag, port: cur.port, status: 'open', reason: 'sløyfe i registrerte data' } };
      seen.add(l.id);
      nodes.push(next); conns.push({ kind: 'internal', id: `${cur.tag}:${cur.port}↔${ip}` });
      const o = otherEnd(l, next);
      nodes.push({ tag: o.tag, port: o.port }); conns.push({ kind: l.kind, id: l.id });
      cur = o;
    }
    return { nodes, conns, end: { tag: cur.tag, port: cur.port, status: 'open', reason: 'for lang kjede' } };
  };
  const right = walk(link.b, link);
  const left = walk(link.a, link);
  // venstre del reverseres: [..., a] + link + [b, ...]
  const nodes = left.nodes.slice().reverse().concat([{ tag: link.a.tag, port: link.a.port }, { tag: link.b.tag, port: link.b.port }], right.nodes);
  const conns = left.conns.slice().reverse().concat([{ kind: link.kind, id: link.id }], right.conns);
  // ved venstre del: nodes = [nL ... n1, a] men conns mellom dem må speiles korrekt
  return { nodes, conns, ends: [left.end, right.end] };
}

function computeChannels(model) {
  const covered = new Set();
  const channels = [];
  const sorted = model.links.filter(l => l.valid).slice().sort((x, y) => x.id.localeCompare(y.id));
  for (const l of sorted) {
    if (covered.has(l.id)) continue;
    let w = walkFromLink(model, l);
    // orientering: endeutstyr først, svitsj sist; mellom to svitsjer: aksess før kjerne (høyere tag først)
    const rank = end => {
      const e = model.equipment.get(end.tag);
      if (!e) return 0;
      return e.type === 'switch' ? 2 : 1;
    };
    const [ea, eb] = w.ends;
    const flip = rank(ea) > rank(eb) || (rank(ea) === rank(eb) && ea.tag < eb.tag);
    if (flip) w = { nodes: w.nodes.slice().reverse(), conns: w.conns.slice().reverse(), ends: [eb, ea] };
    const linkIds = w.conns.filter(c => c.kind !== 'internal').map(c => c.id);
    linkIds.forEach(id => covered.add(id));
    channels.push({
      id: 'CH-' + String(channels.length + 1).padStart(3, '0'),
      nodes: w.nodes, conns: w.conns, ends: w.ends, links: linkIds,
      tags: Array.from(new Set(w.nodes.map(n => n.tag))),
      complete: w.ends.every(e => e.status === 'ok')
    });
  }
  // stabile ID-er: sorter etter første endepunkt
  channels.sort((x, y) => (x.ends[0].tag + x.ends[0].port).localeCompare(y.ends[0].tag + y.ends[0].port, 'nb', { numeric: true }));
  channels.forEach((c, i) => { c.id = 'CH-' + String(i + 1).padStart(3, '0'); });
  return channels;
}

/**
 * Finner en registrert fysisk kjede mellom to aktive enheter (BFS over komplette kanaler).
 * Kun svitsjer kan være mellomledd. Sier ingenting om konfigurasjon/VLAN.
 */
function findRoute(model, fromTag, toTag, excludeLinks) {
  excludeLinks = excludeLinks || new Set();
  const adj = new Map();
  for (const ch of model.channels) {
    if (!ch.complete || ch.links.some(id => excludeLinks.has(id))) continue;
    const a = ch.ends[0].tag, b = ch.ends[1].tag;
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push({ to: b, ch, dir: 1 });
    adj.get(b).push({ to: a, ch, dir: -1 });
  }
  const prev = new Map([[fromTag, null]]);
  const queue = [fromTag];
  while (queue.length) {
    const t = queue.shift();
    if (t === toTag) break;
    const e = model.equipment.get(t);
    if (t !== fromTag && (!e || e.type !== 'switch')) continue;
    const nb = (adj.get(t) || []).slice().sort((x, y) => x.ch.id.localeCompare(y.ch.id));
    for (const n of nb) if (!prev.has(n.to)) { prev.set(n.to, { from: t, ch: n.ch, dir: n.dir }); queue.push(n.to); }
  }
  if (!prev.has(toTag)) return null;
  const steps = [];
  for (let t = toTag; prev.get(t); t = prev.get(t).from) steps.unshift(prev.get(t));
  return steps.map(s => ({ channel: s.ch.id, reversed: s.dir < 0 }));
}

/** Sammenhengende hopp-liste for en rute (brukes i side 3 og i nettleseren). */
function routeHops(model, route) {
  const nodes = [], conns = [];
  route.forEach((step, i) => {
    const ch = model.channels.find(c => c.id === step.channel);
    let n = ch.nodes, c = ch.conns;
    if (step.reversed) { n = n.slice().reverse(); c = c.slice().reverse(); }
    if (i > 0) conns.push({ kind: 'through', id: 'via ' + n[0].tag });
    n.forEach(x => nodes.push(x));
    c.forEach(x => conns.push(x));
  });
  return { nodes, conns };
}

/* -------------------------------------- SIMULERT KABELFJERNING */

function removalImpact(model, linkId) {
  const brokenChannels = model.channels.filter(ch => ch.links.indexOf(linkId) >= 0);
  const ex = new Set([linkId]);
  const logical = model.logical.filter(lg => lg.route).map(lg => {
    const usesIt = lg.route.some(s => brokenChannels.some(c => c.id === s.channel));
    if (!usesIt) return null;
    const alt = findRoute(model, lg.from, lg.to, ex);
    return { id: lg.id, from: lg.from, to: lg.to, service: lg.service, alternative: alt };
  }).filter(Boolean);
  return { linkId, brokenChannels: brokenChannels.map(c => c.id), logical };
}

/* --------------------------------------------------------- DIFF */

function diffModels(a, b) {
  const changes = [];
  const cmp = (kind, mapA, mapB, fields, label) => {
    const keys = Array.from(new Set(Array.from(mapA.keys()).concat(Array.from(mapB.keys())))).sort();
    for (const k of keys) {
      const x = mapA.get(k), y = mapB.get(k);
      if (x && !y) changes.push({ change: 'removed', kind, id: k, label: label(x) });
      else if (!x && y) changes.push({ change: 'added', kind, id: k, label: label(y) });
      else {
        const diffs = fields.map(f => ({ field: f[0], name: f[1], before: f[2](x), after: f[2](y) })).filter(d => String(d.before) !== String(d.after));
        if (diffs.length) changes.push({ change: 'changed', kind, id: k, label: label(y), fields: diffs });
      }
    }
  };
  const end = e => `${e.tag}:${e.port}`;
  cmp('equipment', a.equipment, b.equipment, [
    ['room', 'Rom', e => e.room], ['cabinet', 'Kabinett', e => e.cabinet], ['rackU', 'U-posisjon', e => e.rackU == null ? '' : e.rackU],
    ['type', 'Type', e => e.type], ['system', 'System', e => e.system], ['description', 'Beskrivelse', e => e.description], ['portSpec', 'Porter', e => e.portSpec]
  ], e => `${e.tag} ${e.description}`);
  cmp('link', a.linkById, b.linkById, [
    ['from', 'Fra', l => end(l.a)], ['to', 'Til', l => end(l.b)], ['cableType', 'Type', l => l.cableType], ['length', 'Lengde (m)', l => l.length == null ? '' : l.length]
  ], l => `${l.id} ${end(l.a)} → ${end(l.b)}`);
  const im = m => new Map(m.internals.map(i => [`${i.tag}:${i.a}↔${i.b}`, i]));
  cmp('internal', im(a), im(b), [], i => `${i.tag} ${i.a}↔${i.b}`);
  const lm = m => new Map(m.logical.map(l => [l.id, l]));
  cmp('logical', lm(a), lm(b), [['from', 'Fra', l => l.from], ['to', 'Til', l => l.to], ['service', 'Tjeneste', l => l.service]], l => `${l.id} ${l.from} → ${l.to}`);
  // kanaler: sammenlign som tekst (fra → til via kabler)
  const chm = m => new Map(m.channels.map(c => [channelText(c), c]));
  const ca = chm(a), cb = chm(b);
  const channelChanges = {
    removed: Array.from(ca.keys()).filter(k => !cb.has(k)).sort(),
    added: Array.from(cb.keys()).filter(k => !ca.has(k)).sort()
  };
  const count = c => changes.filter(x => x.change === c).length;
  return { changes, channelChanges, summary: { added: count('added'), removed: count('removed'), changed: count('changed') } };
}

function channelText(ch) {
  const e = x => `${x.tag}:${x.port}` + (x.status === 'ok' ? '' : ` [${x.status === 'open' ? 'åpen' : 'ukjent'}]`);
  return `${e(ch.ends[0])} → ${e(ch.ends[1])} via ${ch.links.join(', ')}`;
}

/* ======================================================== LAYOUT */
/*
 * Deterministisk rutenett-layout:
 *  - rom plasseres etter grid_col/grid_row fra rooms.csv
 *  - kabinetter i rommet i ID-rekkefølge, utstyr i kabinett etter U-posisjon (høyest øverst)
 *  - utstyr uten kabinett får faste plasser (slots) fra en låsefil, slik at
 *    eksisterende objekter beholder plass når data endres
 *  - forbindelser rutes ortogonalt med A* på et 10 px rutenett med straff for
 *    knekk, overlapp og kryssing.
 */

const L = {
  grid: 10, devW: 140, devH: 40, devGap: 10, cabPad: 40, cabHead: 30, roomHead: 50, roomPad: 20,
  slotW: 150, fieldH: 40, minSlots: 3, gapX: 70, gapY: 70, margin: 30
};

function layoutModel(model, lockIn) {
  const lock = JSON.parse(JSON.stringify(lockIn || { slots: {} }));
  lock.slots = lock.slots || {};
  // rom uten grid_col/grid_row får første ledige plass (3 per rad), sortert på ID – deterministisk
  const roomsAll = Array.from(model.rooms.values()).map(r => Object.assign({}, r));
  const usedCells = new Set(roomsAll.filter(r => r.col != null && r.row != null).map(r => r.col + ',' + r.row));
  roomsAll.filter(r => r.col == null || r.row == null).sort((a, b) => a.id.localeCompare(b.id)).forEach(r => {
    let k = 0; while (usedCells.has((k % 3) + ',' + Math.floor(k / 3))) k++;
    r.col = k % 3; r.row = Math.floor(k / 3); usedCells.add(r.col + ',' + r.row);
  });
  const roomList = roomsAll.sort((a, b) => a.row - b.row || a.col - b.col || a.id.localeCompare(b.id));
  const byRoom = new Map(roomList.map(r => [r.id, { cabs: [], field: [] }]));
  const ORPHAN = '__ORPHAN__';
  byRoom.set(ORPHAN, { cabs: [], field: [] });

  const cabEquip = new Map();
  for (const c of Array.from(model.cabinets.values()).sort((a, b) => a.id.localeCompare(b.id))) {
    if (byRoom.has(c.room)) byRoom.get(c.room).cabs.push(c);
    cabEquip.set(c.id, []);
  }
  for (const e of Array.from(model.equipment.values()).sort((a, b) => a.tag.localeCompare(b.tag, 'nb', { numeric: true }))) {
    const c = e.cabinet && model.cabinets.get(e.cabinet);
    if (c && byRoom.has(c.room) && c.room === e.room) cabEquip.get(c.id).push(e);
    else if (byRoom.has(e.room) && !e.cabinet) byRoom.get(e.room).field.push(e);
    else byRoom.get(ORPHAN).field.push(e);
  }
  // ukjente endepunkter (fra kabler) vises som plassholdere
  const unknownTags = [];
  for (const l of model.links) for (const end of [l.a, l.b]) if (end.unknown && unknownTags.indexOf(end.tag) < 0) unknownTags.push(end.tag);
  unknownTags.sort().forEach(t => byRoom.get(ORPHAN).field.push({ tag: t, description: 'Finnes ikke i utstyrslisten', type: 'unknown', placeholder: true, room: '', ports: [] }));

  // slots for feltutstyr: behold låste plasser, nye får første ledige
  for (const [roomId, g] of byRoom) {
    const taken = new Set();
    const keep = [], fresh = [];
    for (const e of g.field) {
      const s = lock.slots[e.tag];
      if (s && s.room === roomId && !taken.has(s.slot)) { taken.add(s.slot); keep.push(e); e._slot = s.slot; }
      else fresh.push(e);
    }
    for (const e of fresh) { let k = 0; while (taken.has(k)) k++; taken.add(k); e._slot = k; lock.slots[e.tag] = { room: roomId, slot: k }; }
  }

  // størrelser
  const cabW = L.devW + 2 * L.cabPad;
  const cabH = c => L.cabHead + Math.max(1, cabEquip.get(c.id).length) * (L.devH + L.devGap) + 20;
  const roomInfo = new Map();
  for (const [roomId, g] of byRoom) {
    // reserverte plasser i låsefilen holdes av, slik at rommet ikke krymper når utstyr flyttes ut
    const lockMax = Object.keys(lockIn && lockIn.slots || {}).reduce((m, t) => lockIn.slots[t].room === roomId ? Math.max(m, lockIn.slots[t].slot) : m, -1);
    const maxSlot = g.field.reduce((m, e) => Math.max(m, e._slot), lockMax);
    const nSlots = Math.max(L.minSlots, maxSlot + 1);
    const cabsW = g.cabs.length * cabW + Math.max(0, g.cabs.length - 1) * 40;
    const w = Math.max(nSlots * L.slotW - (L.slotW - L.devW), cabsW) + 2 * L.roomPad;
    const ch = g.cabs.reduce((m, c) => Math.max(m, cabH(c)), 0);
    const h = L.roomHead + (ch ? ch + 50 : 0) + (g.field.length ? L.fieldH + 30 : 0) + 10;
    roomInfo.set(roomId, { w, h, cabsW, cabH: ch, nSlots });
  }
  // kolonnebredder og radhøyder
  const colW = {}, rowH = {};
  for (const r of roomList) {
    const i = roomInfo.get(r.id);
    colW[r.col] = Math.max(colW[r.col] || 0, i.w);
    rowH[r.row] = Math.max(rowH[r.row] || 0, i.h);
  }
  const cols = Object.keys(colW).map(Number).sort((a, b) => a - b);
  const rows = Object.keys(rowH).map(Number).sort((a, b) => a - b);
  const colX = {}, rowY = {};
  let x = L.margin; for (const c of cols) { colX[c] = x; x += colW[c] + L.gapX; }
  let y = L.margin + 30; for (const r of rows) { rowY[r] = y; y += rowH[r] + L.gapY; }

  const snap = v => Math.round(v / L.grid) * L.grid;
  const out = { rooms: [], cabinets: [], nodes: [], edges: [], labels: [], width: 0, height: 0 };
  const node = new Map();

  const placeRoom = (roomId, rx, ry, rw, rh, title, sub, orphan) => {
    const g = byRoom.get(roomId);
    out.rooms.push({ id: roomId, x: rx, y: ry, w: rw, h: rh, title, sub, orphan: !!orphan });
    const info = roomInfo.get(roomId);
    // kabinetter forankres mot venstre (sentrert over minste antall plasser), slik at
    // et rom som får flere feltenheter bare vokser mot høyre – eksisterende objekter står stille
    const baseW = Math.max(L.minSlots * L.slotW - (L.slotW - L.devW), info.cabsW);
    let cx = snap(rx + L.roomPad + (baseW - info.cabsW) / 2);
    const cy = ry + L.roomHead;
    for (const c of g.cabs) {
      const ce = cabEquip.get(c.id).slice().sort((a, b) => (b.rackU || 0) - (a.rackU || 0) || a.tag.localeCompare(b.tag));
      const h = snap(cabH(c));
      out.cabinets.push({ id: c.id, room: roomId, x: cx, y: cy, w: cabW, h, title: `${c.id}  ${c.name || ''}`.trim() });
      ce.forEach((e, k) => {
        const n = { tag: e.tag, x: cx + L.cabPad, y: cy + L.cabHead + k * (L.devH + L.devGap), w: L.devW, h: L.devH, room: roomId, cabinet: c.id, type: e.type, system: e.system || '' };
        node.set(e.tag, n); out.nodes.push(n);
      });
      cx += cabW + 40;
    }
    const fy = snap(ry + rh - L.fieldH - 30);
    const fx0 = snap(rx + L.roomPad);
    for (const e of g.field) {
      const n = { tag: e.tag, x: fx0 + e._slot * L.slotW, y: fy, w: L.devW, h: L.fieldH, room: roomId, cabinet: '', type: e.type, system: e.system || '', placeholder: !!e.placeholder, field: true };
      node.set(e.tag, n); out.nodes.push(n);
    }
  };
  for (const r of roomList) {
    const rx = colX[r.col], ry = rowY[r.row];
    placeRoom(r.id, rx, ry, colW[r.col], rowH[r.row], `${r.id}  ${r.name}`, r.area || '');
  }
  const orphanG = byRoom.get(ORPHAN);
  if (orphanG.field.length) {
    // plasser nederst til venstre, under siste rad
    const free = cols.find(c => !roomList.some(r => r.col === c && r.row === rows[rows.length - 1])) ;
    const ox = free != null ? colX[free] : L.margin;
    const oy = free != null ? rowY[rows[rows.length - 1]] : y;
    const ow = free != null ? colW[free] : roomInfo.get(ORPHAN).w;
    placeRoom(ORPHAN, ox, oy, ow, roomInfo.get(ORPHAN).h, 'Uten gyldig rom / ukjent', 'Mangler eller ugyldig plassering i datasettet', true);
  }
  out.width = Math.max.apply(null, [400].concat(out.rooms.map(r => r.x + r.w))) + L.margin;
  out.height = Math.max.apply(null, [200].concat(out.rooms.map(r => r.y + r.h))) + L.margin;

  /* --- kanter: én kant per enhetspar (aggregert), rutet med A* */
  const pairs = new Map();
  for (const l of model.links) {
    const ta = l.a.tag, tb = l.b.tag;
    if (!node.has(ta) || !node.has(tb) || ta === tb) continue;
    const key = [ta, tb].sort().join('~');
    if (!pairs.has(key)) pairs.set(key, { id: 'E:' + key, a: [ta, tb].sort()[0], b: [ta, tb].sort()[1], links: [] });
    pairs.get(key).links.push(l.id);
  }
  const edgeList = Array.from(pairs.values());
  const dist = e => { const A = node.get(e.a), B = node.get(e.b); return Math.abs(A.x - B.x) + Math.abs(A.y - B.y); };
  edgeList.sort((p, q) => dist(p) - dist(q) || p.id.localeCompare(q.id));
  const router = makeRouter(out.width, out.height, out.nodes, out.cabinets.map(c => ({ x: c.x, y: c.y, w: c.w, h: L.cabHead - 10 })).concat(out.rooms.map(r => ({ x: r.x, y: r.y, w: r.w, h: L.roomHead - 20 })))
    .concat([].concat.apply([], out.rooms.map(r => [{ x: r.x, y: r.y, w: 0, h: r.h }, { x: r.x + r.w, y: r.y, w: 0, h: r.h }, { x: r.x, y: r.y + r.h, w: r.w, h: 0 }]))));
  const routes = new Map();
  for (const e of edgeList) routes.set(e.id, router.route(node.get(e.a), node.get(e.b)));
  // rip-up and reroute: kanter med kryssinger rutes på nytt mens de andre ligger fast
  for (let pass = 0; pass < 3; pass++) {
    let improved = false;
    for (const e of edgeList) {
      const old = routes.get(e.id);
      const before = crossingsOf(e.id, old, routes);
      if (!before) continue;
      router.unmark(old);
      const alt = router.route(node.get(e.a), node.get(e.b));
      if (crossingsOf(e.id, alt, routes) < before) { routes.set(e.id, alt); improved = true; }
      else { router.unmark(alt); router.remark(old); }
    }
    if (!improved) break;
  }
  for (const e of edgeList) {
    const pts = routes.get(e.id);
    const ls = e.links.map(id => model.linkById.get(id));
    const kinds = Array.from(new Set(ls.map(l => l.kind)));
    const fiber = ls.some(l => /OS2|OM\d|LC|fiber|SM/i.test(l.cableType));
    const bad = ls.some(l => !l.valid || l.conflict);
    const sameCab = node.get(e.a).cabinet && node.get(e.a).cabinet === node.get(e.b).cabinet;
    out.edges.push({ id: e.id, a: e.a, b: e.b, links: e.links.slice().sort(), points: pts.map(p => ({ x: p.x, y: p.y })), kind: kinds.length === 1 ? kinds[0] : 'mixed', fiber, bad, sameCab });
  }
  out.edges.sort((p, q) => p.id.localeCompare(q.id));

  /* --- etiketter: kabeltag på lengste segment, kun hvis det ikke kolliderer */
  const placed = out.nodes.map(n => ({ x: n.x - 4, y: n.y - 4, w: n.w + 8, h: n.h + 8 }));
  const hit = (r) => placed.some(p => r.x < p.x + p.w && r.x + r.w > p.x && r.y < p.y + p.h && r.y + r.h > p.y);
  for (const e of out.edges) {
    if (e.sameCab) continue;
    const text = e.links.length === 1 ? e.links[0] : `${e.links[0]} +${e.links.length - 1}`;
    const tw = text.length * 6.4 + 8, th = 14;
    const segs = [];
    for (let k = 0; k < e.points.length - 1; k++) {
      const p = e.points[k], q = e.points[k + 1];
      segs.push({ p, q, len: Math.abs(p.x - q.x) + Math.abs(p.y - q.y), h: p.y === q.y });
    }
    segs.sort((s, t) => (t.h - s.h) || t.len - s.len);
    for (const s of segs) {
      const mx = (s.p.x + s.q.x) / 2, my = (s.p.y + s.q.y) / 2;
      const cands = s.h
        ? [{ x: mx - tw / 2, y: my - th - 2 }, { x: mx - tw / 2, y: my + 3 }]
        : [{ x: mx + 4, y: my - th / 2 }, { x: mx - tw - 4, y: my - th / 2 }];
      if ((s.h ? Math.abs(s.p.x - s.q.x) : Math.abs(s.p.y - s.q.y)) < (s.h ? tw + 10 : th + 10)) continue;
      const c = cands.find(r => !hit({ x: r.x, y: r.y, w: tw, h: th }));
      if (c) { const r = { x: c.x, y: c.y, w: tw, h: th }; placed.push(r); out.labels.push({ edge: e.id, text, x: c.x, y: c.y, w: tw, h: th }); break; }
    }
  }
  return { layout: out, lock };
}

/* ------------------------------------------- ORTOGONAL RUTER (A*) */

function segsOf(pts) { const r = []; for (let i = 0; i < pts.length - 1; i++) r.push([pts[i], pts[i + 1]]); return r; }
function segCross(s, t) {
  const sh = s[0].y === s[1].y, th = t[0].y === t[1].y;
  if (sh === th) return false;
  const h = sh ? s : t, v = sh ? t : s;
  const x = v[0].x, y = h[0].y;
  const hx0 = Math.min(h[0].x, h[1].x), hx1 = Math.max(h[0].x, h[1].x), vy0 = Math.min(v[0].y, v[1].y), vy1 = Math.max(v[0].y, v[1].y);
  return x > hx0 && x < hx1 && y > vy0 && y < vy1;
}
function crossingsOf(id, pts, routes) {
  let n = 0; const mine = segsOf(pts);
  for (const [k, other] of routes) { if (k === id) continue; for (const t of segsOf(other)) for (const s of mine) if (segCross(s, t)) n++; }
  return n;
}

function makeRouter(width, height, nodes, softRects) {
  const G = 10;
  const W = Math.ceil(width / G) + 2, H = Math.ceil(height / G) + 2;
  const idx = (x, y) => y * W + x;
  const blockedBy = new Int32Array(W * H).fill(-1); // indeks til node (inkl. 10 px margin)
  const inside = new Int32Array(W * H).fill(-1);
  nodes.forEach((n, i) => {
    const x0 = n.x / G, y0 = n.y / G, x1 = (n.x + n.w) / G, y1 = (n.y + n.h) / G;
    for (let y = y0 - 1; y <= y1 + 1; y++) for (let x = x0 - 1; x <= x1 + 1; x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      blockedBy[idx(x, y)] = i;
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1) inside[idx(x, y)] = i;
    }
  });
  const soft = new Uint8Array(W * H); // titler: kan krysses, men dyrt
  (softRects || []).forEach(r => {
    for (let y = Math.floor(r.y / G); y <= Math.ceil((r.y + r.h) / G); y++) for (let x = Math.floor(r.x / G); x <= Math.ceil((r.x + r.w) / G); x++)
      if (x >= 0 && y >= 0 && x < W && y < H) soft[idx(x, y)] = 1;
  });
  const usedH = new Int16Array(W * H), usedV = new Int16Array(W * H);
  const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
  const nodeIndex = new Map(nodes.map((n, i) => [n, i]));

  function sidePoints(n, out) {
    // punkter rett utenfor sidene (ikke hjørner), med retning ut fra boksen
    const x0 = n.x / G, y0 = n.y / G, x1 = (n.x + n.w) / G, y1 = (n.y + n.h) / G;
    const pts = [];
    for (let y = y0 + 1; y <= y1 - 1; y++) { pts.push({ x: x1 + 1, y, d: 0, bx: x1 }); pts.push({ x: x0 - 1, y, d: 2, bx: x0 }); }
    for (let x = x0 + 2; x <= x1 - 2; x++) { pts.push({ x, y: y1 + 1, d: 1, by: y1 }); pts.push({ x, y: y0 - 1, d: 3, by: y0 }); }
    return pts;
  }

  function route(A, B) {
    const ia = nodeIndex.get(A), ib = nodeIndex.get(B);
    const free = (x, y) => {
      if (x < 0 || y < 0 || x >= W || y >= H) return false;
      const k = idx(x, y);
      if (inside[k] === ia || inside[k] === ib) return false;
      const b = blockedBy[k];
      return b < 0 || b === ia || b === ib;
    };
    const goal = new Map();
    for (const p of sidePoints(B)) if (free(p.x, p.y)) goal.set(idx(p.x, p.y), p);
    const tx = (B.x + B.w / 2) / G, ty = (B.y + B.h / 2) / G;
    const N = W * H * 4;
    const gScore = new Float64Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const heap = [];
    const push = (s, f) => { heap.push([f, s]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    const hfun = (x, y) => Math.max(0, Math.abs(x - tx) - B.w / G / 2) + Math.max(0, Math.abs(y - ty) - B.h / G / 2);
    const starts = new Map();
    for (const p of sidePoints(A)) {
      if (!free(p.x, p.y)) continue;
      const s = idx(p.x, p.y) * 4 + p.d;
      const c = stepCost(p.x, p.y, p.d) + 2;
      if (c < gScore[s]) { gScore[s] = c; starts.set(s, p); push(s, c + hfun(p.x, p.y)); }
    }
    function stepCost(x, y, d) {
      const k = idx(x, y);
      const horiz = d === 0 || d === 2;
      let c = 1;
      if (horiz ? usedH[k] : usedV[k]) c += 60;          // overlapp med annen ledning
      else if (horiz ? usedV[k] : usedH[k]) c += 30;     // kryssing
      // hold avstand til parallelle ledninger
      const nx = horiz ? 0 : 1, ny = horiz ? 1 : 0;
      for (const sgn of [-1, 1]) {
        const xx = x + nx * sgn, yy = y + ny * sgn;
        if (xx >= 0 && yy >= 0 && xx < W && yy < H) { const kk = idx(xx, yy); if (horiz ? usedH[kk] : usedV[kk]) c += 4; }
      }
      if (blockedBy[k] >= 0) c += 1;
      if (soft[k]) c += 25;
      return c;
    }
    let end = -1;
    let iter = 0;
    while (heap.length && iter++ < 400000) {
      const [f, s] = pop();
      const cell = s >> 2, d = s & 3;
      const g = gScore[s];
      if (f - hfun(cell % W, (cell / W) | 0) > g + 1e-9) continue;
      const x = cell % W, y = (cell / W) | 0;
      if (goal.has(cell)) {
        const gp = goal.get(cell);
        // må gå inn vinkelrett på målsiden
        if (d === (gp.d + 2) % 4) { end = s; break; }
      }
      for (let nd = 0; nd < 4; nd++) {
        if (nd === (d + 2) % 4) continue;
        const nx = x + DX[nd], ny = y + DY[nd];
        if (!free(nx, ny)) continue;
        const ns = idx(nx, ny) * 4 + nd;
        const c = g + stepCost(nx, ny, nd) + (nd !== d ? 12 : 0);
        if (c < gScore[ns]) { gScore[ns] = c; came[ns] = s; push(ns, c + hfun(nx, ny)); }
      }
    }
    if (end < 0) {
      // reserve: enkel L-form mellom sentre
      const a = { x: A.x + A.w, y: A.y + A.h / 2 }, b = { x: B.x, y: B.y + B.h / 2 };
      return [a, { x: (a.x + b.x) / 2, y: a.y }, { x: (a.x + b.x) / 2, y: b.y }, b];
    }
    const cells = [];
    for (let s = end; s >= 0; s = came[s]) { cells.push(s); if (starts.has(s)) break; }
    cells.reverse();
    mark(cells, 1);
    const pts = cells.map(s => ({ x: ((s >> 2) % W) * G, y: (((s >> 2) / W) | 0) * G }));
    // forleng til boksens kant
    const sp = starts.get(cells[0]);
    const first = sp.d === 0 || sp.d === 2 ? { x: sp.bx * G, y: pts[0].y } : { x: pts[0].x, y: sp.by * G };
    const gp = goal.get(cells[cells.length - 1] >> 2);
    const lastP = pts[pts.length - 1];
    const last = gp.d === 0 || gp.d === 2 ? { x: gp.bx * G, y: lastP.y } : { x: lastP.x, y: gp.by * G };
    const all = [first].concat(pts, [last]);
    // fjern kolineære punkter
    const simp = [all[0]];
    for (let i = 1; i < all.length - 1; i++) {
      const p = simp[simp.length - 1], q = all[i], r = all[i + 1];
      if ((p.x === q.x && q.x === r.x) || (p.y === q.y && q.y === r.y)) continue;
      simp.push(q);
    }
    simp.push(all[all.length - 1]);
    Object.defineProperty(simp, 'cells', { value: cells, enumerable: false });
    return simp;
  }
  function mark(cells, delta) {
    if (!cells) return;
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i] >> 2, d = cells[i] & 3;
      const turn = i > 0 && (cells[i - 1] & 3) !== d;
      if (d === 0 || d === 2 || turn) usedH[cell] += delta;
      if (d === 1 || d === 3 || turn) usedV[cell] += delta;
    }
  }
  return { route, unmark: pts => mark(pts.cells, -1), remark: pts => mark(pts.cells, 1) };
}

/* ======================================================= DRAW.IO */

function xmlEsc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const COLORS = {
  ink: '#1F2933', muted: '#616E7C', line: '#9AA5B1', frame: '#CBD2D9', roomFill: '#FAFBFC', cabFill: '#F3F5F7',
  copper: '#3E4C59', fiber: '#0B6BCB', accent: '#0B6BCB', error: '#C62828', warn: '#B26A00', ok: '#2E7D32'
};
const SYS_COLOR = { NETT: '#52606D', CCTV: '#0B6BCB', OPS: '#7B4FB8' };

function cell(id, value, style, parent, geo, extra) {
  return `<mxCell id="${xmlEsc(id)}" value="${xmlEsc(value)}" style="${style}" ${extra || 'vertex="1"'} parent="${parent}"><mxGeometry x="${geo.x}" y="${geo.y}" width="${geo.w}" height="${geo.h}" as="geometry"/></mxCell>`;
}

function deviceLabel(e, tag) {
  if (!e) return `<b>${xmlEsc(tag)}</b><br><font color="${COLORS.error}">ukjent – ikke i utstyrsliste</font>`;
  return `<b>${xmlEsc(e.tag)}</b><br><font style="font-size:9px" color="${COLORS.muted}">${xmlEsc(e.description || '')}</font>`;
}

function devStyle(e, extra) {
  const sys = e && SYS_COLOR[e.system] || COLORS.muted;
  const prob = !e || (e.problems && e.problems.length);
  return `rounded=0;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=${prob ? COLORS.error : COLORS.frame};${prob ? 'dashed=1;' : ''}fontSize=11;fontColor=${COLORS.ink};align=left;spacingLeft=10;verticalAlign=middle;` +
    `shadow=0;` + (extra || '') + `;`;
}

function page1Overview(model, layout) {
  const cells = [];
  const roomCell = new Map(), cabCell = new Map();
  // tittel og legende
  cells.push(cell('title', `<b>Systemoversikt – fysisk kabling</b><br><font color="${COLORS.muted}" style="font-size:10px">Generert fra datamodell. Linjer = registrerte kabler/patcher aggregert per utstyrspar. Ingen logiske forbindelser er utledet.</font>`,
    'text;html=1;align=left;verticalAlign=top;fontSize=14;fontColor=' + COLORS.ink + ';', '1', { x: 40, y: 10, w: 900, h: 40 }));
  for (const r of layout.rooms) {
    const id = 'room-' + r.id;
    roomCell.set(r.id, { id, x: r.x, y: r.y });
    const st = `swimlane;html=1;startSize=36;horizontal=1;align=left;verticalAlign=top;spacingTop=8;spacingLeft=12;fontSize=12;fontStyle=1;fontColor=${r.orphan ? COLORS.error : COLORS.ink};` +
      `fillColor=${COLORS.roomFill};swimlaneFillColor=${COLORS.roomFill};strokeColor=${r.orphan ? COLORS.error : COLORS.frame};${r.orphan ? 'dashed=1;' : ''}rounded=0;container=1;collapsible=0;`;
    cells.push(cell(id, `${r.title}<span style="font-weight:normal;color:${COLORS.muted}">   ${r.sub}</span>`, st, '1', r));
  }
  for (const c of layout.cabinets) {
    const id = 'cab-' + c.id, R = roomCell.get(c.room);
    cabCell.set(c.id, { id, x: c.x, y: c.y });
    const st = `swimlane;html=1;startSize=24;align=left;verticalAlign=top;spacingTop=4;spacingLeft=8;fontSize=10;fontStyle=1;fontColor=${COLORS.muted};fillColor=${COLORS.cabFill};swimlaneFillColor=${COLORS.cabFill};strokeColor=${COLORS.frame};rounded=0;container=1;collapsible=0;`;
    cells.push(cell(id, c.title, st, R.id, { x: c.x - R.x, y: c.y - R.y, w: c.w, h: c.h }));
  }
  const nodeCell = new Map();
  for (const n of layout.nodes) {
    const e = model.equipment.get(n.tag);
    const id = 'dev-' + n.tag;
    let parent, px, py;
    if (n.cabinet && cabCell.has(n.cabinet)) { const C = cabCell.get(n.cabinet); parent = C.id; px = C.x; py = C.y; }
    else { const R = roomCell.get(n.room); parent = R.id; px = R.x; py = R.y; }
    nodeCell.set(n.tag, { id, n });
    const bar = e ? (SYS_COLOR[e.system] || COLORS.muted) : COLORS.error;
    cells.push(cell(id, deviceLabel(e, n.tag), devStyle(e, `strokeWidth=1;`) , parent, { x: n.x - px, y: n.y - py, w: n.w, h: n.h }));
    // systemfarget stripe til venstre (egen celle, låst til boksen via samme forelder)
    cells.push(cell(id + '-bar', '', `rounded=0;html=1;fillColor=${bar};strokeColor=none;`, parent, { x: n.x - px, y: n.y - py, w: 4, h: n.h }));
  }
  for (const e of layout.edges) {
    const A = nodeCell.get(e.a), B = nodeCell.get(e.b);
    const pts = e.points;
    const rel = (p, n) => ({ x: +((p.x - n.x) / n.w).toFixed(3), y: +((p.y - n.y) / n.h).toFixed(3) });
    const ex = rel(pts[0], A.n), en = rel(pts[pts.length - 1], B.n);
    const color = e.bad ? COLORS.error : e.fiber ? COLORS.fiber : COLORS.copper;
    const label = layout.labels.find(l => l.edge === e.id);
    const st = `edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;endArrow=none;startArrow=none;strokeColor=${color};strokeWidth=${e.fiber ? 2 : 1.2};${e.kind === 'patch' ? 'dashed=1;dashPattern=4 3;' : ''}${e.bad ? 'dashed=1;' : ''}` +
      `exitX=${ex.x};exitY=${ex.y};exitDx=0;exitDy=0;entryX=${en.x};entryY=${en.y};entryDx=0;entryDy=0;fontSize=9;fontColor=${COLORS.muted};labelBackgroundColor=#FFFFFF;`;
    const mid = pts.slice(1, -1).map(p => `<mxPoint x="${p.x}" y="${p.y}"/>`).join('');
    cells.push(`<mxCell id="${xmlEsc('edge-' + e.id)}" value="" style="${st}" edge="1" parent="1" source="${xmlEsc(A.id)}" target="${xmlEsc(B.id)}"><mxGeometry relative="1" as="geometry">${mid ? `<Array as="points">${mid}</Array>` : ''}</mxGeometry></mxCell>`);
    if (label) cells.push(cell('lbl-' + e.id, label.text, `text;html=1;align=center;verticalAlign=middle;fontSize=9;fontColor=${COLORS.muted};labelBackgroundColor=#FFFFFF;spacing=0;`, '1', { x: Math.round(label.x), y: Math.round(label.y), w: Math.round(label.w), h: label.h }));
  }
  // legende
  const ly = layout.height + 0;
  const lg = [
    ['Kobberkabel', `endArrow=none;html=1;strokeColor=${COLORS.copper};strokeWidth=1.2;`],
    ['Fiberkabel', `endArrow=none;html=1;strokeColor=${COLORS.fiber};strokeWidth=2;`],
    ['Patch (stiplet)', `endArrow=none;html=1;strokeColor=${COLORS.copper};dashed=1;dashPattern=4 3;`],
    ['Feil i data', `endArrow=none;html=1;strokeColor=${COLORS.error};dashed=1;`]
  ];
  lg.forEach((l, i) => {
    const x = 40 + i * 190;
    cells.push(`<mxCell id="leg-e${i}" value="" style="${l[1]}" edge="1" parent="1"><mxGeometry relative="1" as="geometry"><mxPoint x="${x}" y="${ly + 10}" as="sourcePoint"/><mxPoint x="${x + 40}" y="${ly + 10}" as="targetPoint"/></mxGeometry></mxCell>`);
    cells.push(cell('leg-t' + i, l[0], `text;html=1;align=left;verticalAlign=middle;fontSize=10;fontColor=${COLORS.muted};`, '1', { x: x + 48, y: ly, w: 130, h: 20 }));
  });
  Object.keys(SYS_COLOR).forEach((s, i) => {
    const x = 40 + (4 + i) * 190;
    cells.push(cell('leg-s' + i, '', `rounded=0;html=1;fillColor=${SYS_COLOR[s]};strokeColor=none;`, '1', { x, y: ly + 3, w: 6, h: 14 }));
    cells.push(cell('leg-st' + i, 'System ' + s, `text;html=1;align=left;verticalAlign=middle;fontSize=10;fontColor=${COLORS.muted};`, '1', { x: x + 12, y: ly, w: 120, h: 20 }));
  });
  return { cells, w: layout.width, h: layout.height + 40 };
}

/*
 * Rad-basert portdiagram: hver kanal (eller rutesteg) blir én rad, hvert utstyr
 * én kolonne. Porter står som små bokser på raden, slik at linjene blir rette.
 */
function portRowsDiagram(model, rows, opts) {
  // rows: [{ nodes:[{tag,port}], conns:[{kind,id}] }]
  // kolonnetildeling: opts.columnOf(tag) -> nummer
  const cells = [];
  const colOf = opts.columnOf;
  const colW = opts.colW || 250, boxW = opts.boxW || 170, rowH = opts.rowH || 56, top = opts.top || 90, left = opts.left || 40;
  const portW = 40, portH = 20;
  // samle porter per (tag, rad)
  const dev = new Map();
  rows.forEach((r, ri) => r.nodes.forEach(n => {
    if (!dev.has(n.tag)) dev.set(n.tag, { tag: n.tag, rows: new Set(), col: colOf(n.tag) });
    dev.get(n.tag).rows.add(ri);
  }));
  const rowY = ri => top + ri * rowH;
  const devBox = new Map();
  for (const d of Array.from(dev.values()).sort((a, b) => a.col - b.col || a.tag.localeCompare(b.tag))) {
    const rs = Array.from(d.rows).sort((a, b) => a - b);
    // del opp i sammenhengende blokker hvis raden ikke er sammenhengende
    const blocks = [];
    rs.forEach(r => { const b = blocks[blocks.length - 1]; if (b && r === b[1] + 1) b[1] = r; else blocks.push([r, r]); });
    blocks.forEach((b, bi) => {
      const e = model.equipment.get(d.tag);
      const x = left + d.col * colW, y = rowY(b[0]) - 26, h = (b[1] - b[0]) * rowH + 52;
      const id = `pd-${d.tag}-${bi}`;
      cells.push(cell(id, deviceLabel(e, d.tag), devStyle(e, 'verticalAlign=top;spacingTop=2;align=center;spacingLeft=0;'), '1', { x, y, w: boxW, h }));
      const bar = e ? (SYS_COLOR[e.system] || COLORS.muted) : COLORS.error;
      cells.push(cell(id + '-bar', '', `rounded=0;html=1;fillColor=${bar};strokeColor=none;`, '1', { x, y, w: boxW, h: 3 }));
      for (let r = b[0]; r <= b[1]; r++) devBox.set(d.tag + '#' + r, { x, y, w: boxW, h });
    });
  }
  let pid = 0;
  const portCells = new Map();
  rows.forEach((r, ri) => {
    const y = rowY(ri) + 6;
    // porter: venstre/høyre side av boksen avhengig av retning
    r.nodes.forEach((n, ni) => {
      const box = devBox.get(n.tag + '#' + ri);
      const prev = r.nodes[ni - 1], next = r.nodes[ni + 1];
      let side;
      if (prev && prev.tag === n.tag) side = 'R';          // andre port på samme panel/svitsj → ut til høyre
      else if (next && next.tag === n.tag) side = 'L';
      else if (prev) side = colOf(prev.tag) < colOf(n.tag) ? 'L' : 'R';
      else if (next) side = colOf(next.tag) > colOf(n.tag) ? 'R' : 'L';
      else side = 'R';
      const x = side === 'L' ? box.x + 6 : box.x + box.w - portW - 6;
      const id = `pp-${pid++}`;
      const e = model.equipment.get(n.tag);
      const st = `rounded=0;html=1;fillColor=#FFFFFF;strokeColor=${e ? COLORS.line : COLORS.error};fontSize=9;fontColor=${COLORS.ink};fontFamily=Courier New;`;
      cells.push(cell(id, n.port, st, '1', { x, y, w: portW, h: portH }));
      portCells.set(ri + ':' + ni, { id, x, y, side });
    });
    r.conns.forEach((c, ci) => {
      const A = portCells.get(ri + ':' + ci), B = portCells.get(ri + ':' + (ci + 1));
      if (!A || !B) return;
      if (c.kind === 'internal' || c.kind === 'through') {
        const st = `edgeStyle=orthogonalEdgeStyle;html=1;endArrow=none;strokeColor=${COLORS.line};dashed=1;dashPattern=2 2;exitX=${A.side === 'L' ? 1 : 0};exitY=0.5;entryX=${B.side === 'L' ? 1 : 0};entryY=0.5;`;
        cells.push(`<mxCell id="pc-${ri}-${ci}" value="" style="${st}" edge="1" parent="1" source="${A.id}" target="${B.id}"><mxGeometry relative="1" as="geometry"/></mxCell>`);
        return;
      }
      const l = model.linkById.get(c.id);
      const fiber = l && /OS2|OM\d|LC|SM/i.test(l.cableType);
      const color = !l || !l.valid ? COLORS.error : fiber ? COLORS.fiber : COLORS.copper;
      const st = `edgeStyle=orthogonalEdgeStyle;html=1;endArrow=none;strokeColor=${color};strokeWidth=${fiber ? 2 : 1.2};${l && l.kind === 'patch' ? 'dashed=1;dashPattern=4 3;' : ''}` +
        `exitX=${A.side === 'R' ? 1 : 0};exitY=0.5;entryX=${B.side === 'R' ? 1 : 0};entryY=0.5;exitDx=0;exitDy=0;entryDx=0;entryDy=0;`;
      cells.push(`<mxCell id="pc-${ri}-${ci}" value="" style="${st}" edge="1" parent="1" source="${A.id}" target="${B.id}"><mxGeometry relative="1" as="geometry"/></mxCell>`);
      // etikett over linjen: tag + type/lengde under
      const x0 = Math.min(A.x, B.x) + portW, x1 = Math.max(A.x, B.x);
      const w = Math.max(60, x1 - x0 - 8);
      const len = l && l.length != null ? `${l.length} m` : '<font color="' + COLORS.warn + '">lengde mangler</font>';
      const lt = `<b>${xmlEsc(c.id)}</b><br><font color="${COLORS.muted}">${xmlEsc(l ? l.cableType : '')} · ${len}</font>`;
      cells.push(cell(`pl-${ri}-${ci}`, lt, `text;html=1;align=center;verticalAlign=bottom;fontSize=9;fontColor=${COLORS.ink};spacing=0;`, '1', { x: x0 + 4, y: A.y - 26, w, h: 26 }));
    });
  });
  const maxCol = Math.max.apply(null, Array.from(dev.values()).map(d => d.col));
  return { cells, w: left * 2 + maxCol * colW + boxW, h: top + rows.length * rowH + 40 };
}

function page2Room(model, roomId) {
  const room = model.rooms.get(roomId);
  if (!room) return { cells: [cell('p2title', '<b>Romdetalj</b><br><font color="' + COLORS.error + '">Ingen gyldige rom i datasettet – se avvikslisten.</font>', 'text;html=1;align=left;verticalAlign=top;fontSize=14;', '1', { x: 40, y: 10, w: 900, h: 40 })], w: 1000, h: 200 };
  const inRoom = t => { const e = model.equipment.get(t); return e && e.room === roomId; };
  const chs = model.channels.filter(ch => ch.tags.some(inRoom));
  // kolonner: endeutstyr | kobberpanel | svitsj | fiberpanel | fjernende (annet rom)
  const colOf = tag => {
    const e = model.equipment.get(tag);
    if (!e) return 0;
    if (e.room !== roomId) return 4;
    return { camera: 0, operator_station: 0, server: 0, copper_patch_panel: 1, switch: 2, fiber_patch_panel: 3 }[e.type] != null
      ? { camera: 0, operator_station: 0, server: 0, copper_patch_panel: 1, switch: 2, fiber_patch_panel: 3 }[e.type] : 0;
  };
  // rader: orienter hver kanal venstre→høyre etter kolonne, hold kun deler i/ved rommet
  const rows = chs.map(ch => {
    let nodes = ch.nodes, conns = ch.conns;
    if (colOf(nodes[0].tag) > colOf(nodes[nodes.length - 1].tag)) { nodes = nodes.slice().reverse(); conns = conns.slice().reverse(); }
    // kutt av alt etter første node utenfor rommet
    const k = nodes.findIndex(n => !inRoom(n.tag));
    if (k > 0) { nodes = nodes.slice(0, k + 1); conns = conns.slice(0, k); }
    return { nodes, conns, sortKey: nodes.map(n => colOf(n.tag) + n.tag + n.port.padStart(4, '0')).join('|') };
  });
  // grupper rader slik at svitsjens porter blir sammenhengende: endeutstyr først, deretter opplinker
  rows.sort((a, b) => {
    const ga = colOf(a.nodes[0].tag) === 0 ? 0 : 1, gb = colOf(b.nodes[0].tag) === 0 ? 0 : 1;
    return ga - gb || a.sortKey.localeCompare(b.sortKey, 'nb', { numeric: true });
  });
  const d = portRowsDiagram(model, rows, { columnOf: colOf, top: 110, colW: 260 });
  const title = cell('p2title', `<b>Romdetalj: ${xmlEsc(room.id)} ${xmlEsc(room.name)}</b><br><font color="${COLORS.muted}" style="font-size:10px">Én rad per registrert fysisk kanal. Porter vist på utstyret, kabeltag/type/lengde over linjen. Stiplet grå = intern panelforbindelse.</font>`,
    'text;html=1;align=left;verticalAlign=top;fontSize=14;fontColor=' + COLORS.ink + ';', '1', { x: 40, y: 10, w: 1000, h: 40 });
  const heads = ['Endeutstyr', 'Kobberpanel', 'Svitsj', 'Fiberpanel', 'Annet rom'].map((h, i) =>
    cell('p2h' + i, h, `text;html=1;align=center;fontSize=10;fontStyle=1;fontColor=${COLORS.muted};`, '1', { x: 40 + i * 260, y: 58, w: 170, h: 18 }));
  return { cells: [title].concat(heads, d.cells), w: d.w, h: d.h };
}

function page3Route(model, logicalId) {
  let lg = model.logical.find(l => l.id === logicalId);
  const cells = [];
  if (!lg) {
    const ch = model.channels.filter(c => c.complete).sort((a, b) => b.nodes.length - a.nodes.length || a.id.localeCompare(b.id))[0];
    if (ch) lg = { id: ch.id, from: ch.ends[0].tag, to: ch.ends[1].tag, service: 'lengste registrerte kanal', route: [{ channel: ch.id, reversed: false }] };
  }
  if (!lg || !lg.route) {
    cells.push(cell('p3t', `<b>Forbindelsessti ${xmlEsc(logicalId)}</b><br><font color="${COLORS.error}">Ingen registrert fysisk kjede funnet.</font>`, 'text;html=1;align=left;verticalAlign=top;fontSize=14;', '1', { x: 40, y: 10, w: 900, h: 40 }));
    return { cells, w: 1000, h: 200 };
  }
  const hops = routeHops(model, lg.route);
  // hvert utstyr sin egen kolonne i rekkefølge
  const order = [];
  hops.nodes.forEach(n => { if (order.indexOf(n.tag) < 0) order.push(n.tag); });
  const d = portRowsDiagram(model, [hops], { columnOf: t => order.indexOf(t), colW: 270, boxW: 160, top: 160 });
  // rombånd bak utstyret
  const bands = [];
  order.forEach((t, i) => {
    const e = model.equipment.get(t); const r = e ? e.room : '?';
    const b = bands[bands.length - 1];
    if (b && b.room === r) b.to = i; else bands.push({ room: r, from: i, to: i });
  });
  bands.forEach((b, i) => {
    const R = model.rooms.get(b.room);
    const x = 40 + b.from * 270 - 15, w = (b.to - b.from) * 270 + 160 + 30;
    cells.push(cell('p3band' + i, `${xmlEsc(b.room)} ${xmlEsc(R ? R.name : '')}`,
      `rounded=0;html=1;fillColor=${COLORS.roomFill};strokeColor=${COLORS.frame};verticalAlign=top;align=left;spacingLeft=8;fontSize=10;fontStyle=1;fontColor=${COLORS.muted};`, '1', { x, y: 80, w, h: 150 }));
  });
  const totalLen = hops.conns.filter(c => c.kind === 'cable' || c.kind === 'patch').map(c => model.linkById.get(c.id)).reduce((s, l) => s + (l && l.length != null ? l.length : 0), 0);
  const missing = hops.conns.filter(c => (c.kind === 'cable' || c.kind === 'patch') && model.linkById.get(c.id).length == null).map(c => c.id);
  cells.push(cell('p3t', `<b>Registrert fysisk sti: ${xmlEsc(lg.id)} ${xmlEsc(lg.from)} → ${xmlEsc(lg.to)}</b> <font color="${COLORS.muted}">(${xmlEsc(lg.service)})</font><br>` +
    `<font color="${COLORS.muted}" style="font-size:10px">Beregnet av kode fra registrerte kabler, patcher og interne panelforbindelser. Viser fysisk kjede – ikke VLAN, konfigurasjon eller tjenestetilgjengelighet. Prikket grå = intern panelforbindelse eller passering gjennom svitsj (ingen kabel). ` +
    `Sum registrert lengde: ${totalLen} m${missing.length ? ' (mangler lengde for ' + missing.join(', ') + ')' : ''}.</font>`,
    'text;html=1;align=left;verticalAlign=top;fontSize=14;fontColor=' + COLORS.ink + ';', '1', { x: 40, y: 10, w: Math.max(900, d.w - 80), h: 50 }));
  return { cells: cells.concat(d.cells), w: d.w, h: 260 };
}

function buildDrawio(model, layout, opts) {
  opts = opts || {};
  const pages = [
    { name: '1 Totaloversikt', p: page1Overview(model, layout) },
    { name: '2 Rom ' + (opts.roomId || ''), p: page2Room(model, opts.roomId) },
    { name: '3 Sti ' + (opts.logicalId || ''), p: page3Route(model, opts.logicalId) }
  ];
  const diag = pages.map((pg, i) =>
    `<diagram id="ece-page-${i + 1}" name="${xmlEsc(pg.name)}"><mxGraphModel dx="1400" dy="900" grid="0" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${Math.ceil(pg.p.w + 40)}" pageHeight="${Math.ceil(pg.p.h + 40)}" math="0" shadow="0" background="#FFFFFF"><root><mxCell id="0"/><mxCell id="1" parent="0"/>${pg.p.cells.join('')}</root></mxGraphModel></diagram>`
  ).join('');
  return `<mxfile host="Engineering Connection Explorer" version="1.0" type="device">${diag}</mxfile>`;
}

/* ====================================================== RAPPORT */

function buildReport(model, opts) {
  opts = opts || {};
  const L2 = [];
  const s = model.summary;
  const sev = { error: 'FEIL', warning: 'ADVARSEL', info: 'INFO' };
  L2.push(`# Dokumentasjonsrapport – ${opts.title || 'datasett'}`, '');
  L2.push('_Generert automatisk av Engineering Connection Explorer fra fiktive CSV-data. Fysisk kabling og logiske forbindelser er holdt adskilt; ingen VLAN, redundans eller tjenestetilgjengelighet er utledet._', '');
  L2.push(`Rom: ${s.rooms} · Kabinetter: ${s.cabinets} · Utstyr: ${s.equipment} · Kabler: ${s.cables} · Patcher: ${s.patches} · Interne forbindelser: ${s.internal} · Fysiske kanaler: ${s.channels}`, '');
  L2.push(`**Kontroller:** ${s.errors} feil, ${s.warnings} advarsler.`, '');
  L2.push('## Dokumentasjonsavvik', '');
  if (!model.issues.length) L2.push('Ingen avvik funnet.', '');
  else {
    L2.push('| Alvor | Kode | Beskrivelse | Kilde |', '|---|---|---|---|');
    model.issues.forEach(i => L2.push(`| ${sev[i.severity]} | ${i.code} | ${i.message.replace(/\|/g, '/')} | ${i.source ? i.source.file + ':' + i.source.line : ''} |`));
    L2.push('');
  }
  L2.push('## Utstyr per rom og kabinett', '');
  const rooms = Array.from(model.rooms.values()).sort((a, b) => a.id.localeCompare(b.id));
  for (const r of rooms) {
    L2.push(`### ${r.id} ${r.name}`, '');
    L2.push('| Tag | Beskrivelse | Type | System | Kabinett | U | Tilkoblede porter |', '|---|---|---|---|---|---|---|');
    Array.from(model.equipment.values()).filter(e => e.room === r.id).sort((a, b) => (a.cabinet || '~').localeCompare(b.cabinet || '~') || (b.rackU || 0) - (a.rackU || 0) || a.tag.localeCompare(b.tag)).forEach(e => {
      const used = e.ports.filter(p => model.portLink.has(pk(e.tag, p)));
      L2.push(`| ${e.tag} | ${e.description} | ${e.typeLabel} | ${e.system} | ${e.cabinet || '–'} | ${e.rackU || '–'} | ${used.length}/${e.ports.length} |`);
    });
    L2.push('');
  }
  const orphans = Array.from(model.equipment.values()).filter(e => !model.rooms.has(e.room));
  if (orphans.length) {
    L2.push('### Utstyr uten gyldig rom', '');
    orphans.forEach(e => L2.push(`- **${e.tag}** ${e.description} – rom: «${e.room || 'MANGLER'}»`));
    L2.push('');
  }
  L2.push('## Kabel- og patcheliste', '');
  L2.push('| Tag | Kategori | Fra | Til | Type | Lengde | Status |', '|---|---|---|---|---|---|---|');
  model.links.slice().sort((a, b) => a.id.localeCompare(b.id)).forEach(l =>
    L2.push(`| ${l.id} | ${l.kind === 'cable' ? 'Kabel' : 'Patch'} | ${l.a.tag}:${l.a.port} | ${l.b.tag}:${l.b.port} | ${l.cableType || '**mangler**'} | ${l.length != null ? l.length + ' m' : '**mangler**'} | ${l.problems.length ? l.problems.join('; ') : 'OK'} |`));
  L2.push('');
  L2.push('## Registrerte fysiske kanaler (beregnet)', '');
  L2.push('| Kanal | Fra | Til | Via (kabler/patcher) | Status |', '|---|---|---|---|---|');
  model.channels.forEach(c => L2.push(`| ${c.id} | ${c.ends[0].tag}:${c.ends[0].port} | ${c.ends[1].tag}:${c.ends[1].port} | ${c.links.join(' → ')} | ${c.complete ? 'Komplett' : 'Ufullstendig: ' + c.ends.filter(e => e.status !== 'ok').map(e => e.reason).join('; ')} |`));
  L2.push('');
  L2.push('## Logiske forbindelser (registrert) og fysisk kjede', '');
  L2.push('_En funnet fysisk kjede betyr bare at kabling er registrert hele veien. Konfigurasjon (VLAN, ruting, tjenester) er ikke dokumentert i datasettet._', '');
  L2.push('| ID | Fra | Til | Tjeneste | Registrert fysisk kjede |', '|---|---|---|---|---|');
  model.logical.forEach(lg => {
    let t = 'Ikke funnet';
    if (lg.route) { const h = routeHops(model, lg.route); t = h.nodes.map(n => n.tag + ':' + n.port).join(' – '); }
    L2.push(`| ${lg.id} | ${lg.from} | ${lg.to} | ${lg.service} | ${t} |`);
  });
  L2.push('');
  return L2.join('\n');
}

function buildDiffReport(diff) {
  const t = { added: 'Lagt til', removed: 'Fjernet', changed: 'Endret' };
  const k = { equipment: 'Utstyr', link: 'Kabel/patch', internal: 'Intern forbindelse', logical: 'Logisk forbindelse' };
  const out = ['# Endringer: Revisjon B sammenlignet med basis', ''];
  out.push(`Sammendrag: **${diff.summary.added} lagt til**, **${diff.summary.removed} fjernet**, **${diff.summary.changed} endret**.`, '');
  out.push('| Endring | Objekttype | ID | Detaljer |', '|---|---|---|---|');
  diff.changes.forEach(c => out.push(`| ${t[c.change]} | ${k[c.kind]} | ${c.id} | ${c.change === 'changed' ? c.fields.map(f => `${f.name}: ${f.before || '–'} → ${f.after || '–'}`).join('; ') : c.label} |`));
  out.push('', '## Påvirkede fysiske kanaler', '');
  diff.channelChanges.removed.forEach(x => out.push(`- **Bortfalt:** ${x}`));
  diff.channelChanges.added.forEach(x => out.push(`- **Ny:** ${x}`));
  out.push('');
  return out.join('\n');
}


/** UTF-8 -> base64 uten Buffer/TextEncoder (fungerer også i n8n sin Code-sandkasse) */
function utf8ToBase64(str) {
  const bytes = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.codePointAt(i);
    if (c > 0xffff) i++;
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
    out += A[(n >> 18) & 63] + A[(n >> 12) & 63] + (i + 1 < bytes.length ? A[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? A[n & 63] : '=');
  }
  return out;
}

/* ======================================================== IMPORT */
/*
 * Import av egne eksporter (f.eks. fra PATCH MANAGER) via en konfigurerbar kolonnemapping.
 * Mappingen er data (JSON), ikke kode: den sier hvilken kildetabell og hvilke kolonner
 * som gir hvert felt i den kanoniske modellen. Ingenting gjettes – manglende tabeller og
 * kolonner rapporteres som avvik.
 */

const FIELDS = {
  rooms:         { fields: ['room_id', 'name', 'area', 'grid_col', 'grid_row'], required: ['room_id'] },
  cabinets:      { fields: ['cabinet_id', 'room_id', 'name', 'height_u'], required: ['cabinet_id', 'room_id'] },
  equipment:     { fields: ['tag', 'description', 'type', 'system', 'room_id', 'cabinet_id', 'rack_u', 'ports', 'model'], required: ['tag', 'type'] },
  cables:        { fields: ['cable_tag', 'from_tag', 'from_port', 'to_tag', 'to_port', 'cable_type', 'length_m'], required: ['cable_tag', 'from_tag', 'from_port', 'to_tag', 'to_port'] },
  patching:      { fields: ['patch_tag', 'from_tag', 'from_port', 'to_tag', 'to_port', 'cable_type', 'length_m'], required: ['patch_tag', 'from_tag', 'from_port', 'to_tag', 'to_port'] },
  internal:      { fields: ['tag', 'port_a', 'port_b', 'note'], required: ['tag', 'port_a', 'port_b'] },
  logical_links: { fields: ['link_id', 'from_tag', 'to_tag', 'service', 'note'], required: ['link_id', 'from_tag', 'to_tag'] }
};
const REQUIRED_TABLES = ['rooms', 'equipment'];

/** Standardmapping: kanoniske tabell- og kolonnenavn (som data/base/*.csv) */
const DEFAULT_MAPPING = { name: 'Standard (kanoniske CSV-/arknavn)', tables: {} };
FILES.forEach(t => { DEFAULT_MAPPING.tables[t] = { source: t }; });

const normName = s => String(s == null ? '' : s).trim().toLowerCase().replace(/\.(csv|txt|tsv|xlsx|xlsm)$/, '');
const normCol = s => String(s == null ? '' : s).replace(/^﻿/, '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * tables: { kildenavn: [rad-objekter] } (fra CSV-filer eller Excel-ark)
 * mapping: { name, derivePorts?, tables: { mål: { source, where?, columns? } } }
 * Kolonnespesifikasjon: "Kolonne" | ["Alt1","Alt2"] | { column, map, number, format, split:{sep,index}, const, default }
 */
function importTables(tables, mapping) {
  mapping = mapping || DEFAULT_MAPPING;
  const issues = [], used = [];
  const add = (severity, code, message, refs) => issues.push({ severity, code, message, refs: refs || [], source: null });
  const byName = new Map();
  Object.keys(tables).forEach(k => byName.set(normName(k), { name: k, rows: tables[k] || [] }));
  const raw = {};
  for (const target of FILES) {
    raw[target] = [];
    const spec = (mapping.tables || {})[target];
    if (!spec) continue;
    const sources = [].concat(spec.source || target);
    const t = sources.map(normName).map(n => byName.get(n)).find(Boolean);
    if (!t) {
      if (!spec.optional) add(REQUIRED_TABLES.indexOf(target) >= 0 ? 'error' : 'warning', 'MAPPING_TABLE',
        `Fant ikke kildetabell ${sources.map(x => '«' + x + '»').join(' / ')} for ${target}. Tilgjengelige: ${Array.from(byName.values()).map(x => x.name).join(', ') || '(ingen)'}`, [target]);
      continue;
    }
    const header = new Map();
    t.rows.forEach(r => Object.keys(r).forEach(k => { if (!header.has(normCol(k))) header.set(normCol(k), k); }));
    const reported = new Set();
    const colKey = (names, field, mandatory) => {
      for (const n of [].concat(names)) if (header.has(normCol(n))) return header.get(normCol(n));
      if (mandatory && !reported.has(field)) {
        reported.add(field);
        add('error', 'MAPPING_COLUMN', `${t.name}: mangler kolonne ${[].concat(names).map(x => '«' + x + '»').join(' / ')} for ${target}.${field}. Kolonner i kilden: ${Array.from(header.values()).join(', ')}`, [target, field]);
      }
      return null;
    };
    // filter (f.eks. kabler vs. patcher i samme tabell)
    let rows = t.rows;
    if (spec.where) {
      const wk = colKey(spec.where.column, 'where', true);
      const vals = [].concat(spec.where.in || spec.where.equals || []).map(normCol);
      const not = [].concat(spec.where.notIn || spec.where.notEquals || []).map(normCol);
      rows = wk == null ? [] : rows.filter(r => { const v = normCol(r[wk]); return (!vals.length || vals.indexOf(v) >= 0) && not.indexOf(v) < 0; });
    }
    const fieldSpecs = FIELDS[target].fields.map(f => {
      const cs = spec.columns ? spec.columns[f] : f;
      const mandatory = spec.columns ? cs != null && !(typeof cs === 'object' && !Array.isArray(cs) && ('const' in cs)) : FIELDS[target].required.indexOf(f) >= 0;
      if (cs == null) return { f, get: () => '' };
      const o = typeof cs === 'string' || Array.isArray(cs) ? { column: cs } : cs;
      if ('const' in o) return { f, get: () => String(o.const) };
      const key = colKey(o.column || f, f, mandatory || (spec.columns && FIELDS[target].required.indexOf(f) >= 0));
      const mapLower = o.map ? new Map(Object.keys(o.map).map(k => [normCol(k), o.map[k]])) : null;
      return { f, get: r => {
        let v = key == null ? '' : String(r[key] == null ? '' : r[key]).trim();
        if (v === '' && o.default != null) v = String(o.default);
        if (o.split && v) { const parts = v.split(o.split.sep); v = (parts[o.split.index || 0] || '').trim(); }
        if (mapLower && v !== '' && mapLower.has(normCol(v))) v = String(mapLower.get(normCol(v)));
        if (o.number && v !== '') v = v.replace(/\s/g, '').replace(',', '.');
        if (o.format && v !== '') v = o.format.replace(/\{value\}/g, v);
        return v;
      } };
    });
    raw[target] = rows.map(r => {
      const o = {};
      fieldSpecs.forEach(fs => { o[fs.f] = fs.get(r); });
      Object.defineProperty(o, '__src', { value: r.__src || { file: t.name, line: 0 }, enumerable: false });
      return o;
    });
    used.push({ target, source: t.name, rows: raw[target].length, of: t.rows.length });
  }
  return { raw, issues, used, derivePorts: !!mapping.derivePorts };
}

/** Kjør fra importerte tabeller: mapping -> modell -> layout -> drawio/rapport */
function runImport(tables, mapping, opts) {
  const imp = importTables(tables, mapping);
  const r = runModel(imp.raw, Object.assign({}, opts, { preIssues: imp.issues, derivePorts: imp.derivePorts }));
  r.import = imp;
  return r;
}

/** Tekst fra filbytes: UTF-8 (med/uten BOM), ellers Windows-1252 (eldre norsk Excel-CSV) */
function decodeText(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, ''); }
  catch (e) { return new TextDecoder('windows-1252').decode(bytes); }
}

/* ------------------------------------------------- ZIP og XLSX */

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) { let c = (crc ^ buf[i]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
const utf8 = s => new TextEncoder().encode(s);

/** Lager ZIP (lagret, ukomprimert). entries: [[navn, tekst|Uint8Array]] -> Uint8Array */
function makeZip(entries) {
  const chunks = [], central = []; let off = 0;
  const u16 = (a, o, v) => { a[o] = v & 255; a[o + 1] = (v >>> 8) & 255; };
  const u32 = (a, o, v) => { u16(a, o, v & 0xffff); u16(a, o + 2, (v >>> 16) & 0xffff); };
  for (const [name, content] of entries) {
    const data = typeof content === 'string' ? utf8(content) : content, fn = utf8(name), crc = crc32(data);
    const h = new Uint8Array(30);
    u32(h, 0, 0x04034b50); u16(h, 4, 20); u16(h, 6, 0x0800); u16(h, 12, 0x5a21); u32(h, 14, crc); u32(h, 18, data.length); u32(h, 22, data.length); u16(h, 26, fn.length);
    chunks.push(h, fn, data);
    const c = new Uint8Array(46);
    u32(c, 0, 0x02014b50); u16(c, 4, 20); u16(c, 6, 20); u16(c, 8, 0x0800); u16(c, 14, 0x5a21); u32(c, 16, crc); u32(c, 20, data.length); u32(c, 24, data.length); u16(c, 28, fn.length); u32(c, 42, off);
    central.push(c, fn); off += 30 + fn.length + data.length;
  }
  const cdLen = central.reduce((s, x) => s + x.length, 0);
  const e = new Uint8Array(22);
  u32(e, 0, 0x06054b50); u16(e, 8, entries.length); u16(e, 10, entries.length); u32(e, 12, cdLen); u32(e, 16, off);
  const all = chunks.concat(central, [e]);
  const out = new Uint8Array(all.reduce((s, x) => s + x.length, 0));
  let p = 0; all.forEach(x => { out.set(x, p); p += x.length; });
  return out;
}

/** Leser ZIP-innhold. inflateRaw: (Uint8Array) => Promise<Uint8Array> (DecompressionStream i nettleser, zlib i Node) */
async function readZip(bytes, inflateRaw) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let e = bytes.length - 22;
  while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('Filen er ikke en gyldig .xlsx/zip');
  const n = dv.getUint16(e + 10, true);
  let p = dv.getUint32(e + 16, true);
  const files = new Map();
  for (let i = 0; i < n; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Ødelagt zip-katalog');
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nlen));
    const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
    files.set(name, { method, data: bytes.subarray(start, start + csize) });
    p += 46 + nlen + xlen + clen;
  }
  return {
    names: Array.from(files.keys()),
    text: async name => {
      const f = files.get(name);
      if (!f) return null;
      if (f.method === 0) return new TextDecoder().decode(f.data);
      if (f.method === 8) return new TextDecoder().decode(await inflateRaw(f.data));
      throw new Error('Ukjent komprimering i ' + name);
    }
  };
}

const xmlUnesc = s => String(s).replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, g) =>
  g[0] === '#' ? String.fromCodePoint(g[1] === 'x' || g[1] === 'X' ? parseInt(g.slice(2), 16) : +g.slice(1)) : { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[g.toLowerCase()]);
const attr = (tag, name) => { const m = tag.match(new RegExp('\\s' + name + '="([^"]*)"')); return m ? xmlUnesc(m[1]) : null; };
const colIndex = ref => { const m = /^([A-Z]+)/.exec(ref || ''); let n = 0; if (m) for (const ch of m[1]) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

/** Leser .xlsx -> { arknavn: [rad-objekter] } (første rad = kolonneoverskrifter). Ingen avhengigheter. */
async function readXlsx(bytes, inflateRaw) {
  const z = await readZip(bytes, inflateRaw);
  const wb = await z.text('xl/workbook.xml');
  if (!wb) throw new Error('Mangler xl/workbook.xml – er dette en Excel-fil (.xlsx)?');
  const rels = (await z.text('xl/_rels/workbook.xml.rels')) || '';
  const relMap = new Map((rels.match(/<Relationship\b[^>]*>/g) || []).map(t => [attr(t, 'Id'), attr(t, 'Target')]));
  const ssXml = (await z.text('xl/sharedStrings.xml')) || '';
  const shared = (ssXml.match(/<si>[\s\S]*?<\/si>/g) || []).map(si => (si.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').match(/<t\b[^>]*>[\s\S]*?<\/t>|<t\b[^>]*\/>/g) || []).map(t => xmlUnesc(t.replace(/<t\b[^>]*\/>|<t\b[^>]*>|<\/t>/g, ''))).join(''));
  const out = {};
  for (const sh of wb.match(/<sheet\b[^>]*>/g) || []) {
    const name = attr(sh, 'name'), target = relMap.get(attr(sh, 'r:id'));
    if (!target) continue;
    const path = target.charAt(0) === '/' ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
    const xml = await z.text(path);
    if (!xml) continue;
    const grid = [];
    let rowNo = 0;
    for (const rm of xml.match(/<row\b[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g) || []) {
      const rAttr = attr(rm.match(/<row\b[^>]*>/)[0], 'r');
      rowNo = rAttr ? +rAttr : rowNo + 1;
      const cells = [];
      let ci = -1;
      for (const cm of rm.match(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || []) {
        const open = cm.match(/<c\b[^>]*?\/?>/)[0];
        const ref = attr(open, 'r');
        ci = ref ? colIndex(ref) : ci + 1;
        const t = attr(open, 't');
        let v = '';
        if (t === 'inlineStr') v = ((cm.match(/<t\b[^>]*>([\s\S]*?)<\/t>/g) || []).map(x => xmlUnesc(x.replace(/<t\b[^>]*>|<\/t>/g, '')))).join('');
        else {
          const vm = cm.match(/<v>([\s\S]*?)<\/v>/);
          v = vm ? xmlUnesc(vm[1]) : '';
          if (t === 's') v = shared[+v] || '';
          else if (t === 'b') v = v === '1' ? 'TRUE' : 'FALSE';
          else if ((!t || t === 'n') && v !== '' && !isNaN(+v)) v = String(+(+v).toPrecision(12));
        }
        cells[ci] = v;
      }
      grid.push({ line: rowNo, cells });
    }
    const nonEmpty = grid.filter(r => r.cells.some(c => c != null && String(c).trim() !== ''));
    if (!nonEmpty.length) { out[name] = []; continue; }
    const head = nonEmpty[0].cells.map(h => (h == null ? '' : String(h)).trim());
    out[name] = nonEmpty.slice(1).map(r => {
      const o = {};
      head.forEach((h, k) => { if (h) o[h] = r.cells[k] == null ? '' : String(r.cells[k]).trim(); });
      Object.defineProperty(o, '__src', { value: { file: name, line: r.line }, enumerable: false });
      return o;
    });
  }
  return out;
}

/** Skriver enkel .xlsx (tekstceller) fra { arknavn: [[celle, ...], ...] } -> Uint8Array */
function writeXlsx(sheets) {
  const names = Object.keys(sheets);
  const colName = i => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  const NS = 'http://schemas.openxmlformats.org';
  const files = [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="${NS}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      names.map((n, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '</Types>'],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${NS}/package/2006/relationships"><Relationship Id="rId1" Type="${NS}/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${NS}/spreadsheetml/2006/main" xmlns:r="${NS}/officeDocument/2006/relationships"><sheets>` +
      names.map((n, i) => `<sheet name="${xmlEsc(n.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${NS}/package/2006/relationships">` +
      names.map((n, i) => `<Relationship Id="rId${i + 1}" Type="${NS}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') + '</Relationships>']
  ];
  names.forEach((n, i) => {
    const rows = sheets[n].map((r, ri) => `<row r="${ri + 1}">` + r.map((v, ci) => v == null || v === '' ? '' :
      `<c r="${colName(ci)}${ri + 1}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`).join('') + '</row>').join('');
    files.push([`xl/worksheets/sheet${i + 1}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${NS}/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`]);
  });
  return makeZip(files);
}

/** Excel-mal med kanoniske ark og kolonner (valgfritt med eksempelrader fra et datasett) */
function buildTemplateXlsx(raw) {
  const sheets = {};
  FILES.forEach(t => { sheets[t] = [FIELDS[t].fields].concat(raw ? raw[t].map(r => FIELDS[t].fields.map(f => r[f] == null ? '' : r[f])) : []); });
  return writeXlsx(sheets);
}

/** Kabelliste som CSV */
function buildCableCsv(model) {
  const q = v => /[",\n;]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
  const rows = [['tag', 'kategori', 'fra_tag', 'fra_port', 'fra_rom', 'til_tag', 'til_port', 'til_rom', 'type', 'lengde_m', 'status']];
  model.links.slice().sort((a, b) => a.id.localeCompare(b.id)).forEach(l => {
    const ra = model.equipment.get(l.a.tag), rb = model.equipment.get(l.b.tag);
    rows.push([l.id, l.kind === 'cable' ? 'kabel' : 'patch', l.a.tag, l.a.port, ra ? ra.room : '', l.b.tag, l.b.port, rb ? rb.room : '', l.cableType, l.length == null ? '' : l.length, l.problems.join('; ') || 'OK']);
  });
  return rows.map(r => r.map(q).join(',')).join('\n') + '\n';
}

/* ============================================ HELHETLIG KJØRING */

/** Kjør hele kjeden for ett datasett: CSV-tekster -> modell, layout, drawio, rapport */
function runPipeline(files, opts) {
  return runModel(parseDataset(files), opts);
}

/** Felles kjøring fra rå tabeller (brukes av CLI, nettleserimport og n8n) */
function runModel(raw, opts) {
  opts = opts || {};
  const model = buildModel(raw, { preIssues: opts.preIssues, derivePorts: opts.derivePorts });
  const { layout, lock } = layoutModel(model, opts.lock);
  const pick = defaultSelections(model);
  const roomId = opts.roomId && model.rooms.has(opts.roomId) ? opts.roomId : pick.roomId;
  const logicalId = opts.logicalId && model.logical.some(l => l.id === opts.logicalId && l.route) ? opts.logicalId : pick.logicalId;
  const drawio = buildDrawio(model, layout, { roomId, logicalId });
  const report = buildReport(model, { title: opts.title });
  return { raw, model, layout, lock, drawio, report, roomId, logicalId };
}

/** Standard rom for side 2 (flest kanaler) og sti for side 3 (første logiske med fysisk kjede) */
function defaultSelections(model) {
  const count = new Map();
  model.channels.forEach(c => c.tags.forEach(t => { const e = model.equipment.get(t); if (e && model.rooms.has(e.room)) count.set(e.room, (count.get(e.room) || 0) + 1); }));
  const roomId = Array.from(count.keys()).sort((a, b) => count.get(b) - count.get(a) || a.localeCompare(b))[0] || (model.rooms.keys().next().value || '');
  const lg = model.logical.find(l => l.route);
  return { roomId, logicalId: lg ? lg.id : '' };
}

/** Serialiserbar visning av modellen (for nettleser/n8n) */
function modelToJSON(model) {
  return {
    rooms: Array.from(model.rooms.values()),
    cabinets: Array.from(model.cabinets.values()),
    equipment: Array.from(model.equipment.values()),
    links: model.links,
    internals: model.internals,
    channels: model.channels,
    logical: model.logical.map(lg => Object.assign({}, lg, { hops: lg.route ? routeHops(model, lg.route) : null })),
    issues: model.issues,
    summary: model.summary
  };
}

const api = {
  parseCSV, parseDataset, expandPorts, buildModel, computeChannels, findRoute, routeHops, removalImpact,
  diffModels, buildDiffReport, utf8ToBase64, channelText, layoutModel, buildDrawio, buildReport, runPipeline, runModel, modelToJSON, TYPES, FILES,
  FIELDS, DEFAULT_MAPPING, importTables, runImport, decodeText, detectDelimiter, makeZip, readZip, readXlsx, writeXlsx, buildTemplateXlsx, buildCableCsv, defaultSelections
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.ECE = api;
