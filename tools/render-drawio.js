#!/usr/bin/env node
/*
 * Valgfritt verktøy: render sidene i en .drawio-fil til PNG med mxGraph (draw.io sitt
 * grafbibliotek) i headless Chromium. Brukes til visuell kontroll når draw.io Desktop
 * ikke er installert. Gjengivelsen er en tilnærming av draw.io-appen (samme modell og
 * geometri, men uten draw.io sitt fulle stilark).
 *
 * Krever: npm-pakken mxgraph og playwright (oppgi sti til mxClient.js med MXCLIENT=...).
 * Bruk:   MXCLIENT=/sti/til/mxClient.js node tools/render-drawio.js out/fil.drawio out/png
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const [file, outDir] = process.argv.slice(2);
  const mx = process.env.MXCLIENT;
  if (!file || !outDir || !mx) { console.error('Bruk: MXCLIENT=... node tools/render-drawio.js <fil.drawio> <utmappe>'); process.exit(1); }
  fs.mkdirSync(outDir, { recursive: true });
  const xml = fs.readFileSync(file, 'utf8');
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: +(process.env.SCALE || 1) });
  await page.setContent('<html><body style="margin:0;background:#fff"><div id="g" style="position:relative"></div></body></html>');
  await page.addScriptTag({ content: 'window.mxBasePath="";window.mxLoadResources=false;window.mxLoadStylesheets=false;' });
  await page.addScriptTag({ path: mx });
  const pages = await page.evaluate((xml) => {
    const doc = mxUtils.parseXml(xml);
    return Array.from(doc.getElementsByTagName('diagram')).map(d => d.getAttribute('name'));
  }, xml);
  for (let i = 0; i < pages.length; i++) {
    const size = await page.evaluate(({ xml, i }) => {
      const c = document.getElementById('g'); c.innerHTML = '';
      const doc = mxUtils.parseXml(xml);
      const d = doc.getElementsByTagName('diagram')[i];
      const gm = mxUtils.parseXml(mxUtils.getXml(d.getElementsByTagName('mxGraphModel')[0])).documentElement;
      const graph = new mxGraph(c);
      graph.setHtmlLabels(true);
      graph.foldingEnabled = false;
      const ss = graph.getStylesheet();
      ss.putCellStyle('text', { fillColor: 'none', strokeColor: 'none', shape: 'rectangle' });
      const ds = ss.getDefaultVertexStyle(); ds.fontFamily = 'Helvetica'; ds.fontColor = '#1F2933';
      const es = ss.getDefaultEdgeStyle(); es.fontFamily = 'Helvetica';
      new mxCodec(gm.ownerDocument).decode(gm, graph.getModel());
      const b = graph.getGraphBounds();
      graph.view.setTranslate(-b.x + 20, -b.y + 20);
      return { w: Math.ceil(b.width + 40), h: Math.ceil(b.height + 40) };
    }, { xml, i });
    await page.setViewportSize({ width: size.w, height: size.h });
    const name = path.join(outDir, `side-${i + 1}.png`);
    await page.screenshot({ path: name, clip: { x: 0, y: 0, width: size.w, height: size.h } });
    console.log(`${pages[i]} -> ${name} (${size.w}x${size.h})`);
  }
  await browser.close();
})();
