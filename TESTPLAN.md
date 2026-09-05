# Solar Controller Homey v1.0.1 — eindcontroleplan

Deze versie is de eerste publieke App Store-release op basis van de bevestigde werkende v1.0.1 release-candidate en de eerder publish-gevalideerde technische baseline. Automatische LAN-discovery/mDNS is **bewust niet geïmplementeerd**. Handmatige invoer van IP-adres/hostnaam blijft in deze versie de methode om een controller toe te voegen.

## 1. Voorcontrole op de pc

Voer in de app-map uit:

```bash
npm test
homey app validate --level publish
```

`npm test` moet volledig groen zijn. De Homey publish-validator moet daarna zonder errors slagen; beoordeel ook iedere warning.

## 2. Upgrade van bestaande v0.7.73

- Start/installeer v1.0.1 via Homey CLI over de bestaande installatie.
- Bestaande Solar Controllers mogen **niet opnieuw gekoppeld** hoeven worden.
- Controleer dat naam, Host, bestaande Flows en apparaatidentiteit behouden zijn.
- Controleer dat eventueel nieuw toegevoegde capabilities vanzelf verschijnen.

## 3. Schone pairing met handmatig adres

- Kies Solar Controller bij Apparaat toevoegen.
- Vul een herkenbare apparaatnaam en het IP-adres of de hostnaam van de ESP32 in.
- De app moet de controller eerst testen en daarna pas toevoegen.
- Test ook een leeg adres, fout adres en een al gekoppeld adres; Homey moet een duidelijke melding geven en geen defect apparaat aanmaken.
- Na koppelen blijft het controlleradres via apparaatinstellingen wijzigbaar.

## 4. Waarden / capabilities

Controleer minimaal:
- actueel vermogen
- hoofdtemperatuur
- temperatuur 2, 3 en 4
- PWM
- Force Heat
- handmatig relais
- zonregeling
- PWM-limiet
- Legionella-cyclus + status
- stroomprijs, gasprijs en verwarmadvies
- Multi Controller-rol, fallback, groeps-PWM, peers, realtime TCP en temperatuurvrijgave

Controleer specifiek ook geldige nulwaarden (0 W, 0% PWM, 0-prijs/waarde waar van toepassing): deze moeten correct in Homey kunnen verschijnen en mogen niet als 'geen waarde' worden behandeld.

## 5. Bediening vanuit Homey

Test:
- Force Heat aan / uit
- relais aan / uit
- zonregeling wijzigen
- PWM-limiet instellen
- Legionella starten / stoppen
- PWM instellen, inclusief de firmware-fallback wanneer `/api/pwm` niet beschikbaar is

Controleer na iedere actie in de ESP-webinterface en daarna opnieuw in Homey dat de toestand gelijkloopt.

## 6. Flow-triggers

Test specifiek:
- **Vermogen boven X**: alleen bij een echte opwaartse kruising van de ingestelde drempel.
- **Temperatuur boven X**: alleen bij een echte opwaartse kruising van de ingestelde drempel.
- PWM gewijzigd.
- Force Heat ingeschakeld / uitgeschakeld.
- relais ingeschakeld / uitgeschakeld.
- Legionella gestart / gestopt.
- stroomprijs / gasprijs / verwarmadvies gewijzigd.
- regelmodus / zonregeling gewijzigd.
- temperatuur 2 / 3 / 4 gewijzigd.
- Multi Controller-rol / fallback / temperatuurvrijgave gewijzigd.

Voor de twee drempeltriggers ook testen: onder→boven = één trigger, boven→hoger = geen nieuwe trigger, boven→onder = geen trigger, daarna onder→boven = opnieuw één trigger.

## 7. Flow-conditions en actions

- Maak voor iedere condition minimaal één Flow die zowel `true` als `false` kan opleveren.
- Voer iedere action minimaal eenmaal uit.
- Controleer dat een actie alleen de geselecteerde Solar Controller beïnvloedt.

## 8. Multi-ESP

Test met 1, 2 en indien beschikbaar 3 Solar Controllers:
- ieder Homey-apparaat gebruikt zijn eigen Host
- waarden worden niet tussen apparaten verwisseld
- acties gaan uitsluitend naar de geselecteerde ESP
- device-Flows van ESP 1 mogen niet door ESP 2/3 worden geactiveerd
- zet één ESP uit: de andere Homey-apparaten moeten normaal blijven werken
- wijzig het IP-adres van één reeds gekoppelde ESP via de apparaatinstellingen: de Homey-device-ID en bestaande Flows moeten behouden blijven

## 9. Herstel / netwerkstoringen

Test:
- ESP herstart
- Wi-Fi van één ESP tijdelijk onderbreken
- router/AP herstart met hetzelfde gereserveerde IP
- Homey-app herstart
- Homey herstart
- tijdelijk fout Host instellen en daarna herstellen

Verwachting: de betrokken controller mag tijdelijk `unavailable` worden, maar de app mag niet crashen. Na herstel moet polling automatisch terugkomen zonder herpair. Andere gekoppelde ESP's moeten ondertussen normaal blijven werken.

## 10. Instellingen en belasting

Controleer de profielen Aanbevolen, Standaard en Lagere belasting. Schakel daarna geavanceerde instellingen in en test:
- verversingsintervallen
- adaptief verversen
- heat-compare/prijzen-advies
- update-drempels
- Flow-triggervertraging/minimuminterval
- HTTP-timeout
- maximaal gelijktijdige API-aanvragen
- extra temperatuursensoren
- uitgebreide logging
- geavanceerd PWM API-endpoint

## 11. Nederlands / Engels / presentatie

Controleer Homey in beide talen:
- geen mojibake (`Ã`, `Â`)
- pairing volledig vertaald
- Flow-kaarten volledig vertaald
- apparaatinstellingen volledig vertaald
- capabilitynamen logisch en consistent
- app- en driverafbeeldingen correct weergegeven
- app- en drivericoon duidelijk verschillend
- Store-README is kort en zonder URL/Markdown

## 12. Store-/publishcontrole

Controleer in de Homey Developer omgeving:
- appnaam, tagline, categorie Energy en tags
- appafbeeldingen (250×175, 500×350, 1000×700)
- driverafbeeldingen (75×75, 500×500, 1000×1000)
- homepage/support/source-links
- compatibiliteit vanaf Homey 7.4.0
- platform local

## 13. Bewust nog open na v1.0.1

Automatische discovery/mDNS. Dit wordt pas als aparte fase onderzocht nadat bovenstaande release-candidate functioneel is goedgekeurd. Tot die tijd is een DHCP-reservering/vast IP per Solar Controller aanbevolen.
