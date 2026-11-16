#!/usr/bin/env node
/*
 * Genererer n8n-workflowen fra samme kjerne (src/core.js) og samme CSV-er (data/).
 *  - n8n/engineering-connection-explorer.workflow.json  -> importer i n8n (Workflows > Import from file)
 *  - n8n/engineering-connection-explorer.sdk.js         -> samme workflow i n8n Workflow SDK-format
 *
 * Valg: hele generatoren kjøres i n8n sine Code-noder (ren JavaScript, ingen require, ingen nettverk).
 * Det fungerer også i n8n Cloud, som ikke kan starte lokale programmer. Ingen credentials trengs.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ECE = require('./core');

const ROOT = path.resolve(__dirname, '..');
const OUTDIR = path.join(ROOT, 'n8n');
fs.mkdirSync(OUTDIR, { recursive: true });

// Bruk minifisert kopi (n8n/core.min.js, laget med terser) hvis den finnes og er nyere enn core.js – ellers kildekoden.
const minPath = path.join(OUTDIR, 'core.min.js'), srcPath = path.join(__dirname, 'core.js');
const useMin = fs.existsSync(minPath) && fs.statSync(minPath).mtimeMs >= fs.statSync(srcPath).mtimeMs;
const core = fs.readFileSync(useMin ? minPath : srcPath, 'utf8');
const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'layout-lock.json'), 'utf8'));
const readDir = dir => { const f = {}; ECE.FILES.forEach(n => { const p = path.join(ROOT, 'data', dir, n + '.csv'); if (fs.existsSync(p)) f[n + '.csv'] = fs.readFileSync(p, 'utf8'); }); return f; };
const DATA = {
  datasets: {
    base: { title: 'Basis (gyldig)', files: readDir('base') },
    errors: { title: 'Feildatasett (3 bevisste feil)', files: readDir('errors') },
    revb: { title: 'Revisjon B', files: readDir('rev-b') }
  },
  lock
};

const LIB = `// Engineering Connection Explorer – kjernebibliotek (kopi av src/core.js, generert av src/build-n8n.js)\n` +
  `const ECE = (() => { const module = { exports: {} };\n${core}\nreturn module.exports; })();\n`;

const codeLoad = `// 1) Last eksempeldata. Kun FIKTIVE data, innebygd som CSV-tekst (generert fra data/).
// Egne data: bytt ut DATA, eller sett inn en HTTP Request-node (CSV fra intern filserver/Git) foran denne.
const DATA = ${JSON.stringify(DATA)};
return [{ json: DATA }];
`;

const codeValidate = LIB + `
// 2) Bygg felles datamodell og kjør deterministiske kontroller (referanser, porter, rom, stier).
const input = $input.first().json;
const validation = {};
for (const key of Object.keys(input.datasets)) {
  const ds = input.datasets[key];
  const model = ECE.buildModel(ECE.parseDataset(ds.files));
  validation[key] = {
    title: ds.title,
    summary: model.summary,
    issues: model.issues.map(i => ({ severity: i.severity, code: i.code, message: i.message, source: i.source ? i.source.file + ':' + i.source.line : '' }))
  };
}
const found = validation.errors.issues.filter(i => i.severity === 'error').map(i => i.code).sort();
const expected = ['MISSING_ROOM', 'PORT_DOUBLE_USE', 'UNKNOWN_ENDPOINT'];
return [{ json: {
  baseIsValid: validation.base.summary.errors === 0,
  deliberateErrorsDetected: JSON.stringify(found) === JSON.stringify(expected),
  validation,
  datasets: input.datasets,
  lock: input.lock
} }];
`;

const codeGenerate = LIB + `
// 3) Generer redigerbart draw.io-diagram (3 sider), rapporter og endringsliste fra samme modell.
const inp = $input.first().json;
const opts = t => ({ lock: inp.lock, title: t, roomId: 'RM-210', logicalId: 'L-001' });
const base = ECE.runPipeline(inp.datasets.base.files, opts(inp.datasets.base.title));
const errs = ECE.runPipeline(inp.datasets.errors.files, opts(inp.datasets.errors.title));
const revb = ECE.runPipeline(inp.datasets.revb.files, opts(inp.datasets.revb.title));
const diff = ECE.diffModels(base.model, revb.model);
const lg = base.model.logical.find(l => l.id === 'L-001');
const hops = ECE.routeHops(base.model, lg.route);
const impact = ECE.removalImpact(base.model, 'W-110-210');
const meta = {
  knownPath: hops.nodes[0].tag + ':' + hops.nodes[0].port + ' -> ' + hops.nodes[hops.nodes.length - 1].tag + ':' + hops.nodes[hops.nodes.length - 1].port,
  revisionChanges: diff.summary,
  simulatedRemoval: { cable: 'W-110-210', brokenRegisteredPaths: impact.brokenChannels.length, note: 'Viser registrerte fysiske stier som brytes – ikke tjenestestatus.' }
};
const files = [
  { fileName: 'engineering-connections.drawio', mimeType: 'application/xml', content: base.drawio },
  { fileName: 'engineering-connections-rev-b.drawio', mimeType: 'application/xml', content: revb.drawio },
  { fileName: 'rapport-basis.md', mimeType: 'text/markdown', content: base.report },
  { fileName: 'rapport-feil.md', mimeType: 'text/markdown', content: errs.report },
  { fileName: 'endringer-rev-b.md', mimeType: 'text/markdown', content: ECE.buildDiffReport(diff) }
];
return files.map(f => ({ json: Object.assign({ fileName: f.fileName, mimeType: f.mimeType, bytes: f.content.length, b64: ECE.utf8ToBase64(f.content) }, meta) }));
`;

const codeResult = `// 5) Resultat: sammendrag + filene som binærdata (last ned fra n8n sin output-visning).
const v = $('Valider datamodell').first().json;
const summary = {
  baseIsValid: v.baseIsValid,
  deliberateErrorsDetected: v.deliberateErrorsDetected,
  base: v.validation.base.summary,
  errorsFound: v.validation.errors.issues.filter(i => i.severity === 'error').map(i => i.code + ': ' + i.message),
  revb: v.validation.revb.summary
};
return $input.all().map((item, i) => ({
  json: Object.assign({ file: item.json.fileName, bytes: item.json.bytes }, i === 0 ? { summary, knownPath: item.json.knownPath, revisionChanges: item.json.revisionChanges, simulatedRemoval: item.json.simulatedRemoval } : {}),
  binary: item.binary
}));
`;

const nodes = [
  { name: 'Start demo', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, parameters: {} },
  { name: 'Last eksempeldata', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: codeLoad } },
  { name: 'Valider datamodell', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: codeValidate } },
  { name: 'Generer draw.io og rapporter', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: codeGenerate } },
  { name: 'Lag filer', type: 'n8n-nodes-base.convertToFile', typeVersion: 1.1, parameters: { operation: 'toBinary', sourceProperty: 'b64', options: { fileName: '={{ $json.fileName }}', mimeType: '={{ $json.mimeType }}' } } },
  { name: 'Resultat', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: codeResult } }
];

// --- importformat
const wf = {
  name: 'Engineering Connection Explorer (demo, fiktive data)',
  nodes: nodes.map((n, i) => ({ parameters: n.parameters, id: 'ece-node-' + (i + 1), name: n.name, type: n.type, typeVersion: n.typeVersion, position: [i * 240, 0] })),
  connections: {},
  settings: { executionOrder: 'v1' },
  pinData: {},
  meta: { templateCredsSetupCompleted: true }
};
for (let i = 0; i < nodes.length - 1; i++) wf.connections[nodes[i].name] = { main: [[{ node: nodes[i + 1].name, type: 'main', index: 0 }]] };
fs.writeFileSync(path.join(OUTDIR, 'engineering-connection-explorer.workflow.json'), JSON.stringify(wf, null, 2) + '\n');

// --- SDK-format (for oppretting via n8n MCP / API)
const v = n => JSON.stringify(n);
const sdk = `import { workflow, node, trigger, expr } from '@n8n/workflow-sdk';

const start = trigger({ type: 'n8n-nodes-base.manualTrigger', version: 1, config: { name: 'Start demo' } });
const load = node({ type: 'n8n-nodes-base.code', version: 2, config: { name: 'Last eksempeldata', parameters: { mode: 'runOnceForAllItems', jsCode: ${v(codeLoad)} } } });
const validate = node({ type: 'n8n-nodes-base.code', version: 2, config: { name: 'Valider datamodell', parameters: { mode: 'runOnceForAllItems', jsCode: ${v(codeValidate)} } } });
const generate = node({ type: 'n8n-nodes-base.code', version: 2, config: { name: 'Generer draw.io og rapporter', parameters: { mode: 'runOnceForAllItems', jsCode: ${v(codeGenerate)} } } });
const toFile = node({ type: 'n8n-nodes-base.convertToFile', version: 1.1, config: { name: 'Lag filer', parameters: { operation: 'toBinary', sourceProperty: 'b64', options: { fileName: expr('{{ $json.fileName }}'), mimeType: expr('{{ $json.mimeType }}') } } } });
const result = node({ type: 'n8n-nodes-base.code', version: 2, config: { name: 'Resultat', parameters: { mode: 'runOnceForAllItems', jsCode: ${v(codeResult)} } } });

export default workflow('engineering-connection-explorer', 'Engineering Connection Explorer (demo, fiktive data)')
  .add(start).to(load).to(validate).to(generate).to(toFile).to(result);
`;
fs.writeFileSync(path.join(OUTDIR, 'engineering-connection-explorer.sdk.js'), sdk);
console.log((useMin ? '[minifisert kjerne] ' : '[kildekjerne] ') + 'Skrevet n8n/engineering-connection-explorer.workflow.json (' + JSON.stringify(wf).length + ' tegn) og .sdk.js (' + sdk.length + ' tegn)');

// --- lokal simulering av Code-nodene (samme kode, n8n-lignende $input/$-API) for å fange feil før import
if (process.argv.indexOf('--simulate') >= 0) {
  const outputs = {};
  let items = [{ json: {} }];
  for (const n of nodes.slice(1)) {
    if (n.type === 'n8n-nodes-base.code') {
      const $input = { first: () => items[0], all: () => items };
      const $ = name => ({ first: () => outputs[name][0] });
      const fn = new Function('$input', '$', '"use strict";' + n.parameters.jsCode);
      items = fn($input, $);
    } else {
      items = items.map(it => ({ json: it.json, binary: { data: { data: it.json.b64, fileName: it.json.fileName, mimeType: it.json.mimeType } } }));
    }
    outputs[n.name] = items;
    console.log(`  ${n.name}: ${items.length} item(s)`);
  }
  console.log(JSON.stringify(items[0].json, null, 1).slice(0, 1500));
  const back = Buffer.from(items[0].binary.data.data, 'base64').toString('utf8');
  console.log('  drawio rundtur OK:', back === fs.readFileSync(path.join(ROOT, 'out', 'engineering-connections.drawio'), 'utf8'));
}
