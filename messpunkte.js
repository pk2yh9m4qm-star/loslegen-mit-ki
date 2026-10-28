/*
 * Messpunkte für loslegen-mit-ki.de (Jim, 27.10.2026, Masterplan Phase 1, Auftrag Michael)
 *
 * Die Knöpfe der Seite entstehen aus Version 25 und tragen keine data-messung-Attribute. Statt die Seiten umzubauen,
 * erkennt dieses Skript die vorhandenen Knöpfe und meldet sie an messung.js (window.Messung.senden). Es liest und
 * speichert nichts im Browser und schickt selbst nichts: Ohne messung.js passiert gar nichts.
 *
 *   start_klick        Link zu ChatGPT, Claude oder Gemini (Start-Knopf), Anbieter aus der Linkadresse
 *   prompt_kopiert     „Auftrag als Text kopieren“ ([data-kopieren])
 *   gemerkt            Herz, nur beim Merken (aria-pressed vorher nicht „true“), nicht beim Entfernen
 *   anmeldung_begonnen Anmelde-Formular abgeschickt (einstieg mail) oder „Weiter mit Google“ (einstieg google)
 *   frage_geschickt    „Deine Frage fehlt?“ in Mein Bereich abgeschickt (nur mit Text)
 *
 * Use Case, immer als Adresse ohne Schrägstrich (z. B. „brief-verstehen“), sonst die Kennung der Karte:
 * 1. Karte (.mcard): Adresse aus ihrem Link, sonst data-fall, data-case oder data-herz, über FAELLE übersetzt
 *    (Fallkennung wie „R45“ oder Seitenname wie „anschaffung“). Ideen ohne Seite behalten ihre Kennung.
 * 2. Sonst die Use-Case-Seite selbst (data-fall am body).
 */
(function () {
  'use strict';
  var FAELLE = {"abo": "kontoauszug-abos", "anleitung": "brief-verstehen", "anschaffung": "grosse-anschaffung-planen", "betrug": "betrug-oder-echt", "f-brief": "brief-verstehen", "f-foerderung": "zuschuesse-finden", "f-keller": "keller-ausmisten", "f-wohnzimmer": "wohnzimmer-neu-denken", "foerderung": "zuschuesse-finden", "gehalt": "gehaltsgespraech-vorbereiten", "i10": "vorsorgemappe-anlegen", "keller": "keller-ausmisten", "kuendigung": "gekuendigt-und-jetzt", "miete": "zahlst-du-zu-viel-miete", "n01": "betrug-oder-echt", "n02": "geld-nach-betrug-zurueckholen", "n05": "gekuendigt-und-jetzt", "n10": "ungewollter-vertrag", "r07": "zahlst-du-zu-viel-miete", "r17": "gehaltsgespraech-vorbereiten", "r30": "kontoauszug-abos", "r45": "grosse-anschaffung-planen", "r50": "therapieplatz-finden", "rueckholen": "geld-nach-betrug-zurueckholen", "therapie": "therapieplatz-finden", "vertrag": "ungewollter-vertrag", "vorsorge": "vorsorgemappe-anlegen", "wochenende": "wochenende-planen", "wohnzimmer": "wohnzimmer-neu-denken", "y4": "wochenende-planen"};   // Fallkennung oder Seitenname (klein) → Adresse; beim Bauen eingesetzt
  var ADRESSEN = [];
  for (var k in FAELLE) if (ADRESSEN.indexOf(FAELLE[k]) === -1) ADRESSEN.push(FAELLE[k]);
  var KI = [[/(^|\.)chatgpt\.com$/, 'chatgpt'], [/(^|\.)claude\.ai$/, 'claude'], [/(^|\.)gemini\.google\.com$/, 'gemini']];

  function senden(ereignis, angaben) {
    try { if (window.Messung) window.Messung.senden(ereignis, angaben || {}); } catch (f) { /* Messung ist Nebensache */ }
  }

  function uebersetzen(k) { return FAELLE[String(k || '').toLowerCase()] || k || ''; }

  function fallVon(el) {
    var karte = el.closest('.mcard');
    if (karte) {
      var links = karte.querySelectorAll('a[href^="/"]');
      for (var i = 0; i < links.length; i++) {
        var adresse = links[i].getAttribute('href').split(/[?#]/)[0].replace(/^\/|\.html$/g, '');
        if (ADRESSEN.indexOf(adresse) !== -1) return adresse;
      }
      var herz = karte.querySelector('[data-herz]');
      return uebersetzen(karte.getAttribute('data-fall') || karte.getAttribute('data-case') || (herz && herz.getAttribute('data-herz')));
    }
    var seite = document.body && document.body.getAttribute('data-fall');
    if (seite) return seite;
    var t = el.closest('[data-fall], [data-herz]');
    return t ? uebersetzen(t.getAttribute('data-fall') || t.getAttribute('data-herz')) : '';
  }

  function anbieter(href) {
    var u;
    try { u = new URL(href, location.href); } catch (f) { return ''; }
    if (u.protocol === 'claude:') return 'claude';
    if (u.protocol !== 'https:') return '';
    for (var i = 0; i < KI.length; i++) if (KI[i][0].test(u.hostname)) return KI[i][1];
    return '';
  }

  document.addEventListener('click', function (e) {
    var el = e.target && e.target.nodeType === 1 ? e.target : e.target && e.target.parentElement;
    if (!el || !el.closest) return;
    var a = el.closest('a[href]');
    var ki = a ? anbieter(a.href) : '';
    if (ki) { senden('start_klick', { fall: fallVon(a), anbieter: ki }); return; }
    var kopie = el.closest('[data-kopieren]');
    if (kopie) { senden('prompt_kopiert', { fall: fallVon(kopie) }); return; }
    var herz = el.closest('[data-herz], .herz, .ra-herz, .mb-leser__merken');
    if (herz) { if (herz.getAttribute('aria-pressed') !== 'true') senden('gemerkt', { fall: fallVon(herz) }); return; }
    if (el.closest('[data-v25r7-google]')) senden('anmeldung_begonnen', { einstieg: 'google' });
  }, true);

  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (!f || !f.matches) return;
    if (f.matches('[data-v25r7-form]')) senden('anmeldung_begonnen', { einstieg: 'mail' });
    else if (f.matches('[data-mb-frage]')) {
      var feld = f.querySelector('input, textarea');
      if (feld && feld.value.trim()) senden('frage_geschickt');
    }
  }, true);
})();
