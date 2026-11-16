# Instruksjoner for GitHub Copilot – Engineering Connection Explorer

Les dette før du endrer koden. Prosjektet genererer blokkdiagrammer, draw.io-filer og
dokumentasjon fra strukturerte utstyrs- og kabeldata (f.eks. eksport fra PATCH MANAGER).

## Ufravikelige regler

1. **Ingen oppdiktede forbindelser.** Stier beregnes bare av kode, fra registrerte kabler
   (`cables`), patcher (`patching`) og eksplisitte interne panelforbindelser (`internal`).
   Foreslå aldri kode, AI-kall eller heuristikk som fyller inn manglende ledd. En manglende patch
   eller intern forbindelse skal gi en *åpen sti* og et avvik, ikke en antatt kobling.
2. **Fysisk og logisk holdes adskilt.** `logical_links` beskriver registrerte behov. Det skal ikke
   utledes VLAN, redundans, ruting eller tjenestetilgjengelighet. Tekst i UI og rapporter må si
   «registrert fysisk sti», ikke «tjenesten virker» eller «tjenesten faller ut».
3. **Utledning må synes.** Hvis noe avledes (f.eks. `derivePorts`), skal det gi et `info`-avvik
   per objekt. Aldri stille.
4. **Deterministisk.** Samme inndata gir samme modell, layout og filer. Sorter eksplisitt. Ikke bruk
   `Math.random`, klokkeslett eller rekkefølge fra `Object.keys` på data som kan variere.
5. **Ingen avhengigheter og ingen nettverk i kjernen.** `src/core.js` skal kjøre uendret i Node,
   i nettleseren (også fra `file://` og som én frittstående HTML-fil) og i n8n sin Code-node.
   Ikke bruk `require`/`import` i core.js, og ikke bruk `fetch`, `Buffer` eller `fs` der.
6. **Ekte anleggsdata skal aldri inn i repoet.** `data/` inneholder kun fiktive data.
   Ikke legg inn eksempler, kolonnenavn med reelle tagger, IP-adresser eller romnavn fra anlegg.
   Reelle eksporter leses lokalt i nettleseren via importdialogen.

## Arkitektur

```
CSV/Excel ──(importTables + mapping)──► raw (7 kanoniske tabeller)
raw ──buildModel──► modell + kontroller (issues) + kanaler (computeChannels)
modell ──layoutModel──► layout (rom-rutenett, kabinetter etter U, A*-ortogonal ruting)
modell+layout ──buildDrawio / buildReport / buildCableCsv / diffModels──► filer
```

| Fil | Ansvar |
|---|---|
| `src/core.js` | **All logikk.** Parsing, import/mapping, kontroller, sporing, layout, ruter, draw.io, rapport, diff, zip/xlsx |
| `src/build.js` | CLI: bygger `out/` fra `data/` |
| `src/build-standalone.js` | Lager `out/engineering-connection-explorer.html` (alt innebygd) |
| `src/build-n8n.js` | Lager n8n-workflow med kjernen i Code-noder |
| `web/app.js` | Visning (SVG), filtre, valg, detaljpanel, simulering. Gjør ingen egne beregninger av stier |
| `web/import.js` | Importdialog: les filer lokalt → `ECE.runImport` → nytt datasett i visningen |
| `mappings/*.json` | Kolonnemappinger (data, ikke kode) |
| `test/verify.js` | Verifikasjon – kjør `npm test` etter hver endring |

## Kanonisk datamodell (mål for all import)

| Tabell | Felt (fet = påkrevd) |
|---|---|
| rooms | **room_id**, name, area, grid_col, grid_row |
| cabinets | **cabinet_id**, **room_id**, name, height_u |
| equipment | **tag**, description, **type**, system, room_id, cabinet_id, rack_u, ports |
| cables | **cable_tag**, **from_tag**, **from_port**, **to_tag**, **to_port**, cable_type, length_m |
| patching | **patch_tag**, **from_tag**, **from_port**, **to_tag**, **to_port**, cable_type, length_m |
| internal | **tag**, **port_a**, **port_b**, note |
| logical_links | **link_id**, **from_tag**, **to_tag**, service, note |

`type` må være en av `switch`, `server`, `camera`, `operator_station`, `fiber_patch_panel` eller `copper_patch_panel`.
Nye typer legges til i `TYPES` i core.js med `active: true` for aktivt utstyr og `false` for passivt.
Passivt utstyr er det stier føres gjennom. `ports` er en spesifikasjon: `1-28`, `F01-F12;R01-R12`, `ETH0;ETH1`.

## Tilpasse til en ny eksport (vanligste oppgave)

1. Kopier `mappings/eksempel-eksport.json` til en ny fil i `mappings/`.
2. Sett `source` (fil- eller arknavn, uten filendelse, uavhengig av store og små bokstaver) og
   `columns` for hvert felt.
3. Kolonnespesifikasjon: `"Kolonne"`, `["Alt1","Alt2"]` eller
   `{ "column", "map": {kildeverdi: målverdi}, "number": true, "format": "1-{value}", "split": {"sep": ":", "index": 0}, "const", "default" }`.
4. Kabler og patcher i samme tabell skilles med `"where": { "column": "Kategori", "equals": "Patch" }`.
5. Test i nettleseren: **Importer data… → velg filer → lim inn mapping → Bygg**. Rett `MAPPING_*`-feil først.
6. Mappingen skal være deklarativ. Trengs en ny transformasjon, legg den til i `importTables` med
   test i `test/verify.js`. Ikke skriv spesialkode for én kunde inn i visningen.

Typiske tilpasningspunkter for ekte eksporter, der det må tas eksplisitte valg:
- **Paneler der front og bak har samme portnummer.** Representer dem som `F05`/`R05` via
  `format`/`split`, og lag `internal`-rader fra eksporten. Ikke anta gjennomkobling i kode.
- **Port som «Objekt:Port» i én kolonne.** Bruk `split`.
- **Mangler portliste.** Bruk `derivePorts: true`, som gir INFO-avvik.

## Arbeidsflyt

- `npm test` skal være grønn før commit. Legg til test for ny logikk.
- `npm run build` gjenskaper `out/`, inkludert den frittstående HTML-filen.
- Hold UI-tekst på norsk, saklig og teknisk. Behold stilen: hvit bakgrunn, grå rammer og få aksentfarger.
- Layouten skal være stabil: ikke endre sorteringsrekkefølge eller rutenett uten grunn, og bruk `layout-lock`.
