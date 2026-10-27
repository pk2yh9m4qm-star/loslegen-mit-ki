/*
 * Messung ohne Cookies – Stand 14.10.2026
 *
 * Einbinden (am Ende von <body>, auf jeder Seite):
 *   <script src="/technik/messung.js" data-endpunkt="https://script.google.com/macros/s/…/exec" defer></script>
 * Fall der Seite:      <body data-fall="behoerdenbrief">
 * Klick messen:        <a href="…" data-messung="start_klick" data-fall="behoerdenbrief" data-anbieter="chatgpt">
 *                      <a href="…" data-messung="einstieg_gewaehlt" data-einstieg="begleiteter-monat">
 * Aus eigenem Code:    window.Messung && window.Messung.senden('anmeldung_begonnen', { einstieg: 'begleiteter-monat' })
 * Angaben werden vom geklickten Element oder vom nächsten Vorfahren mit dem Attribut gelesen.
 *
 * Datenschutz: keine Cookies, kein sessionStorage, keine Kennung je Besucher, kein User-Agent.
 * localStorage nur für den Ausschalter (27.10.2026, Yannis: „Ja, Jim soll den Ausschalter über einen einmaligen Link
 * einbauen.“): ?messung=aus legt AUS_SCHLUESSEL mit Wert „1“ an, ?messung=an entfernt ihn; solange er da ist, wird
 * nichts gesendet. Kurze Bestätigung, danach verschwindet der Zusatz aus der Adresse. Rückmeldungen sind davon unberührt. Gesendet werden nur Ereignis, Seitenpfad (ohne Adresszusatz), Fall, Einstieg,
 * Anbieter, UTM-Werte, Domain der vorherigen Seite und die Geräteklasse handy/computer.
 * Bei Global Privacy Control (navigator.globalPrivacyControl) wird nichts gesendet.
 *
 * Versand: fetch mit keepalive und credentials 'omit', damit der Browser keine Google-Cookies
 * mitschickt; sendBeacon nur als Ausweg, weil sendBeacon laut W3C-Spezifikation immer mit
 * Cookies sendet (credentials mode „include“). data-versand="beacon" dreht die Reihenfolge um.
 * data-ohne-geraet am Script-Tag lässt die Geräteklasse weg (auf loslegen-mit-ki.de seit 27.10.2026 nicht mehr gesetzt).
 * Testmodus (nichts wird gesendet, Ereignisse landen in window.__messungTest und als
 * DOM-Ereignis „messung-test“): ohne data-endpunkt, bei file://, localhost oder ?messung=test.
 */
