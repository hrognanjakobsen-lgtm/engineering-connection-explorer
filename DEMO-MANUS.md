# Demonstrasjonsmanus – 3 minutter

**Forberedelse:** kjør `npm start`, åpne http://localhost:8080/web/ og ha `out/engineering-connections.drawio` klar i draw.io.

---

**0:00 – Utgangspunktet (20 s)**
«Dette er fiktive data i samme form som du har i PATCH MANAGER: rom, kabinetter, utstyrstagger med porter, kabler, patcher og interne panelforbindelser. Det er sju CSV-filer og ingen database. Alt du ser, genereres fra disse filene.»
→ Pek på statuslinjen: 4 rom, 3 kabinetter, 20 utstyr, 0 feil, 1 advarsel.

**0:20 – Oversikten (30 s)**
«Utstyret er gruppert etter rom og kabinett, med kabinettene sortert etter U-posisjon. Fiber er blå, kobber grå og patcher stiplet. Én linje samler alle kablene mellom to enheter.»
→ Velg **Rom = RM-210** og deretter **System = CCTV**, og vis at resten dimmes. Klikk *Nullstill valg*.

**0:50 – Følg en forbindelse (40 s)**
→ Klikk **CAM-211**.
«Stien er beregnet av kode, ikke gjettet: kamera → W-210-011 → CPP-210-01 R01, intern forbindelse til F01 → patch PC-210-001 → SW-210-01 port 1. Hvert ledd er en registrert rad.»
→ Klikk **L-001** under logiske forbindelser.
«Her følger jeg kjeden helt til VMS-serveren, via fibertrunken W-110-210. Jeg påstår ikke at videoen faktisk går denne veien. Jeg viser bare at kablingen er registrert hele veien. VLAN og konfigurasjon finnes ikke i datasettet.»

**1:30 – Simuler kabelfjerning (20 s)**
→ Klikk den blå linjen mellom FPP-210-01 og FPP-110-01, og deretter **Simuler fjerning av W-110-210**.
«Én registrert fysisk sti brytes, og L-001 har ingen annen registrert kjede. Om tjenesten faktisk faller ut, kan ikke dataene si noe om.»

**1:50 – Dokumentasjonsfeil (25 s)**
→ Velg datasettet **Feildatasett**.
«Her har jeg lagt inn tre vanlige feil: en kabel til en tag som ikke finnes, CAM-215, to patcher på samme svitsjport og et kamera uten rom. Alle tre fanges opp med fil og linjenummer. Ukjent og uplassert utstyr havner i en egen rød gruppe i stedet for å forsvinne.»

**2:15 – Revisjon (20 s)**
→ Velg **Revisjon B**.
«CAM-214 er flyttet fra Nord til Sør, og en patch er flyttet fra port 6 til 7. Endringslisten viser nøyaktig det som er lagt til, fjernet og endret. Den gamle plasseringen vises stiplet. Resten av tegningen står stille, fordi plasseringene er låst.»

**2:35 – draw.io og automatisering (25 s)**
→ Bytt til draw.io: side 1 totaloversikt, side 2 romdetalj med porter, side 3 stien med kabeltagger.
«Dette er ordinære, redigerbare draw.io-sider, generert fra samme modell. Den samme generatoren kjører også i n8n: én klikkbar workflow validerer data og lager tegninger og rapporter, uten manuelt tegnearbeid.»

**3:00 – Slutt**
«Poenget er at strukturerte data gir oss tegningene, kontrollene og dokumentasjonen gratis, og at feilene i dataene blir synlige.»
