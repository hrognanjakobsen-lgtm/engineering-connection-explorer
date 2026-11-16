# Engineering Connection Explorer

Demonstrator som viser hvordan strukturerte utstyrs- og kabeldata (slik de finnes i f.eks. PATCH MANAGER)
automatisk kan bli blokkdiagrammer, redigerbare draw.io-tegninger og dokumentasjon.
**Kun fiktive data. Ingen tilkobling til eksterne systemer.**

## Start

Krever Node.js 18 eller nyere. Prosjektet har ingen avhengigheter, så `npm install` trengs ikke.

```bash
npm start
```

Åpne http://localhost:8080/web/. Kommandoen bygger alt fra CSV-filene og starter en liten lokal server.

| Kommando | Hva den gjør |
|---|---|
| `npm run build` | Genererer `out/` (modell, `.drawio`, rapporter, data til visningen) |
| `npm test` | Bygger og kjører 41 automatiske kontroller |
| `npm run n8n` | Genererer n8n-workflowen i `n8n/` fra samme kjerne og data |

`web/index.html` kan også åpnes direkte som fil etter `npm run build`.

## Innhold

```
data/base/      gyldig basisdatasett (4 rom, 3 kabinetter, 20 tagger)
data/errors/    samme data med 3 bevisste feil
data/rev-b/     revisjon B: CAM-214 flyttet, PC-110-002 flyttet til annen svitsjport
data/layout-lock.json  låste plasseringer for utstyr utenfor kabinett (stabil layout)
src/core.js     felles kjerne: CSV → datamodell → kontroller → stier → layout → draw.io/rapport/diff
src/build.js    CLI-bygg til out/
web/            nettleservisning (leser out/data.js)
n8n/            importerbar n8n-workflow
out/            genererte filer (.drawio, rapporter, kabelliste)
docs/preview/   PNG-forhåndsvisninger (se merknad under)
test/verify.js  verifikasjon
DEMO-MANUS.md   demonstrasjonsmanus på 3 minutter
```

## Datamodell (CSV)

| Fil | Innhold |
|---|---|
| `rooms.csv` | rom, med `grid_col`/`grid_row` for fast plassering i oversikten |
| `cabinets.csv` | kabinett → rom |
| `equipment.csv` | tag, type, system, rom, kabinett, U, portliste (`1-28`, `F01-F12;R01-R12`, `ETH0`) |
| `cables.csv` | installerte kabler: kabeltag, fra-tag/port, til-tag/port, type, lengde |
| `patching.csv` | patchekabler, i samme format |
| `internal.csv` | eksplisitte interne forbindelser i panel (front ↔ bakside) |
| `logical_links.csv` | registrerte logiske behov (f.eks. kamera → VMS-server), holdt adskilt fra kablingen |

## Viktige valg

- **Én modell for alt.** Nettleser, draw.io, rapporter, endringsliste og n8n bruker samme `src/core.js`.
- **Deterministisk, ingen AI i stisøket.** Stier følges bare gjennom registrerte kabler, patcher og *eksplisitte* interne panelforbindelser. Mangler en intern forbindelse eller patch, vises stien som åpen. Den fylles ikke inn med gjetning.
- **Fysisk og logisk er adskilt.** Logiske forbindelser sjekkes bare mot om en registrert fysisk kjede finnes. Verktøyet utleder ingen VLAN, redundans eller tjenestetilgjengelighet. Simulert kabelfjerning viser hvilke *registrerte fysiske stier* som brytes, ikke om en tjeneste faller ut.
- **Kontroller:** ukjent endepunkt, ukjent port, dobbeltbruk av port (også interne), manglende eller ukjent rom, kabinett i feil rom, duplikate tagger, manglende lengde eller kabeltype, åpne stier og logiske behov uten fysisk kjede. Hvert avvik peker til CSV-fil og linje.
- **Stabil layout.** Rom plasseres i et fast rutenett. Utstyr i kabinett sorteres etter U-posisjon, og feltutstyr får låste plasser fra `layout-lock.json`. Testen bekrefter at bare det flyttede kameraet endrer posisjon i revisjon B. Slett låsefilen for å lage plasseringene på nytt.
- **Ortogonal ruting.** Linjene rutes med A* på et rutenett på 10 px. Ruteren straffer knekk, overlapp og kryssing, og kanter med kryssinger rutes på nytt. Etiketter plasseres bare der de ikke kolliderer. Én linje i oversikten representerer alle kabler mellom samme utstyrspar.