(function (wurzel, fabrik) {
  var api = fabrik();
  if (typeof module === 'object' && module && module.exports) {
    module.exports = api;
  } else if (wurzel && wurzel.document) {
    api.starten(wurzel, wurzel.document.currentScript);
  }
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  // 27.10.2026 (Jim, Masterplan Phase 1): prompt_kopiert, gemerkt, frage_geschickt dazu
  var EREIGNISSE = ['seitenaufruf', 'start_klick', 'einstieg_gewaehlt', 'abfrage_beantwortet', 'anmeldung_begonnen',
    'prompt_kopiert', 'gemerkt', 'frage_geschickt'];
  var UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'];
  // Was je Ereignis da sein sollte; fehlt etwas, warnt nur der Testmodus
  var ERWARTET = { start_klick: ['fall', 'anbieter'], einstieg_gewaehlt: ['einstieg'], abfrage_beantwortet: ['abfrage'],
    prompt_kopiert: ['fall'], gemerkt: ['fall'] };
  var UMLAUTE = { 'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'ß': 'ss' };
  var HOST = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

  function grundform(wert) {
    return String(wert == null ? '' : wert).trim().toLowerCase()
      .replace(/[äöüß]/g, function (z) { return UMLAUTE[z]; })
      .normalize('NFKD').replace(/[̀-ͯ]/g, '');
  }

  /** Kennung: a–z, 0–9, Bindestrich, höchstens 60 Zeichen, sonst ''. */
  function kennungBereinigen(wert) {
    return grundform(wert).replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-').slice(0, 60).replace(/^-+|-+$/g, '');
  }

  /** UTM-Wert: a–z, 0–9, . _ ~ -, höchstens 80 Zeichen, sonst ''. */
  function utmBereinigen(wert) {
    return grundform(wert).replace(/\s+/g, '-').replace(/[^a-z0-9._~-]/g, '').slice(0, 80);
  }

  /** Liest utm_source, utm_medium, utm_campaign, utm_content aus location.search. */
  function utmAusSuche(suche) {
    var werte = {};
    UTM.forEach(function (k) { werte[k] = ''; });
    String(suche || '').replace(/^\?/, '').split('&').forEach(function (teil) {
      var i = teil.indexOf('=');
      var name = i === -1 ? teil : teil.slice(0, i);
      if (UTM.indexOf(name) === -1 || werte[name]) return;
      var roh = i === -1 ? '' : teil.slice(i + 1).replace(/\+/g, ' ');
      try { roh = decodeURIComponent(roh); } catch (f) { roh = ''; }
      werte[name] = utmBereinigen(roh);
    });
    return werte;
  }

  /** Nur die Domain der vorherigen Seite, nie die ganze Adresse. */
  function herkunftsHost(referrer) {
    var m = /^https?:\/\/(?:[^\/?#@]*@)?([^\/?#:]+)/i.exec(String(referrer || ''));
    if (!m) return '';
    var host = m[1].toLowerCase().replace(/\.$/, '');
    return HOST.test(host) ? host : '';
  }

  /** Seitenpfad ohne Adresszusatz; unbekannte Zeichen fallen weg. */
  function pfadBereinigen(pfad) {
    var p = String(pfad || '/').replace(/[^A-Za-z0-9\/._~%-]/g, '');
    if (p.charAt(0) !== '/') p = '/' + p;
    return p.slice(0, 200);
  }

  /** Grob: Touch ohne Maus = handy (auch Tablets), sonst computer. */
  function geraeteklasse(matchMedia) {
    if (typeof matchMedia !== 'function') return '';
    try {
      return matchMedia('(hover: none) and (pointer: coarse)').matches ? 'handy' : 'computer';
    } catch (f) {
      return '';
    }
  }

  function gpcAktiv(nav) {
    return !!(nav && nav.globalPrivacyControl === true);
  }

  /** Fehlende erwartete Angaben, nur für Warnungen im Testmodus. */
  function fehlendeAngaben(nutzlast) {
    return (ERWARTET[nutzlast.ereignis] || []).filter(function (k) { return !nutzlast[k]; });
  }

  /** Baut die Nutzlast; null bei unbekanntem Ereignis. Leere Felder fallen weg. */
  function nutzlastBauen(ereignis, angaben, kontext) {
    if (EREIGNISSE.indexOf(ereignis) === -1) return null;
    angaben = angaben || {};
    kontext = kontext || {};
    var n = { art: 'ereignis', ereignis: ereignis, pfad: pfadBereinigen(kontext.pfad) };
    ['fall', 'einstieg', 'anbieter', 'abfrage'].forEach(function (k) {
      var wert = kennungBereinigen(angaben[k] != null ? angaben[k] : (k === 'fall' ? kontext.fall : ''));
      if (wert) n[k] = wert;
    });
    UTM.concat(['herkunft', 'geraet']).forEach(function (k) {
      if (kontext[k]) n[k] = kontext[k];
    });
    return n;
  }

  /** Liest Ereignis und Angaben aus dem Element und seinen Vorfahren. */
  function klickAngaben(element) {
    if (!element || typeof element.closest !== 'function') return null;
    var ziel = element.closest('[data-messung]');
    if (!ziel) return null;
    var angaben = { ereignis: ziel.getAttribute('data-messung') };
    ['fall', 'einstieg', 'anbieter', 'abfrage'].forEach(function (k) {
      var traeger = ziel.closest('[data-' + k + ']');
      if (traeger) angaben[k] = traeger.getAttribute('data-' + k);
    });
    return angaben;
  }

  /** Kontext der Seite, ohne Speicher im Browser. */
  function kontextLesen(fenster) {
    var doc = fenster.document;
    var koerper = doc && doc.body;
    var k = utmAusSuche(fenster.location && fenster.location.search);
    k.pfad = pfadBereinigen(fenster.location && fenster.location.pathname);
    k.fall = koerper && koerper.getAttribute ? (koerper.getAttribute('data-fall') || '') : '';
    k.herkunft = herkunftsHost(doc && doc.referrer);
    k.geraet = geraeteklasse(fenster.matchMedia && fenster.matchMedia.bind(fenster));
    return k;
  }

  var AUS_SCHLUESSEL = 'kiosk-zaehlung-aus';

  /** Ausschalter: liest ?messung=aus|an, merkt es sich im localStorage (ohne Kennung) und meldet, ob gezählt wird. */
  function ausschalter(fenster) {
    var ort = fenster.location || {}, wunsch = (/[?&]messung=(aus|an)(?:&|$)/.exec(ort.search || '') || [])[1];
    var speicher = null;
    try { speicher = fenster.localStorage; } catch (f) { /* privates Fenster, gesperrte Websitedaten */ }
    var abgeschaltet = false;
    try {
      if (wunsch === 'aus' && speicher) speicher.setItem(AUS_SCHLUESSEL, '1');
      if (wunsch === 'an' && speicher) speicher.removeItem(AUS_SCHLUESSEL);
      // ohne Speicher gilt „aus“ wenigstens für diese Seite
      abgeschaltet = speicher ? !!speicher.getItem(AUS_SCHLUESSEL) : wunsch === 'aus';
    } catch (f) {
      abgeschaltet = wunsch === 'aus';
    }
    if (wunsch) {
      bestaetigen(fenster, abgeschaltet ? 'Zählung auf diesem Gerät aus' : 'Zählung auf diesem Gerät an');
      try {
        var rest = (ort.search || '').replace(/^\?/, '').split('&').filter(function (t) { return t && !/^messung=(aus|an)$/.test(t); });
        fenster.history.replaceState(fenster.history.state, '', (ort.pathname || '') + (rest.length ? '?' + rest.join('&') : '') + (ort.hash || ''));
      } catch (f) { /* Adresse bleibt dann, schadet nicht */ }
    }
    return abgeschaltet;
  }

  /** Kurze, unaufdringliche Bestätigung oben in der Mitte (unten liegt am Handy der Start-Knopf), unter dem Seitenkopf mit seinen
   * Knöpfen (Pam, 27.10.2026: „den Kopf mit Knöpfen nicht“), sonst unter der Aufbau-Leiste; verschwindet nach 3,5 Sekunden. */
  function bestaetigen(fenster, text) {
    var doc = fenster.document;
    if (!doc || !doc.createElement || !doc.body) return;
    var el = doc.createElement('div');
    el.setAttribute('role', 'status');
    el.textContent = text;
    var oben = 16, kanten = ['.site-nav', '.live-aufbau'];
    for (var i = 0; i < kanten.length; i++) {
      var k = doc.querySelector && doc.querySelector(kanten[i]);
      var unten = k && k.getBoundingClientRect ? k.getBoundingClientRect().bottom : 0;
      if (unten > 0) { oben = Math.round(unten) + 8; break; }
    }
    el.style.cssText = 'position:fixed;left:50%;top:calc(' + oben + 'px + env(safe-area-inset-top, 0px));transform:translateX(-50%);z-index:2147483647;width:max-content;max-width:calc(100% - 32px);box-sizing:border-box;' +
      'padding:10px 18px;border-radius:999px;background:#2b2420;color:#fff;font:600 15px/1.4 system-ui,sans-serif;' +
      'box-shadow:0 6px 18px rgba(0,0,0,.18);text-align:center';
    doc.body.appendChild(el);
    fenster.setTimeout && fenster.setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 3500);
  }

  function testmodusNoetig(fenster, endpunkt) {
    var ort = fenster.location || {};
    return !endpunkt || !/^https:\/\//.test(endpunkt) || ort.protocol === 'file:' ||
      /^(localhost|127\.0\.0\.1|\[::1\])$/.test(ort.hostname || '') || /[?&]messung=test\b/.test(ort.search || '');
  }

  /** Versendet die Nutzlast; gibt den genutzten Weg zurück. */
  function versenden(endpunkt, nutzlast, umgebung) {
    var text = JSON.stringify(nutzlast);
    var wege = umgebung.versand === 'beacon' ? ['beacon', 'fetch'] : ['fetch', 'beacon'];
    for (var i = 0; i < wege.length; i++) {
      try {
        if (wege[i] === 'fetch' && umgebung.fetch && umgebung.keepalive) {
          // Text als Körper → Content-Type text/plain, also ohne Preflight
          umgebung.fetch(endpunkt, { method: 'POST', body: text, keepalive: true, mode: 'no-cors',
            credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' })
            .catch(function () {});
          return 'fetch';
        }
        if (wege[i] === 'beacon' && umgebung.sendBeacon && umgebung.sendBeacon(endpunkt, text)) return 'beacon';
      } catch (f) {
        // nächsten Weg versuchen
      }
    }
    if (umgebung.fetch) {
      try {
        umgebung.fetch(endpunkt, { method: 'POST', body: text, mode: 'no-cors', credentials: 'omit' }).catch(function () {});
        return 'fetch-ohne-keepalive';
      } catch (f) {
        // nichts mehr möglich
      }
    }
    return 'keiner';
  }

  function starten(fenster, skript) {
    var nav = fenster.navigator || {};
    var doc = fenster.document;
    var endpunkt = skript && skript.getAttribute ? (skript.getAttribute('data-endpunkt') || '') : '';
    var test = testmodusNoetig(fenster, endpunkt);
    var abgeschaltet = ausschalter(fenster);
    var aus = gpcAktiv(nav) || nav.webdriver === true || abgeschaltet;
    // data-ohne-geraet (27.10.2026): Geräteklasse weglassen, solange die Datenschutzerklärung sie nicht nennt
    var ohneGeraet = !!(skript && skript.hasAttribute && skript.hasAttribute('data-ohne-geraet'));
    var umgebung = {
      versand: skript && skript.getAttribute ? skript.getAttribute('data-versand') : '',
      fetch: typeof fenster.fetch === 'function' ? fenster.fetch.bind(fenster) : null,
      keepalive: typeof fenster.Request === 'function' && 'keepalive' in fenster.Request.prototype,
      sendBeacon: typeof nav.sendBeacon === 'function' ? nav.sendBeacon.bind(nav) : null,
    };
    if (test) fenster.__messungTest = fenster.__messungTest || [];

    function senden(ereignis, angaben) {
      if (aus) return false;
      var kontext = kontextLesen(fenster);
      if (ohneGeraet) delete kontext.geraet;
      var nutzlast = nutzlastBauen(ereignis, angaben, kontext);
      if (!nutzlast) {
        if (test && fenster.console) fenster.console.warn('Messung: unbekanntes Ereignis', ereignis);
        return false;
      }
      if (test) {
        var fehlt = fehlendeAngaben(nutzlast);
        if (fehlt.length && fenster.console) fenster.console.warn('Messung: es fehlt ' + fehlt.join(', '), nutzlast);
        fenster.__messungTest.push(nutzlast);
        if (typeof fenster.CustomEvent === 'function' && doc) {
          doc.dispatchEvent(new fenster.CustomEvent('messung-test', { detail: nutzlast }));
        }
        return true;
      }
      return versenden(endpunkt, nutzlast, umgebung) !== 'keiner';
    }

    function beiKlick(ereignis) {
      if (ereignis.type === 'auxclick' && ereignis.button !== 1) return;
      var angaben = klickAngaben(ereignis.target);
      if (angaben) senden(angaben.ereignis, angaben);
    }

    fenster.Messung = { senden: senden, aktiv: !aus, testmodus: test, abgeschaltet: abgeschaltet };
    if (aus || !doc) return fenster.Messung;
    doc.addEventListener('click', beiKlick, true);
    doc.addEventListener('auxclick', beiKlick, true);
    // Vorgeladene Seiten erst zählen, wenn sie wirklich angezeigt werden
    if (doc.prerendering) {
      doc.addEventListener('prerenderingchange', function () { senden('seitenaufruf'); }, { once: true });
    } else {
      senden('seitenaufruf');
    }
    return fenster.Messung;
  }

  return {
    EREIGNISSE: EREIGNISSE,
    kennungBereinigen: kennungBereinigen,
    utmBereinigen: utmBereinigen,
    utmAusSuche: utmAusSuche,
    herkunftsHost: herkunftsHost,
    pfadBereinigen: pfadBereinigen,
    geraeteklasse: geraeteklasse,
    gpcAktiv: gpcAktiv,
    AUS_SCHLUESSEL: AUS_SCHLUESSEL,
    ausschalter: ausschalter,
    fehlendeAngaben: fehlendeAngaben,
    nutzlastBauen: nutzlastBauen,
    klickAngaben: klickAngaben,
    kontextLesen: kontextLesen,
    testmodusNoetig: testmodusNoetig,
    versenden: versenden,
    starten: starten,
  };
});
