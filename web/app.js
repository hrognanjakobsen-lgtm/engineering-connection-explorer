/* Engineering Connection Explorer – nettleservisning.
 * Leser forhåndsberegnet modell + layout fra ../out/data.js (generert av src/build.js).
 * Ingen beregning av forbindelser skjer her: stier, kontroller og fjerningsanalyse kommer fra kjernen. */
(function () {
  'use strict';
  const D = window.ECE_DATA;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const SYS = { NETT: '#52606D', CCTV: '#0B6BCB', OPS: '#7B4FB8' };
  const SEV = { error: 'FEIL', warning: 'ADVARSEL', info: 'INFO' };
  const CHG = { added: 'LAGT TIL', removed: 'FJERNET', changed: 'ENDRET' };
  const isFiber = l => /OS2|OM\d|LC|SM/i.test(l.cableType || '');

  const state = { ds: 'base', room: '', sys: '', sel: null, sim: null, zoom: 'fit' };
  let M, LY, eqMap, linkMap, chMap;

  function load() {
    const d = D.datasets[state.ds];
    M = d.model; LY = d.layout;
    eqMap = new Map(M.equipment.map(e => [e.tag, e]));
    linkMap = new Map(M.links.map(l => [l.id, l]));
    chMap = new Map(M.channels.map(c => [c.id, c]));
    const rf = $('roomFilter'), sf = $('sysFilter');
    rf.innerHTML = '<option value="">Alle rom</option>' + M.rooms.slice().sort((a, b) => a.id.localeCompare(b.id)).map(r => `<option value="${esc(r.id)}">${esc(r.id)} ${esc(r.name)}</option>`).join('');
    const systems = Array.from(new Set(M.equipment.map(e => e.system).filter(Boolean))).sort();
    sf.innerHTML = '<option value="">Alle systemer</option>' + systems.map(s => `<option>${esc(s)}</option>`).join('');
    rf.value = M.rooms.some(r => r.id === state.room) ? state.room : (state.room = '');
    sf.value = systems.indexOf(state.sys) >= 0 ? state.sys : (state.sys = '');
  }

  /* ------------------------------------------------ fremheving */
  function highlight() {
    const links = new Set(), tags = new Set(), broken = new Set();
    let chans = [];
    if (state.sel && state.sel.type === 'node') chans = M.channels.filter(c => c.tags.indexOf(state.sel.id) >= 0);
    if (state.sel && state.sel.type === 'logical') {
      const lg = M.logical.find(l => l.id === state.sel.id);
      if (lg && lg.route) chans = lg.route.map(s => chMap.get(s.channel));
    }
    chans.forEach(c => { c.links.forEach(l => links.add(l)); c.tags.forEach(t => tags.add(t)); });
    if (state.sim) {
      const imp = D.impacts[state.ds][state.sim];
      imp.brokenChannels.forEach(id => chMap.get(id).links.forEach(l => broken.add(l)));
    }
    return { links, tags, broken };
  }

  function visible(tag) {
    const e = eqMap.get(tag);
    if (state.room && (!e || e.room !== state.room)) return false;
    if (state.sys && (!e || e.system !== state.sys)) return false;
    return true;
  }

  function diffSets() {
    if (state.ds !== 'revb') return null;
    const s = { addedLinks: new Set(), changedLinks: new Set(), changedEq: new Set(), removedLinks: new Set() };
    D.diff.changes.forEach(c => {
      if (c.kind === 'link') (c.change === 'added' ? s.addedLinks : c.change === 'changed' ? s.changedLinks : s.removedLinks).add(c.id);
      if (c.kind === 'equipment' && c.change !== 'removed') s.changedEq.add(c.id);
    });
    return s;
  }

  /* ------------------------------------------------------ SVG */
  function render() {
    const H = highlight();
    const df = diffSets();
    const selTag = state.sel && state.sel.type === 'node' ? state.sel.id : null;
    const selEdge = state.sel && state.sel.type === 'edge' ? state.sel.id : null;
    const out = [];
    const W = LY.width, Hh = LY.height;
    const width = state.zoom === 'fit' ? '100%' : Math.round(W * state.zoom) + 'px';
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${Hh}" width="${width}" ${state.zoom === 'fit' ? '' : `height="${Math.round(Hh * state.zoom)}px"`} font-family="Segoe UI, Helvetica, Arial, sans-serif">`);
    for (const r of LY.rooms) {
      const dim = state.room && r.id !== state.room ? ' dim' : '';
      out.push(`<g class="room${r.orphan ? ' orphan' : ''}${dim}"><rect class="frame" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}"/>` +
        `<text class="t" x="${r.x + 14}" y="${r.y + 24}">${esc(r.title)}<tspan class="s" dx="10">${esc(r.sub)}</tspan></text></g>`);
    }
    for (const c of LY.cabinets) {
      const dim = state.room && c.room !== state.room ? ' dim' : '';
      out.push(`<g class="cab${dim}"><rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}"/><text x="${c.x + 8}" y="${c.y + 15}">${esc(c.title)}</text></g>`);
    }
    // spøkelser (revisjon): fjernede forbindelser og tidligere plassering, hentet fra basislayout
    if (df) {
      const B = D.datasets.base.layout;
      for (const e of B.edges) if (e.links.every(id => df.removedLinks.has(id)))
        out.push(`<g class="edge ghost"><path class="ln" d="${pathD(e.points)}"/></g>`);
      for (const n of B.nodes) if (df.changedEq.has(n.tag)) {
        const now = LY.nodes.find(x => x.tag === n.tag);
        if (now && (now.x !== n.x || now.y !== n.y))
          out.push(`<g class="ghost"><rect class="box" x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}"/><text x="${n.x + 10}" y="${n.y + 25}">${esc(n.tag)} (tidligere)</text></g>`);
      }
    }
    for (const e of LY.edges) {
      const vis = visible(e.a) && visible(e.b);
      const on = e.links.some(l => H.links.has(l));
      const br = e.links.some(l => H.broken.has(l));
      const ls = e.links.map(id => linkMap.get(id));
      const cls = ['edge'];
      if (ls.some(isFiber)) cls.push('fiber');
      if (ls.every(l => l.kind === 'patch')) cls.push('patch');
      if (e.bad) cls.push('bad');
      if (on) cls.push('onpath');
      if (br) cls.push('broken');
      if (selEdge === e.id) cls.push('onpath');
      if (df) { if (e.links.some(l => df.addedLinks.has(l))) cls.push('diff-added'); else if (e.links.some(l => df.changedLinks.has(l))) cls.push('diff-changed'); }
      const anyHL = H.links.size || H.broken.size || selEdge;
      if (!vis || (anyHL && !on && !br && selEdge !== e.id)) cls.push('dim');
      const tip = e.links.map(id => { const l = linkMap.get(id); return `${id}: ${l.a.tag}:${l.a.port} → ${l.b.tag}:${l.b.port}`; }).join('\n');
      out.push(`<g class="${cls.join(' ')}" data-edge="${esc(e.id)}"><title>${esc(tip)}</title><path class="hit" d="${pathD(e.points)}"/><path class="ln" d="${pathD(e.points)}"/></g>`);
    }
    for (const lb of LY.labels) {
      const e = LY.edges.find(x => x.id === lb.edge);
      const dim = !(visible(e.a) && visible(e.b)) ? ' dim' : '';
      out.push(`<g class="${dim}"><rect class="elabel-bg" x="${lb.x}" y="${lb.y}" width="${lb.w}" height="${lb.h}"/><text class="elabel" x="${lb.x + lb.w / 2}" y="${lb.y + 11}" text-anchor="middle">${esc(lb.text)}</text></g>`);
    }
    for (const n of LY.nodes) {
      const e = eqMap.get(n.tag);
      const cls = ['node'];
      if (n.placeholder) cls.push('placeholder');
      if (e && e.problems.length) cls.push('problem');
      if (selTag === n.tag) cls.push('sel'); else if (H.tags.has(n.tag)) cls.push('onpath');
      if (df && df.changedEq.has(n.tag)) cls.push('diff-changed');
      const anyHL = H.tags.size || selEdge || H.broken.size;
      const inSel = selEdge && LY.edges.some(x => x.id === selEdge && (x.a === n.tag || x.b === n.tag));
      if (!visible(n.tag) || (anyHL && !H.tags.has(n.tag) && selTag !== n.tag && !inSel && !(H.broken.size && brokenTag(n.tag)))) cls.push('dim');
      const bar = e ? (SYS[e.system] || '#616E7C') : '#C62828';
      const desc = n.placeholder ? 'Ukjent – finnes ikke i utstyrslisten' : e.problems.length ? e.problems.join(', ') : e.description;
      out.push(`<g class="${cls.join(' ')}" data-tag="${esc(n.tag)}"><title>${esc(n.tag)}</title><rect class="box" x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}"/>` +
        `<rect x="${n.x}" y="${n.y}" width="4" height="${n.h}" fill="${bar}"/>` +
        `<text class="tag" x="${n.x + 12}" y="${n.y + 17}">${esc(n.tag)}</text><text class="desc" x="${n.x + 12}" y="${n.y + 31}">${esc(trunc(desc, 26))}</text></g>`);
    }
    out.push('</svg>');
    $('svgwrap').innerHTML = out.join('');
    $('svgwrap').querySelectorAll('[data-tag]').forEach(g => g.addEventListener('click', ev => { ev.stopPropagation(); select({ type: 'node', id: g.getAttribute('data-tag') }); }));
    $('svgwrap').querySelectorAll('[data-edge]').forEach(g => g.addEventListener('click', ev => { ev.stopPropagation(); select({ type: 'edge', id: g.getAttribute('data-edge') }); }));
    function brokenTag(t) { return state.sim && D.impacts[state.ds][state.sim].brokenChannels.some(id => chMap.get(id).tags.indexOf(t) >= 0); }
  }
  const trunc = (s, n) => (s || '').length > n ? s.slice(0, n - 1) + '…' : s;
  const pathD = pts => pts.map((p, i) => (i ? 'L' : 'M') + p.x + ' ' + p.y).join(' ');

  /* --------------------------------------------------- paneler */
  function statusBar() {
    const s = M.summary;
    const pill = (cls, t) => `<span class="pill ${cls}">${t}</span>`;
    let h = `<b>${esc(D.datasets[state.ds].title)}</b> &nbsp; ${s.rooms} rom · ${s.cabinets} kabinetter · ${s.equipment} utstyr · ${s.cables} kabler · ${s.patches} patcher · ${s.channels} registrerte kanaler &nbsp; `;
    h += s.errors ? pill('err', s.errors + ' feil') : pill('ok', '0 feil');
    h += s.warnings ? pill('warn', s.warnings + ' advarsler') : '';
    if (state.ds === 'revb') h += pill('', `Endringer: +${D.diff.summary.added} / −${D.diff.summary.removed} / ~${D.diff.summary.changed}`);
    h += ` <label style="float:right">Zoom <select id="zoom"><option value="fit">Tilpass</option><option value="0.75">75 %</option><option value="1">100 %</option></select></label>`;
    $('status').innerHTML = h;
    $('zoom').value = String(state.zoom);
    $('zoom').onchange = ev => { state.zoom = ev.target.value === 'fit' ? 'fit' : +ev.target.value; render(); };
  }

  function legend() {
    $('legend').innerHTML = [
      `<span><i style="border-color:#3E4C59"></i>Kobberkabel</span>`,
      `<span><i style="border-color:#0B6BCB;border-top-width:3px"></i>Fiberkabel</span>`,
      `<span><i style="border-color:#3E4C59;border-top-style:dashed"></i>Patch</span>`,
      `<span><i style="border-color:#E8590C;border-top-width:3px"></i>Valgt registrert sti</span>`,
      `<span><i style="border-color:#C62828;border-top-style:dashed"></i>Feil / brutt / fjernet</span>`,
      state.ds === 'revb' ? `<span><i style="border-color:#2E7D32;border-top-width:3px"></i>Lagt til</span><span><i style="border-color:#B26A00;border-top-width:3px"></i>Endret</span>` : '',
      Object.keys(SYS).map(s => `<span><b style="display:inline-block;width:5px;height:12px;background:${SYS[s]};vertical-align:middle;margin-right:5px"></b>${s}</span>`).join('')
    ].join('');
  }

  function chainHTML(nodes, conns, ends) {
    const h = ['<div class="chain">'];
    nodes.forEach((n, i) => {
      const e = eqMap.get(n.tag);
      h.push(`<div class="hop"><span class="dev">${esc(n.tag)}</span><span class="port">${esc(n.port)}</span><span class="muted">${esc(e ? e.room : 'ukjent')}</span></div>`);
      const c = conns[i];
      if (!c) return;
      if (c.kind === 'internal') h.push(`<div class="conn internal">intern panelforbindelse</div>`);
      else if (c.kind === 'through') h.push(`<div class="conn through">gjennom svitsj – konfigurasjon/VLAN ikke dokumentert</div>`);
      else {
        const l = linkMap.get(c.id);
        h.push(`<div class="conn${isFiber(l) ? ' fiber' : ''}"><b class="tag">${esc(c.id)}</b> · ${l.kind === 'cable' ? 'kabel' : 'patch'} · ${esc(l.cableType) || '<span class="missing">type mangler</span>'} · ${l.length != null ? l.length + ' m' : '<span class="missing">lengde mangler</span>'}</div>`);
      }
    });
    if (ends) ends.forEach(en => { if (en.status !== 'ok') h.push(`<div class="end-${en.status}">⚠ Sti ender ${en.status === 'open' ? 'åpent' : 'i ukjent utstyr'} i ${esc(en.tag)}:${esc(en.port)}${en.reason ? ' – ' + esc(en.reason) : ''}</div>`); });
    h.push('</div>');
    return h.join('');
  }

  function srcText(s) { return s ? `<span class="src">Kilde: ${esc(s.file)} linje ${s.line}</span>` : ''; }

  function detail() {
    const P = $('detail');
    const sel = state.sel;
    if (!sel) { P.innerHTML = '<h2>Detaljer</h2><p class="muted">Klikk på et utstyr for å fremheve registrerte forbindelsesstier, eller på en linje for kabeldetaljer.</p>'; return; }
    if (sel.type === 'node') {
      const e = eqMap.get(sel.id);
      if (!e) {
        const refs = M.links.filter(l => l.a.tag === sel.id || l.b.tag === sel.id);
        P.innerHTML = `<h2>Ukjent endepunkt</h2><h3 class="tag">${esc(sel.id)}</h3><p class="missing">Finnes ikke i equipment.csv. Referert av: ${refs.map(l => esc(l.id)).join(', ')}</p>`;
        return;
      }
      const used = e.ports.filter(p => M.links.some(l => l.valid && ((l.a.tag === e.tag && l.a.port === p) || (l.b.tag === e.tag && l.b.port === p))));
      const chans = M.channels.filter(c => c.tags.indexOf(e.tag) >= 0);
      const room = M.rooms.find(r => r.id === e.room);
      const v = (x, miss) => x ? esc(x) : `<span class="missing">${miss || 'ikke registrert'}</span>`;
      let h = `<h2>Utstyr</h2><h3 class="tag">${esc(e.tag)}</h3><div class="muted">${esc(e.description)}</div>
        <dl class="kv"><dt>Type</dt><dd>${esc(e.typeLabel)}</dd><dt>System</dt><dd>${v(e.system)}</dd>
        <dt>Rom</dt><dd>${e.room ? esc(e.room) + (room ? ' ' + esc(room.name) : ' <span class="missing">(ukjent rom)</span>') : '<span class="missing">MANGLER</span>'}</dd>
        <dt>Kabinett / U</dt><dd>${e.cabinet ? esc(e.cabinet) + (e.rackU ? ' / U' + e.rackU : '') : '–'}</dd>
        <dt>Modell</dt><dd>${v(e.model)}</dd><dt>Porter i bruk</dt><dd>${used.length} av ${e.ports.length}${used.length ? ' <span class="tag muted">(' + used.map(esc).join(', ') + ')</span>' : ''}</dd></dl>`;
      if (e.problems.length) h += `<p class="missing">⚠ ${e.problems.map(esc).join('; ')}</p>`;
      h += srcText(e.src);
      h += `<h2 style="margin-top:12px">Registrerte fysiske stier (${chans.length})</h2>`;
      h += chans.length ? chans.map(c => `<div class="muted">${esc(c.id)}${c.complete ? '' : ' – <span class="missing">ufullstendig</span>'}</div>` + chainHTML(c.nodes, c.conns, c.ends)).join('') : '<p class="missing">Ingen registrerte kabler/patcher.</p>';
      const lg = M.logical.filter(l => l.from === e.tag || l.to === e.tag);
      if (lg.length) h += `<h2>Logiske forbindelser</h2>` + lg.map(l => `<div>${esc(l.id)} ${esc(l.from)} → ${esc(l.to)} <span class="muted">(${esc(l.service)})</span> – ${l.route ? 'fysisk kjede registrert' : '<span class="missing">ingen fysisk kjede</span>'}</div>`).join('');
      P.innerHTML = h;
      return;
    }
    if (sel.type === 'edge') {
      const e = LY.edges.find(x => x.id === sel.id);
      let h = `<h2>Forbindelse ${esc(e.a)} – ${esc(e.b)}</h2>`;
      e.links.forEach(id => {
        const l = linkMap.get(id);
        h += `<div style="margin-bottom:10px"><h3 class="tag">${esc(l.id)}</h3><dl class="kv">
          <dt>Kategori</dt><dd>${l.kind === 'cable' ? 'Installert kabel' : 'Patch'}</dd>
          <dt>Fra</dt><dd class="tag">${esc(l.a.tag)}:${esc(l.a.port)}</dd><dt>Til</dt><dd class="tag">${esc(l.b.tag)}:${esc(l.b.port)}</dd>
          <dt>Type</dt><dd>${l.cableType ? esc(l.cableType) : '<span class="missing">ikke registrert</span>'}</dd>
          <dt>Lengde</dt><dd>${l.length != null ? l.length + ' m' : '<span class="missing">ikke registrert</span>'}</dd>
          <dt>Status</dt><dd>${l.problems.length ? '<span class="missing">' + l.problems.map(esc).join('; ') + '</span>' : 'OK'}</dd></dl>${srcText(l.src)}<br>
          ${l.valid ? `<button class="btn-sim" data-sim="${esc(l.id)}">${state.sim === l.id ? 'Avslutt simulering' : 'Simuler fjerning av ' + esc(l.id)}</button>` : ''}
          ${state.sim === l.id ? impactHTML(l.id) : ''}</div>`;
      });
      P.innerHTML = h;
      P.querySelectorAll('[data-sim]').forEach(b => b.onclick = () => { const id = b.getAttribute('data-sim'); state.sim = state.sim === id ? null : id; update(); });
      return;
    }
    if (sel.type === 'logical') {
      const lg = M.logical.find(l => l.id === sel.id);
      let h = `<h2>Logisk forbindelse (registrert)</h2><h3>${esc(lg.id)} ${esc(lg.from)} → ${esc(lg.to)}</h3><div class="muted">${esc(lg.service)} – ${esc(lg.note)}</div>`;
      h += lg.hops ? `<h2 style="margin-top:10px">Beregnet fysisk kjede</h2>` + chainHTML(lg.hops.nodes, lg.hops.conns) : '<p class="missing">Ingen registrert fysisk kjede funnet.</p>';
      h += `<p class="note">Kjeden er funnet ved å følge registrerte kabler, patcher og interne panelforbindelser. Den sier ingenting om VLAN, ruting eller om tjenesten faktisk fungerer.</p>`;
      P.innerHTML = h;
    }
  }

  function impactHTML(id) {
    const imp = D.impacts[state.ds][id];
    let h = `<div class="impact"><b>Simulert fjerning av ${esc(id)}</b><br>Registrerte fysiske stier som brytes (${imp.brokenChannels.length}):<ul>`;
    imp.brokenChannels.forEach(cid => { const c = chMap.get(cid); h += `<li>${esc(cid)}: ${esc(c.ends[0].tag)}:${esc(c.ends[0].port)} → ${esc(c.ends[1].tag)}:${esc(c.ends[1].port)}</li>`; });
    h += '</ul>';
    if (imp.logical.length) {
      h += 'Registrerte logiske forbindelser som brukte denne kjeden:<ul>';
      imp.logical.forEach(l => { h += `<li>${esc(l.id)} ${esc(l.from)} → ${esc(l.to)}: ${l.alternative ? 'annen registrert fysisk kjede finnes' : 'ingen annen registrert fysisk kjede i datasettet'}</li>`; });
      h += '</ul>';
    }
    h += `<div class="note">Viser bare hvilke <i>registrerte fysiske stier</i> som brytes. Det påstås ikke at tjenester faller ut – redundans, trådløse/alternative ruter og konfigurasjon er ikke dokumentert i datasettet.</div></div>`;
    return h;
  }

  function logicalPanel() {
    const P = $('logical');
    P.innerHTML = `<h2>Logiske forbindelser (registrert, adskilt fra kabling)</h2><ul class="list">` + M.logical.map(l =>
      `<li data-lg="${esc(l.id)}" class="${state.sel && state.sel.type === 'logical' && state.sel.id === l.id ? 'sel' : ''}"><b>${esc(l.id)}</b> ${esc(l.from)} → ${esc(l.to)} <span class="muted">${esc(l.service)}</span> ${l.route ? '<span class="muted">· fysisk kjede registrert</span>' : '<span class="missing">· ingen fysisk kjede</span>'}</li>`).join('') + '</ul>';
    P.querySelectorAll('[data-lg]').forEach(li => li.onclick = () => select({ type: 'logical', id: li.getAttribute('data-lg') }));
  }

  function changesPanel() {
    const P = $('changes');
    if (state.ds !== 'revb') { P.innerHTML = ''; return; }
    const k = { equipment: 'Utstyr', link: 'Kabel/patch', internal: 'Intern', logical: 'Logisk' };
    let h = `<h2>Endringer mot basis</h2><ul class="list">` + D.diff.changes.map((c, i) =>
      `<li data-chg="${i}"><span class="chg ${c.change}">${CHG[c.change]}</span> ${k[c.kind]} <b class="tag">${esc(c.id)}</b><br><span class="muted">${c.change === 'changed' ? c.fields.map(f => `${esc(f.name)}: ${esc(f.before || '–')} → ${esc(f.after || '–')}`).join('; ') : esc(c.label)}</span></li>`).join('') + '</ul>';
    h += `<h2 style="margin-top:10px">Påvirkede registrerte kanaler</h2><ul class="list">` +
      D.diff.channelChanges.removed.map(x => `<li><span class="chg removed">BORTFALT</span> ${esc(x)}</li>`).join('') +
      D.diff.channelChanges.added.map(x => `<li><span class="chg added">NY</span> ${esc(x)}</li>`).join('') + '</ul>';
    P.innerHTML = h;
    P.querySelectorAll('[data-chg]').forEach(li => li.onclick = () => {
      const c = D.diff.changes[+li.getAttribute('data-chg')];
      if (c.kind === 'equipment' && eqMap.has(c.id)) select({ type: 'node', id: c.id });
      else if (c.kind === 'link' && linkMap.has(c.id)) { const e = LY.edges.find(x => x.links.indexOf(c.id) >= 0); if (e) select({ type: 'edge', id: e.id }); }
    });
  }

  function issuesPanel() {
    const P = $('issues');
    const iss = M.issues;
    let h = `<h2>Dokumentasjonsfeil og mangler (${iss.length})</h2>`;
    if (!iss.length) h += '<p class="muted">Ingen avvik funnet.</p>';
    h += '<ul class="list">' + iss.map((x, i) => `<li data-iss="${i}"><span class="sev ${x.severity}">${SEV[x.severity]}</span> ${esc(x.message)}<br><span class="src">${esc(x.code)}${x.source ? ' · ' + esc(x.source.file) + ' linje ' + x.source.line : ''}</span></li>`).join('') + '</ul>';
    P.innerHTML = h;
    P.querySelectorAll('[data-iss]').forEach(li => li.onclick = () => {
      const x = iss[+li.getAttribute('data-iss')];
      const lk = x.refs.find(r => linkMap.has(r));
      const tag = x.refs.find(r => LY.nodes.some(n => n.tag === r));
      if (lk) { const e = LY.edges.find(y => y.links.indexOf(lk) >= 0); if (e) return select({ type: 'edge', id: e.id }); }
      if (tag) select({ type: 'node', id: tag });
    });
  }

  function select(s) { state.sel = s; state.sim = null; update(); }
  function update() { statusBar(); legend(); render(); detail(); logicalPanel(); changesPanel(); issuesPanel(); }

  $('dataset').onchange = ev => { state.ds = ev.target.value; state.sel = null; state.sim = null; load(); update(); };
  $('roomFilter').onchange = ev => { state.room = ev.target.value; update(); };
  $('sysFilter').onchange = ev => { state.sys = ev.target.value; update(); };
  $('clear').onclick = () => { state.sel = null; state.sim = null; state.room = ''; state.sys = ''; $('roomFilter').value = ''; $('sysFilter').value = ''; update(); };
  $('svgwrap').addEventListener('click', () => { if (state.sel) { state.sel = null; state.sim = null; update(); } });

  // dyplenke: ?ds=revb&sel=CAM-211
  const q = new URLSearchParams(location.search);
  if (q.get('ds') && D.datasets[q.get('ds')]) { state.ds = q.get('ds'); $('dataset').value = state.ds; }
  if (q.get('zoom')) state.zoom = q.get('zoom') === 'fit' ? 'fit' : +q.get('zoom');
  load();
  if (q.get('sel')) state.sel = { type: q.get('type') || 'node', id: q.get('sel') };
  if (q.get('sim')) state.sim = q.get('sim');
  update();
})();
