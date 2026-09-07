# Solar Controller Homey v1.1.0 — testplan ManagerDiscovery

Deze testversie is bedoeld voor Solar Controller firmware **step309 of nieuwer**. Automatische mDNS-SD discovery via Homey ManagerDiscovery is de primaire pairingmethode; handmatig IP/hostnaam blijft alleen als fallback beschikbaar.

## 1. Voorcontrole op de pc

```bash
npm test
homey app validate --level publish
```

Beide controles moeten groen zijn voordat de app opnieuw wordt ingediend.

## 2. Upgrade bestaand Homey-apparaat

- Laat je huidige gekoppelde Solar Controller staan.
- Start v1.1.0 via `homey app run` over de bestaande installatie.
- De bestaande device-ID, naam, instellingen en Flows moeten behouden blijven.
- In de CLI-log moet na de eerste succesvolle mDNS-match een regel verschijnen zoals `Discovery linked to SC-XXXXXXXXXXXX`.
- De bestaande Host-instelling mag alleen automatisch veranderen wanneer Homey hetzelfde serienummer op een nieuw adres terugvindt.

## 3. Automatische pairing

- Kies **Apparaat toevoegen → Solar Controller**.
- Het eerste scherm moet automatisch zoeken; er mag niet eerst om een IP-adres worden gevraagd.
- Een draaiende step309-controller moet zichtbaar worden met naam, `SC-...` serienummer, IP-adres en firmwareversie.
- Een al gekoppelde controller moet als **Al toegevoegd** verschijnen en niet opnieuw toegevoegd kunnen worden.
- Met meerdere ESP's moet iedere controller afzonderlijk verschijnen.

## 4. Nieuwe controller automatisch toevoegen

Test indien een nog niet gekoppelde step309-controller beschikbaar is:
- selecteer de gevonden controller;
- Homey valideert eerst `/api/status_light`;
- het apparaat wordt daarna toegevoegd;
- de Homey device-ID is de genormaliseerde discovery-ID van het bestaande `SC-...` serienummer;
- Host wordt automatisch op het gevonden adres gezet.

## 5. DHCP/adreswijziging

- Laat een reeds automatisch gekoppelde controller een ander DHCP-adres krijgen.
- Homey moet via hetzelfde serienummer dezelfde controller herkennen.
- `host` moet automatisch naar het nieuwe adres veranderen.
- Het bestaande Homey-apparaat en alle Flows blijven behouden.
- Polling moet zonder herpair terugkomen.

## 6. Handmatige fallback

- Klik **Controller niet gevonden? Handmatig toevoegen**.
- De bestaande IP/hostnaam-pairing moet nog werken.
- Test leeg adres, fout adres en bestaand adres.
- Deze route is alleen bedoeld voor netwerken waar mDNS/multicast wordt geblokkeerd.

## 7. REST/API-regressie

Controleer na discovery minimaal:
- actueel vermogen;
- temperatuur 1 t/m 4;
- PWM;
- Force Heat;
- relais;
- zonregeling;
- PWM-limiet;
- Legionella;
- prijzen/verwarmadvies;
- Multi Controller-status.

Discovery bepaalt alleen waar de ESP staat; alle gegevens en bediening blijven via de bestaande REST API lopen.

## 8. Home Assistant / MQTT

Controleer op step309 dat bestaande Home Assistant- en MQTT-integraties normaal blijven functioneren. De Homey ManagerDiscovery-wijziging mag hier niets aan veranderen.

## 9. Flows

Test minimaal:
- Vermogen boven X;
- Temperatuur boven X;
- Force Heat aan/uit;
- één condition;
- één action.

Controleer speciaal `Verwarmadvies is → Onbekend` in de Nederlandse interface.

## 10. Netwerkstoringen

Test:
- ESP reboot;
- Wi-Fi tijdelijk weg;
- router/AP reboot;
- Homey-app restart;
- Homey restart.

Dezelfde `SC-...` controller moet steeds als hetzelfde apparaat terugkomen.

## 11. Presentatie

Controleer:
- transparant line-art app-icoon op klein formaat;
- discovery-pairing volledig Nederlands en Engels;
- handmatige route duidelijk als fallback;
- Store-assets en driverbeeld ongewijzigd.

## 12. Certificeringscontrole

Voor opnieuw indienen:

```bash
homey app validate --level publish
```

Daarna als Test publiceren, automatische pairing op mobiel en desktop controleren, en pas daarna opnieuw submitten voor certificering.
