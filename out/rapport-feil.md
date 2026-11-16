# Dokumentasjonsrapport – Feildatasett (3 bevisste feil)

_Generert automatisk av Engineering Connection Explorer fra fiktive CSV-data. Fysisk kabling og logiske forbindelser er holdt adskilt; ingen VLAN, redundans eller tjenestetilgjengelighet er utledet._

Rom: 4 · Kabinetter: 3 · Utstyr: 20 · Kabler: 12 · Patcher: 17 · Interne forbindelser: 16 · Fysiske kanaler: 12

**Kontroller:** 3 feil, 1 advarsler.

## Dokumentasjonsavvik

| Alvor | Kode | Beskrivelse | Kilde |
|---|---|---|---|
| FEIL | MISSING_ROOM | CAM-313 mangler rom (room_id er tomt) | equipment.csv:21 |
| FEIL | PORT_DOUBLE_USE | Port SW-210-01:3 brukes av både PC-210-003 og PC-210-006 | patching.csv:18 |
| FEIL | UNKNOWN_ENDPOINT | W-210-015: endepunkt CAM-215 finnes ikke i utstyrslisten | cables.csv:13 |
| ADVARSEL | MISSING_LENGTH | W-210-013: lengde er ikke registrert | cables.csv:8 |

## Utstyr per rom og kabinett

### RM-100 Kontrollrom

| Tag | Beskrivelse | Type | System | Kabinett | U | Tilkoblede porter |
|---|---|---|---|---|---|---|
| OWS-101 | Operatørstasjon 1 | Operatørstasjon | OPS | – | – | 1/1 |
| OWS-102 | Operatørstasjon 2 | Operatørstasjon | OPS | – | – | 1/1 |
| TO-101 | Uttakspanel kontrollpult | Kobberpatchpanel | NETT | – | – | 4/8 |

### RM-110 Hovedteknisk rom (MER)

| Tag | Beskrivelse | Type | System | Kabinett | U | Tilkoblede porter |
|---|---|---|---|---|---|---|
| FPP-110-01 | Fiberpatchpanel MER | Fiberpatchpanel | NETT | CAB-110-A | 42 | 4/24 |
| CPP-110-01 | Kobberpatchpanel MER | Kobberpatchpanel | NETT | CAB-110-A | 41 | 4/48 |
| SW-110-01 | Kjernesvitsj | Svitsj | NETT | CAB-110-A | 40 | 5/28 |
| SRV-110-01 | VMS-server | Server | CCTV | CAB-110-A | 30 | 1/2 |

### RM-210 Teknisk rom Nord

| Tag | Beskrivelse | Type | System | Kabinett | U | Tilkoblede porter |
|---|---|---|---|---|---|---|
| CAM-211 | Kamera perrong N1 | Kamera | CCTV | – | – | 1/1 |
| CAM-212 | Kamera perrong N2 | Kamera | CCTV | – | – | 1/1 |
| CAM-213 | Kamera trapp Nord | Kamera | CCTV | – | – | 1/1 |
| CAM-214 | Kamera inngang Nord | Kamera | CCTV | – | – | 1/1 |
| FPP-210-01 | Fiberpatchpanel Nord | Fiberpatchpanel | NETT | CAB-210-A | 22 | 2/12 |
| CPP-210-01 | Kobberpatchpanel Nord | Kobberpatchpanel | NETT | CAB-210-A | 21 | 8/24 |
| SW-210-01 | Aksessvitsj Nord | Svitsj | NETT | CAB-210-A | 20 | 5/28 |

### RM-310 Teknisk rom Sør

| Tag | Beskrivelse | Type | System | Kabinett | U | Tilkoblede porter |
|---|---|---|---|---|---|---|
| CAM-311 | Kamera perrong S1 | Kamera | CCTV | – | – | 1/1 |
| CAM-312 | Kamera perrong S2 | Kamera | CCTV | – | – | 1/1 |
| FPP-310-01 | Fiberpatchpanel Sør | Fiberpatchpanel | NETT | CAB-310-A | 22 | 2/12 |
| CPP-310-01 | Kobberpatchpanel Sør | Kobberpatchpanel | NETT | CAB-310-A | 21 | 6/24 |
| SW-310-01 | Aksessvitsj Sør | Svitsj | NETT | CAB-310-A | 20 | 4/28 |

