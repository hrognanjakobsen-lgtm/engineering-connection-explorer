# Endringer: Revisjon B sammenlignet med basis

Sammendrag: **3 lagt til**, **3 fjernet**, **2 endret**.

| Endring | Objekttype | ID | Detaljer |
|---|---|---|---|
| Endret | Utstyr | CAM-214 | Rom: RM-210 → RM-310 |
| Endret | Kabel/patch | PC-110-002 | Til: SW-110-01:6 → SW-110-01:7 |
| Fjernet | Kabel/patch | PC-210-004 | PC-210-004 CPP-210-01:F04 → SW-210-01:4 |
| Lagt til | Kabel/patch | PC-310-005 | PC-310-005 CPP-310-01:F04 → SW-310-01:4 |
| Fjernet | Kabel/patch | W-210-014 | W-210-014 CAM-214:ETH0 → CPP-210-01:R04 |
| Lagt til | Kabel/patch | W-310-014 | W-310-014 CAM-214:ETH0 → CPP-310-01:R04 |
| Fjernet | Intern forbindelse | CPP-210-01:F04↔R04 | CPP-210-01 F04↔R04 |
| Lagt til | Intern forbindelse | CPP-310-01:F04↔R04 | CPP-310-01 F04↔R04 |

## Påvirkede fysiske kanaler

- **Bortfalt:** CAM-214:ETH0 → SW-210-01:4 via W-210-014, PC-210-004
- **Bortfalt:** OWS-102:NIC1 → SW-110-01:6 via PC-100-002, W-100-002, PC-110-002
- **Ny:** CAM-214:ETH0 → SW-310-01:4 via W-310-014, PC-310-005
- **Ny:** OWS-102:NIC1 → SW-110-01:7 via PC-100-002, W-100-002, PC-110-002