## draw.io

`out/engineering-connections.drawio` har tre sider, generert fra samme modell:

1. **Totaloversikt.** Rom og kabinetter er containere, utstyret har systemfarget stripe, og linjene er ortogonale med kabeltagger. Kobber, fiber og patch har ulik strek.
2. **Romdetalj RM-210.** Én rad per registrert fysisk kanal, porter på utstyret og kabeltag, type og lengde over linjen.
3. **Forbindelsessti L-001.** CAM-211 → SRV-110-01 med alle porter, kabeltagger og rom.

Det lages også egne filer for revisjon B og feildatasettet. Åpne dem i draw.io (desktop eller app.diagrams.net). Alt kan redigeres.

**Om forhåndsvisningene:** draw.io Desktop/CLI var ikke tilgjengelig, så det ble ikke gjort noen offisiell bildeeksport.
PNG-filene i `docs/preview/drawio-side-*.png` er rendret fra `.drawio`-filen med mxGraph, som er draw.io sitt grafbibliotek, i headless Chromium (`tools/render-drawio.js`).
Gjengivelsen ligger nær draw.io, men skrifttyper og enkelte stiler kan avvike litt.

## n8n

`n8n/engineering-connection-explorer.workflow.json`:
**Start demo** (manuell trigger) → **Last eksempeldata** → **Valider datamodell** → **Generer draw.io og rapporter** → **Lag filer** (Convert to File) → **Resultat**.

**Kobling til generatoren:** hele kjernen kjøres i n8n sine Code-noder som ren JavaScript, uten `require` og uten nettverk.
Det fungerer derfor både i n8n Cloud, som ikke kan starte lokale programmer, og i selvdriftet n8n. Det trengs verken server, webhook eller tunnel.
Eksempeldataene ligger innebygd i Code-noden. Kjernen er minifisert til `n8n/core.min.js` med terser.

**Oppsett:**
1. Gå til n8n → *Workflows* → *Import from file*, og velg `n8n/engineering-connection-explorer.workflow.json`.
2. Klikk *Execute workflow*.
3. Åpne noden **Resultat**. Første item inneholder sammendrag med `baseIsValid`, `deliberateErrorsDetected`, de tre feilene, kjent sti og revisjonsendringer. Under *Binary* kan du laste ned `.drawio` og rapportene.

**Tilganger:** ingen credentials eller hemmeligheter. Det eneste som kreves, er rett til å importere og kjøre workflows og bruke Code-noden, som er standard.
Med egne data i stedet for innebygde eksempler kan du sette inn en HTTP Request-node før «Valider datamodell», med credential lagret i n8n og ikke i workflowfilen.
En **Read/Write Files from Disk**-node fungerer bare i selvdriftet n8n.

**Status:**
- Kodenodene er kjørt lokalt med samme kode (`node src/build-n8n.js --simulate`), inkludert rundtur for `.drawio` via base64.
- Nodeformatene er validert mot n8n-instansen via n8n sitt MCP-verktøy (`valid: true`, 6 noder).
- **Workflowen er ikke importert eller kjørt i n8n.**

## Verifikasjon (`npm test`)

Testen kontrollerer:
- Alt utstyr og alle gyldige kabler vises, og det er ingen overlappende bokser eller etiketter.
- Alle linjer er ortogonale.
- Nøyaktig de tre bevisste feilene oppdages.
- L-001 starter i CAM-211:ETH0 og ender i SRV-110-01:NIC1 via forventede kabler.
- Revisjon B gir nøyaktig de faktiske endringene, og plasseringene er stabile.
- Simulert fjerning av W-110-210 bryter én registrert kanal.
- `.drawio` har tre sider, unike ID-er og gyldige referanser.