### Utstyr uten gyldig rom

- **CAM-313** Kamera heis Sør – rom: «MANGLER»

## Kabel- og patcheliste

| Tag | Kategori | Fra | Til | Type | Lengde | Status |
|---|---|---|---|---|---|---|
| PC-100-001 | Patch | OWS-101:NIC1 | TO-101:F01 | Cat6A patch | 3 m | OK |
| PC-100-002 | Patch | OWS-102:NIC1 | TO-101:F02 | Cat6A patch | 3 m | OK |
| PC-110-001 | Patch | CPP-110-01:F01 | SW-110-01:5 | Cat6A patch | 1 m | OK |
| PC-110-002 | Patch | CPP-110-01:F02 | SW-110-01:6 | Cat6A patch | 1 m | OK |
| PC-110-003 | Patch | SRV-110-01:NIC1 | SW-110-01:11 | Cat6A patch | 2 m | OK |
| PC-110-004 | Patch | FPP-110-01:F01 | SW-110-01:25 | LC-LC OS2 patch | 2 m | OK |
| PC-110-005 | Patch | FPP-110-01:F02 | SW-110-01:26 | LC-LC OS2 patch | 2 m | OK |
| PC-210-001 | Patch | CPP-210-01:F01 | SW-210-01:1 | Cat6A patch | 0.5 m | OK |
| PC-210-002 | Patch | CPP-210-01:F02 | SW-210-01:2 | Cat6A patch | 0.5 m | OK |
| PC-210-003 | Patch | CPP-210-01:F03 | SW-210-01:3 | Cat6A patch | 0.5 m | Port SW-210-01:3 er også brukt av PC-210-006 |
| PC-210-004 | Patch | CPP-210-01:F04 | SW-210-01:4 | Cat6A patch | 0.5 m | OK |
| PC-210-005 | Patch | SW-210-01:25 | FPP-210-01:F01 | LC-LC OS2 patch | 1 m | OK |
| PC-210-006 | Patch | CPP-210-01:F05 | SW-210-01:3 | Cat6A patch | 0.5 m | Port SW-210-01:3 er allerede brukt av PC-210-003 |
| PC-310-001 | Patch | CPP-310-01:F01 | SW-310-01:1 | Cat6A patch | 0.5 m | OK |
| PC-310-002 | Patch | CPP-310-01:F02 | SW-310-01:2 | Cat6A patch | 0.5 m | OK |
| PC-310-003 | Patch | CPP-310-01:F03 | SW-310-01:3 | Cat6A patch | 0.5 m | OK |
| PC-310-004 | Patch | SW-310-01:25 | FPP-310-01:F01 | LC-LC OS2 patch | 1 m | OK |
| W-100-001 | Kabel | TO-101:R01 | CPP-110-01:R01 | Cat6A U/FTP | 38 m | OK |
| W-100-002 | Kabel | TO-101:R02 | CPP-110-01:R02 | Cat6A U/FTP | 36 m | OK |
| W-110-210 | Kabel | FPP-110-01:R01 | FPP-210-01:R01 | OS2 SM duplex | 220 m | OK |
| W-110-310 | Kabel | FPP-110-01:R02 | FPP-310-01:R01 | OS2 SM duplex | 185 m | OK |
| W-210-011 | Kabel | CAM-211:ETH0 | CPP-210-01:R01 | Cat6A U/FTP | 42 m | OK |
| W-210-012 | Kabel | CAM-212:ETH0 | CPP-210-01:R02 | Cat6A U/FTP | 55 m | OK |
| W-210-013 | Kabel | CAM-213:ETH0 | CPP-210-01:R03 | Cat6A U/FTP | **mangler** | Lengde mangler |
| W-210-014 | Kabel | CAM-214:ETH0 | CPP-210-01:R04 | Cat6A U/FTP | 61 m | OK |
| W-210-015 | Kabel | CAM-215:ETH0 | CPP-210-01:R05 | Cat6A U/FTP | 48 m | Ukjent endepunkt CAM-215 |
| W-310-011 | Kabel | CAM-311:ETH0 | CPP-310-01:R01 | Cat6A U/FTP | 35 m | OK |
| W-310-012 | Kabel | CAM-312:ETH0 | CPP-310-01:R02 | Cat6A U/FTP | 47 m | OK |
| W-310-013 | Kabel | CAM-313:ETH0 | CPP-310-01:R03 | Cat6A U/FTP | 52 m | OK |

## Registrerte fysiske kanaler (beregnet)

| Kanal | Fra | Til | Via (kabler/patcher) | Status |
|---|---|---|---|---|
| CH-001 | CAM-211:ETH0 | SW-210-01:1 | W-210-011 → PC-210-001 | Komplett |
| CH-002 | CAM-212:ETH0 | SW-210-01:2 | W-210-012 → PC-210-002 | Komplett |
| CH-003 | CAM-213:ETH0 | SW-210-01:3 | W-210-013 → PC-210-003 | Komplett |
| CH-004 | CAM-214:ETH0 | SW-210-01:4 | W-210-014 → PC-210-004 | Komplett |
| CH-005 | CAM-311:ETH0 | SW-310-01:1 | W-310-011 → PC-310-001 | Komplett |
| CH-006 | CAM-312:ETH0 | SW-310-01:2 | W-310-012 → PC-310-002 | Komplett |
| CH-007 | CAM-313:ETH0 | SW-310-01:3 | W-310-013 → PC-310-003 | Komplett |
| CH-008 | OWS-101:NIC1 | SW-110-01:5 | PC-100-001 → W-100-001 → PC-110-001 | Komplett |
| CH-009 | OWS-102:NIC1 | SW-110-01:6 | PC-100-002 → W-100-002 → PC-110-002 | Komplett |
| CH-010 | SRV-110-01:NIC1 | SW-110-01:11 | PC-110-003 | Komplett |
| CH-011 | SW-210-01:25 | SW-110-01:25 | PC-210-005 → W-110-210 → PC-110-004 | Komplett |
| CH-012 | SW-310-01:25 | SW-110-01:26 | PC-310-004 → W-110-310 → PC-110-005 | Komplett |

## Logiske forbindelser (registrert) og fysisk kjede

_En funnet fysisk kjede betyr bare at kabling er registrert hele veien. Konfigurasjon (VLAN, ruting, tjenester) er ikke dokumentert i datasettet._

| ID | Fra | Til | Tjeneste | Registrert fysisk kjede |
|---|---|---|---|---|
| L-001 | CAM-211 | SRV-110-01 | Videostrøm | CAM-211:ETH0 – CPP-210-01:R01 – CPP-210-01:F01 – SW-210-01:1 – SW-210-01:25 – FPP-210-01:F01 – FPP-210-01:R01 – FPP-110-01:R01 – FPP-110-01:F01 – SW-110-01:25 – SW-110-01:11 – SRV-110-01:NIC1 |
| L-002 | CAM-311 | SRV-110-01 | Videostrøm | CAM-311:ETH0 – CPP-310-01:R01 – CPP-310-01:F01 – SW-310-01:1 – SW-310-01:25 – FPP-310-01:F01 – FPP-310-01:R01 – FPP-110-01:R02 – FPP-110-01:F02 – SW-110-01:26 – SW-110-01:11 – SRV-110-01:NIC1 |
| L-003 | OWS-101 | SRV-110-01 | VMS-klient | OWS-101:NIC1 – TO-101:F01 – TO-101:R01 – CPP-110-01:R01 – CPP-110-01:F01 – SW-110-01:5 – SW-110-01:11 – SRV-110-01:NIC1 |
| L-004 | OWS-102 | SRV-110-01 | VMS-klient | OWS-102:NIC1 – TO-101:F02 – TO-101:R02 – CPP-110-01:R02 – CPP-110-01:F02 – SW-110-01:6 – SW-110-01:11 – SRV-110-01:NIC1 |
