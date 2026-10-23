/*
 * What the home screen shows, kept in localStorage so it opens with numbers:
 *  - the picks: what's trending this week and recent releases, only from the streaming apps on this TV (TMDB, with
 *    the person's own free key from config.properties), three per hour;
 *  - the weather, sunrise and sunset (Open-Meteo, every 30 min) and the tide (the Tábua das Marés through the
 *    association's endpoint when there is a key, Open-Meteo Marine when there is not, every 30 min), with the
 *    day's curve, its highs and lows and the window the beach is low enough for a buggy;
 *  - the moon: its phase, the lit part and the hour it rises (computed here, no network).
 * Settings changed on the TV (Prefs) win over config.properties, as on Android. Built without a city (--generic), the
 * TV's time zone gives the city, and its country the currency and the region (zones.js).
 */
var CONFIG = window.CONFIG || {};

var Place = (function () {
  'use strict';

  /** A time zone's main city: {country, lat, lon, name}, or null. */
  function zone(name) {
    var all = window.ZONES || {}, v = all[name], hops = 0;
    while (v && v.charAt(0) === '=' && hops++ < 3) { name = v.slice(1); v = all[name]; }
    if (!v) return null;
    var p = v.split(',');
    return {country: p[0], lat: p[1], lon: p[2], name: p[3] || name.slice(name.lastIndexOf('/') + 1).replace(/_/g, ' ')};
  }

  var tz = zone(TV.zone()), set = CONFIG.latitude !== '' && CONFIG.latitude !== undefined;
  var country = (CONFIG.tmdbRegion || (tz ? tz.country : '') || 'US').toUpperCase();
  return {
    lat: set ? CONFIG.latitude : tz ? tz.lat : '-4.1818',
    lon: set ? CONFIG.longitude : tz ? tz.lon : '-38.0801',
    city: CONFIG.city || (!set && tz ? tz.name : ''),
    country: country,
    /** Fahrenheit for TVs in the US (by their time zone, or their language when it doesn't tell). */
    fahrenheit: tz ? tz.country === 'US' : /-US$/i.test(navigator.language || '')
  };
})();

var Prefs = (function () {
  'use strict';
  var KEY = 'fmtv.prefs';
  var v = {};
  try { v = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) {}
  function save() { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} }
  function pick(name, fallback) { return v[name] === undefined ? fallback : v[name]; }
  return {
    version: 0,
    language: function () { return pick('language', CONFIG.language || 'auto'); },
    temperature: function () { return pick('temperature', CONFIG.temperature || 'auto'); },
    theme: function () { return pick('theme', 'auto'); },
    weather: function () { return pick('weather', true); },
    /** The tide and the moon take the corner where the prices used to be. */
    tide: function () { return pick('tide', CONFIG.tideWidget !== false); },
    /** The level above which the beach is no place for a buggy (metres, in the tide table's own datum). */
    beachLevel: function () {
      var v = pick('beachLevel', null);
      if (v !== null && !isNaN(v)) return +v;
      return CONFIG.tideLevel !== undefined && CONFIG.tideLevel !== '' && !isNaN(CONFIG.tideLevel) ? +CONFIG.tideLevel : 0.3;
    },
    /** How often each app was opened from here, and when: the shelf goes from the most to the least used. */
    usage: function () { return pick('usage', {}); },
    used: function (id) {
      if (!id) return;
      var u = pick('usage', {});
      var e = u[id] || (u[id] = {n: 0, t: 0});
      e.n += 1;
      e.t = Date.now();
      v.usage = u;
      save();
      this.version++;
    },
    set: function (name, value) { v[name] = value; save(); this.version++; }
  };
})();

var Data = (function () {
  'use strict';

  function store(key, value) { try { localStorage.setItem('fmtv.' + key, JSON.stringify(value)); } catch (e) {} }
  function stored(key) { try { return JSON.parse(localStorage.getItem('fmtv.' + key)); } catch (e) { return null; } }

  /** GET a JSON document; done(error, json). */
  function get(url, headers, done) {
    var x = new XMLHttpRequest();
    var over = false;
    x.open('GET', url, true);
    x.timeout = 10000;
    for (var h in headers) if (headers.hasOwnProperty(h)) x.setRequestHeader(h, headers[h]);
    x.onreadystatechange = function () {
      if (x.readyState !== 4 || over) return;
      over = true;
      if (x.status !== 200) { done(new Error(x.status === 401 ? 'TMDB rejected the key' : 'HTTP ' + x.status)); return; }
      var json;
      try { json = JSON.parse(x.responseText); } catch (e) { done(e); return; }
      done(null, json);
    };
    x.ontimeout = x.onerror = function () { if (!over) { over = true; done(new Error('no connection')); } };
    x.send();
  }

  var listeners = [];
  function changed() { for (var i = 0; i < listeners.length; i++) listeners[i](); }

  // MARK: - Weather

  var PLACE = Place.lat + ',' + Place.lon;
  var weather = null, weatherAt = 0, fetchingWeather = false;
  (function () {
    var w = stored('weather');
    if (w && w.place === PLACE) { weather = parseWeather(w.body); weatherAt = w.at; }
  })();

  /** "2026-10-20T18:31" at the location (Open-Meteo's local time) → epoch ms. */
  function localTime(iso, offsetSeconds) {
    var m = /^(\d+)-(\d+)-(\d+)T(\d+):(\d+)/.exec(iso || '');
    if (!m) return 0;
    return Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5]) - offsetSeconds * 1000;
  }

  function parseWeather(o) {
    if (!o || !o.current) return null;
    var off = o.utc_offset_seconds || 0, now = Date.now();
    var w = {
      temp: o.current.temperature_2m, code: o.current.weather_code, isDay: o.current.is_day !== 0,
      max: o.daily.temperature_2m_max[0], min: o.daily.temperature_2m_min[0],
      sunrise: localTime(o.daily.sunrise[0], off), sunset: localTime(o.daily.sunset[0], off), hours: []
    };
    var hr = o.hourly;
    for (var i = 0; hr && i < hr.time.length && w.hours.length < 6; i++) {
      var at = localTime(hr.time[i], off);
      if (at <= now) continue;
      w.hours.push({at: at, temp: hr.temperature_2m[i], code: hr.weather_code[i], day: !hr.is_day || hr.is_day[i] !== 0});
    }
    return w;
  }

  function refreshWeather() {
    var now = Date.now();
    if (fetchingWeather || (now - weatherAt < 30 * 60000 && now >= weatherAt)) return;
    fetchingWeather = true;
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + Place.lat + '&longitude=' + Place.lon
        + '&current=temperature_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset'
        + '&hourly=temperature_2m,weather_code,is_day&timezone=auto&forecast_days=2';
    get(url, {}, function (err, body) {
      fetchingWeather = false;
      if (err) return;
      weather = parseWeather(body);
      weatherAt = Date.now();
      store('weather', {place: PLACE, body: body, at: weatherAt});
      changed();
    });
  }

  // MARK: - Tide and moon
  //
  // The tide comes from the same table the association's buggy dashboard uses (the Tábua das Marés, through its
  // /api/passeio, which answers CORS and takes the key from config.properties). Without a key it comes from
  // Open-Meteo Marine, which needs none. Everything else here — the day's curve, the exact highs and lows, the
  // window when the beach is low enough for a buggy, and the moon — is computed in this file, so the screen keeps
  // working from the cache when the network is down.

  var TIDE_URL = (CONFIG.tideUrl || 'https://associacao.teintinu.com/api/passeio').trim();
  var TIDE_KEY = (CONFIG.tideApiKey || '').trim();
  var TIDE_LAT = CONFIG.tideLat === undefined || CONFIG.tideLat === '' ? Place.lat : String(CONFIG.tideLat);
  var TIDE_LON = CONFIG.tideLon === undefined || CONFIG.tideLon === '' ? Place.lon : String(CONFIG.tideLon);
  var TIDE_AT = TIDE_LAT + ',' + TIDE_LON;
  var STEP = 10 * 60000;                 // the curve is kept at 10-minute steps
  var TIDE_EVERY = 30 * 60000;           // the table does not change faster than that
  var TIDE_RETRY = 10 * 60000;           // after a failure, wait before asking again

  var tide = null, tideAt = 0, fetchingTide = false, tideFailedAt = 0, tideError = '';
  var RAD = Math.PI / 180;

  function sinR(deg) { return Math.sin(deg * RAD); }
  function cosR(deg) { return Math.cos(deg * RAD); }

  /** Level at `t` from the 10-minute curve (linear: the steps are short enough for a beach decision). */
  function levelAt(t) {
    var s = tide && tide.points;
    if (!s || !s.length) return NaN;
    if (t <= s[0][0]) return s[0][1];
    if (t >= s[s.length - 1][0]) return s[s.length - 1][1];
    var lo = 0, hi = s.length - 1;
    while (hi - lo > 1) {
      var mid = (lo + hi) >> 1;
      if (s[mid][0] <= t) lo = mid; else hi = mid;
    }
    var a = s[lo], b = s[hi], span = b[0] - a[0];
    return span > 0 ? a[1] + (b[1] - a[1]) * (t - a[0]) / span : a[1];
  }

  function catmull(p0, p1, p2, p3, u) {
    var u2 = u * u, u3 = u2 * u;
    return 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
  }

  /** The hourly samples of Open-Meteo as a smooth 10-minute curve (the table's are already 15 minutes apart). */
  function smooth(points) {
    if (points.length < 2) return points.slice();
    var out = [], i, j;
    for (i = 0; i < points.length - 1; i++) {
      var p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(points.length - 1, i + 2)];
      var span = p2[0] - p1[0];
      if (span <= 0) continue;
      var steps = Math.max(1, Math.round(span / STEP));
      for (j = 0; j < steps; j++) {
        var u = j / steps;
        out.push([p1[0] + span * u, catmull(p0[1], p1[1], p2[1], p3[1], u)]);
      }
    }
    out.push(points[points.length - 1]);
    return out;
  }

  /** Highs and lows of hourly samples, each one refined by a parabola (the peak is rarely on the hour). */
  function tideExtremes(points) {
    var out = [];
    for (var i = 1; i + 1 < points.length; i++) {
      var a = points[i - 1][1], b = points[i][1], c = points[i + 1][1];
      if (!((b > a && b >= c) || (b < a && b <= c))) continue;
      var curvature = a - 2 * b + c;
      var off = curvature ? 0.5 * (a - c) / curvature : 0;
      var peak = b - 0.25 * (a - c) * off;
      out.push([points[i][0] + off * (points[i + 1][0] - points[i][0]), peak, b > a ? 'max' : 'min']);
    }
    return out;
  }

  function byTime(a, b) { return a[0] - b[0]; }

  /** /api/passeio's answer: 15-minute points and the table's exact highs and lows. */
  function tabuaTide(o) {
    var days = o.days || [], points = [], extremes = [];
    for (var i = 0; i < days.length; i++) {
      var t = days[i].tide;
      if (!t) continue;
      var hourly = t.hourly || [], ext = t.extremes || [];
      for (var h = 0; h < hourly.length; h++) {
        var at = Date.parse(hourly[h].time);
        if (!isNaN(at) && isFinite(hourly[h].level)) points.push([at, +hourly[h].level]);
      }
      for (var e = 0; e < ext.length; e++) {
        var et = typeof ext[e].ts === 'number' ? ext[e].ts : Date.parse(ext[e].time);
        if (!isNaN(et) && (ext[e].kind === 'max' || ext[e].kind === 'min')) extremes.push([et, +ext[e].level, ext[e].kind]);
      }
    }
    points.sort(byTime);
    extremes.sort(byTime);
    return {
      points: points, extremes: extremes, source: 'tabua',
      label: o.tideSourceLabel || '', place: o.place && o.place.city ? o.place.city : ''
    };
  }

  /** Open-Meteo Marine: hourly heights above mean sea level (no key, no table). */
  function marineTide(o) {
    var h = o.hourly || {}, time = h.time || [], level = h.sea_level_height_msl || [], off = o.utc_offset_seconds || 0, points = [];
    for (var i = 0; i < time.length && i < level.length; i++) {
      if (level[i] === null || level[i] === undefined) continue;
      points.push([localTime(time[i], off), +level[i]]);
    }
    points.sort(byTime);
    return {points: points, extremes: tideExtremes(points), source: 'open-meteo', label: 'Open-Meteo Marine', place: ''};
  }

  function buildTide(raw) {
    return {
      points: smooth(raw.points), extremes: raw.extremes, source: raw.source, label: raw.label, place: raw.place
    };
  }

  (function () {
    var c = stored('tide');
    if (c && c.place === TIDE_AT && c.data && c.data.points && c.data.points.length) {
      tide = buildTide(c.data);
      tideAt = c.at || 0;
    }
  })();

  function refreshTides() {
    var now = Date.now();
    if (fetchingTide || (now - tideAt < TIDE_EVERY && now >= tideAt)) return;
    if (tideFailedAt && now - tideFailedAt < TIDE_RETRY && now >= tideFailedAt) return;
    fetchingTide = true;
    function done(err, raw) {
      fetchingTide = false;
      if (err || !raw || !raw.points.length) {
        tideFailedAt = Date.now();
        tideError = err ? err.message : 'no tide data';
        return;
      }
      tideError = '';
      tideFailedAt = 0;
      tide = buildTide(raw);
      tideAt = Date.now();
      store('tide', {place: TIDE_AT, data: raw, at: tideAt});
      changed();
    }
    // With a key the association answers with the Tábua's own highs and lows (the numbers the family knows);
    // without one, or where the table does not cover, Open-Meteo's model needs nothing.
    if (TIDE_KEY) {
      get(TIDE_URL + '?lat=' + TIDE_LAT + '&lon=' + TIDE_LON + '&days=3', {'x-api-key': TIDE_KEY}, function (err, body) {
        if (err) { done(err); return; }
        done(null, tabuaTide(body));
      });
      return;
    }
    get('https://marine-api.open-meteo.com/v1/marine?latitude=' + TIDE_LAT + '&longitude=' + TIDE_LON
        + '&hourly=sea_level_height_msl&timezone=auto&forecast_days=4', {}, function (err, body) {
      if (err) { done(err); return; }
      done(null, marineTide(body));
    });
  }

  /** The high or low after `now`, or null. */
  function nextExtreme(now) {
    for (var i = 0; tide && i < tide.extremes.length; i++) if (tide.extremes[i][0] > now) {
      return {t: tide.extremes[i][0], level: tide.extremes[i][1], kind: tide.extremes[i][2]};
    }
    return null;
  }

  /** Today's highs and lows (up to 4: two cycles). */
  function extremesToday(now) {
    var d = new Date(now), start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(), end = start + 86400000, out = [];
    for (var i = 0; tide && i < tide.extremes.length; i++) {
      var e = tide.extremes[i];
      if (e[0] >= start && e[0] < end) out.push({t: e[0], level: e[1], kind: e[2]});
    }
    return out.slice(0, 4);
  }

  /** Where the curve crosses `level` between two instants: [{t, up}]. */
  function crossings(level, from, to) {
    var s = tide && tide.points, out = [];
    if (!s || s.length < 2) return out;
    var start = Math.max(from, s[0][0]), end = Math.min(to, s[s.length - 1][0]);
    if (end <= start) return out;
    var t = start, prev = levelAt(start) - level;
    while (t < end) {
      var next = Math.min(t + 15 * 60000, end), d = levelAt(next) - level;
      if ((prev < 0 && d >= 0) || (prev > 0 && d <= 0)) {
        var lo = t, hi = next;
        for (var i = 0; i < 6; i++) {
          var mid = (lo + hi) / 2;
          if ((levelAt(mid) - level) * prev > 0) lo = mid; else hi = mid;
        }
        out.push({t: Math.round((lo + hi) / 2), up: d > prev});
      }
      prev = d;
      t = next;
    }
    return out;
  }

  /**
   * The beach door, for a buggy: the stretch where the water is below `level`.
   * in: the beach is open now and closes at `close`; out: it opens again at `open`;
   * always/never: the level does not cross all day; unknown: no tide data.
   */
  function beach(level, now) {
    if (!tide || !tide.points.length || isNaN(level)) return {state: 'unknown'};
    var inside = levelAt(now) < level;
    var list = crossings(level, now - 30 * 3600000, now + 36 * 3600000);
    var next = null;
    for (var i = 0; i < list.length; i++) if (list[i].t > now) { next = list[i]; break; }
    if (!next) return {state: inside ? 'always' : 'never'};
    return inside ? {state: 'in', close: next.t} : {state: 'out', open: next.t};
  }

  /** The stretches between `from` and `to` where the water is below `level`: [{start, end}] (end 0: still open). */
  function beachSpans(level, from, to) {
    if (!tide || !tide.points.length || isNaN(level)) return [];
    var last = tide.points[tide.points.length - 1][0];
    to = Math.min(to, last);
    if (to <= from) return [];
    var out = [], open = levelAt(from) < level, start = open ? from : 0;
    var list = crossings(level, from, to);
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (open && c.up) { out.push({start: start, end: c.t}); open = false; start = 0; }
      else if (!open && !c.up) { open = true; start = c.t; }
    }
    if (open && start) out.push({start: start, end: to});
    return out;
  }

  /** The next stretches a buggy can take the sand, from now: the one open right now comes first. */
  function beachWindows(level, now, count) {
    return beachSpans(level, now, now + 36 * 3600000).slice(0, count || 2);
  }

  // MARK: - The moon
  //
  // Low-precision lunar and solar positions (a few tenths of a degree): enough for the phase, the lit part and
  // the hour the moon comes up, and no libraries on a TV from 2016.

  function sunLongitude(jd) {
    var n = jd - 2451545.0, g = 357.528 + 0.9856003 * n;
    return 280.460 + 0.9856474 * n + 1.915 * sinR(g) + 0.020 * sinR(2 * g);
  }

  /** The moon's ecliptic longitude and latitude, in degrees. */
  function moonEcliptic(jd) {
    var n = jd - 2451545.0;
    var L = 218.316 + 13.176396 * n, M = 134.963 + 13.064993 * n;
    var D = 297.850 + 12.190749 * n, Ms = 357.529 + 0.98560028 * n, F = 93.272 + 13.229350 * n;
    var lon = L + 6.289 * sinR(M) - 1.274 * sinR(M - 2 * D) + 0.658 * sinR(2 * D) + 0.214 * sinR(2 * M) - 0.186 * sinR(Ms) - 0.114 * sinR(2 * F);
    return {lon: lon, lat: 5.128 * sinR(F)};
  }

  /** The moon's height above the horizon for a place, in degrees. */
  function moonAltitude(ms, lat, lon) {
    var jd = ms / 86400000 + 2440587.5, ecl = moonEcliptic(jd);
    var eps = 23.439 - 0.0000004 * (jd - 2451545.0);
    var latR = ecl.lat * RAD;
    var ra = Math.atan2(sinR(ecl.lon) * cosR(eps) - Math.tan(latR) * sinR(eps), cosR(ecl.lon)) / RAD;
    var dec = Math.asin(sinR(ecl.lat) * cosR(eps) + cosR(ecl.lat) * sinR(eps) * sinR(ecl.lon)) / RAD;
    var gmst = 280.46061837 + 360.98564736629 * (jd - 2451545.0);
    var hour = ((gmst + lon - ra) % 360 + 360) % 360;
    return Math.asin(sinR(lat) * sinR(dec) + cosR(lat) * cosR(dec) * cosR(hour)) / RAD;
  }

  /** When the moon rises and sets on this day, and whether it is up now. */
  function moonTimes(now, lat, lon) {
    var d = new Date(now), start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    var rise = 0, set = 0, prevT = start, prevA = moonAltitude(start, lat, lon);
    for (var t = start + 15 * 60000; t <= start + 86400000; t += 15 * 60000) {
      var a = moonAltitude(t, lat, lon);
      if ((prevA < 0 && a >= 0) || (prevA > 0 && a <= 0)) {
        var lo = prevT, hi = t;
        for (var i = 0; i < 8; i++) {
          var mid = (lo + hi) / 2;
          if ((moonAltitude(mid, lat, lon) > 0) === (prevA > 0)) lo = mid; else hi = mid;
        }
        var when = Math.round((lo + hi) / 2);
        if (a >= 0) { if (!rise) rise = when; } else if (!set) set = when;
      }
      prevA = a;
      prevT = t;
    }
    return {rise: rise, set: set, up: moonAltitude(now, lat, lon) > 0};
  }

  /** 0 = new, 0.25 = first quarter, 0.5 = full, 0.75 = last quarter; and the lit part, 0..1. */
  function moonInfo(now) {
    var jd = now / 86400000 + 2440587.5;
    var elong = ((moonEcliptic(jd).lon - sunLongitude(jd)) % 360 + 360) % 360;
    var times = moonTimes(now, +Place.lat, +Place.lon);
    return {
      phase: elong / 360,
      illumination: (1 - cosR(elong)) / 2,
      rise: times.rise || 0,
      set: times.set || 0,
      up: times.up
    };
  }

  // MARK: - Picks (TMDB)

  var KEY = (CONFIG.tmdbKey || '').trim();
  var REGION = Place.country;
  var API = 'https://api.themoviedb.org/3';

  /** Service name on TMDB (part of it, lowercase) → our key, how to find its app on the TV (id, name), its name. */
  var SERVICES = [
    ['netflix', 'netflix', /^netflix$/, /netflix/i, 'Netflix'],
    ['prime video', 'prime', /^amazon$/, /prime video|amazon/i, 'Prime Video'],
    ['disney', 'disney', /disney/, /disney/i, 'Disney+'],
    ['hulu', 'hulu', /^hulu/, /hulu/i, 'Hulu'],
    ['paramount', 'paramount', /paramount|cbs/, /paramount/i, 'Paramount+'],
    ['peacock', 'peacock', /peacock/, /peacock/i, 'Peacock'],
    ['globoplay', 'globoplay', /globoplay/, /globoplay/i, 'Globoplay'],
    ['max', 'max', /hbo|wbd|\.max/, /^(hbo )?max$|hbo max/i, 'Max'],
    ['apple tv', 'appletv', /appletv|apple\.tv/, /apple tv/i, 'Apple TV'],
    ['hotstar', 'hotstar', /hotstar/, /hotstar/i, 'JioHotstar'],
    ['crunchyroll', 'crunchyroll', /crunchyroll/, /crunchyroll/i, 'Crunchyroll']
  ];

  var installed = [];   // the TV's apps, from TV.apps()

  /** The installed app for a service key, or null. */
  function appFor(key) {
    for (var s = 0; s < SERVICES.length; s++) {
      if (SERVICES[s][1] !== key) continue;
      for (var i = 0; i < installed.length; i++) {
        if (SERVICES[s][2].test(installed[i].id) || SERVICES[s][3].test(installed[i].title)) return installed[i];
      }
    }
    return null;
  }

  function service(providerName) {
    var n = (providerName || '').toLowerCase();
    for (var i = 0; i < SERVICES.length; i++) {
      var s = SERVICES[i];
      if (s[0] === 'max' ? /\bmax\b/.test(n) : n.indexOf(s[0]) >= 0) return s;
    }
    return null;
  }

  function tmdb(path, done) {
    var bearer = KEY.indexOf('eyJ') === 0;   // read access token (v4) or API key (v3)
    var url = API + path + (bearer ? '' : (path.indexOf('?') >= 0 ? '&' : '?') + 'api_key=' + encodeURIComponent(KEY));
    get(url, bearer ? {Authorization: 'Bearer ' + KEY, Accept: 'application/json'} : {Accept: 'application/json'}, done);
  }

  var cache = stored('recs') || {};
  var picks = cache.picks || [], listAt = cache.listAt || 0, period = cache.period, listLang = cache.lang || '', stamp = cache.stamp || '';
  var fetchingRecs = false, failedAt = 0, recsError = '';
  // Whether the first attempt to get this hour's picks is over (it worked, or it
  // failed): until then the home shows no clock, because the picks may still come.
  var firstDone = false;

  function saveRecs() { store('recs', {picks: picks, listAt: listAt, period: period, lang: listLang, stamp: stamp}); }

  function hourPeriod(d) {
    var h = d.getHours();
    return h >= 5 && h < 12 ? 0 : h >= 12 && h < 18 ? 1 : 2;
  }

  function sourceStamp() {
    var s = KEY.length + ':' + KEY.slice(-6) + ':' + REGION + (CONFIG.hideAnimation ? ':no-animation' : '');
    for (var i = 0; i < SERVICES.length; i++) s += appFor(SERVICES[i][1]) ? '1' : '0';
    return s;
  }

  function franchise(title) {
    var t = (title || '').toLowerCase(), cut = t.indexOf(':');
    if (cut < 0) cut = t.indexOf(' - ');
    return (cut > 0 ? t.slice(0, cut) : t).replace(/^\s+|\s+$/g, '');
  }

  /** This hour's picks (three unless the row asks for more): movies ("movie"), shows ("tv") or both (null). */
  function now(kind, count) {
    var list = [];
    if (!KEY) return list;
    for (var i = 0; i < picks.length; i++) {
      var p = picks[i];
      if ((kind === null || kind === p.kind) && (!p.detailed || (p.app && appFor(p.app)))) list.push(p);
    }
    if (!list.length) return list;
    var hour = Math.floor(Date.now() / 3600000), out = [], seen = {}, want = count || 3;
    for (var j = 0; j < list.length && out.length < want; j++) {
      var q = list[(hour * 3 + j) % list.length], f = franchise(q.title);
      if (!seen[f]) { seen[f] = true; out.push(q); }
    }
    return out;
  }

  function lang() { return I18N.locale(); }

  function day(offset) {
    var d = new Date(Date.now() + offset * 86400000);
    function two(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate());
  }

  var GENRES = {
    ru: {"Action & Adventure": "Боевик и приключения", "Sci-Fi & Fantasy": "Фантастика и фэнтези", "War & Politics": "Война и политика", "Kids": "Для детей", "News": "Новости", "Soap": "Мыльная опера", "Talk": "Ток-шоу"},
    pt: {'Action & Adventure': 'Ação e Aventura', 'Sci-Fi & Fantasy': 'Ficção Científica e Fantasia', 'War & Politics': 'Guerra e Política',
      'Kids': 'Infantil', 'News': 'Notícias', 'Soap': 'Novela', 'Talk': 'Entrevistas'},
    es: {'Action & Adventure': 'Acción y Aventura', 'Sci-Fi & Fantasy': 'Ciencia ficción y Fantasía', 'War & Politics': 'Guerra y Política',
      'Kids': 'Infantil', 'News': 'Noticias', 'Soap': 'Telenovela', 'Talk': 'Entrevistas'},
    de: {'Action & Adventure': 'Action & Abenteuer', 'War & Politics': 'Krieg & Politik', 'Kids': 'Kinder', 'News': 'Nachrichten',
      'Soap': 'Seifenoper', 'Talk': 'Talkshow'}
  };

  /** The best backdrop: no text over it, the largest, then the best rated. */
  function bestBackdrop(images) {
    var list = images && images.backdrops, best = null, score = -1;
    for (var i = 0; list && i < list.length; i++) {
      var b = list[i];
      if (!b.file_path) continue;
      var s = (b.iso_639_1 === null ? 1e7 : 0) + Math.min(b.width || 0, 3840) * 100 + (b.vote_average || 0);
      if (s > score) { score = s; best = b.file_path; }
    }
    return best;
  }

  /** Genre, runtime or seasons, and the service it's on among the TV's apps. */
  function details(p, done) {
    tmdb('/' + p.kind + '/' + p.id + '?language=' + lang() + '&append_to_response=watch/providers,images&include_image_language=null,'
        + I18N.lang + ',en', function (err, o) {
      if (err) { done(err); return; }
      var best = bestBackdrop(o.images);
      if (best) p.backdrop = best;
      var parts = [];
      if (p.kind === 'tv') parts.push(tr('Série', 'Series', 'Serie'));
      if (o.genres && o.genres.length) {
        var g = o.genres[0].name, table = GENRES[I18N.lang];
        parts.push(table && table[g] ? table[g] : g);
      }
      if (p.kind === 'movie' && o.runtime > 0) {
        var h = Math.floor(o.runtime / 60), m = o.runtime % 60;
        parts.push(I18N.lang === 'ru' ? (h ? h + ' ч ' + m + ' мин' : m + ' мин') : I18N.lang === 'en' ? (h ? h + 'h ' + m + 'm' : m + 'm') : (h ? h + ' h ' + m + ' min' : m + ' min'));
      } else if (p.kind === 'tv' && o.number_of_seasons > 0) {
        var n = o.number_of_seasons;
        parts.push(I18N.lang === 'ru' ? I18N.count(n, 'сезон', 'сезона', 'сезонов') : tr(n === 1 ? '1 temporada' : n + ' temporadas', n === 1 ? '1 season' : n + ' seasons', n === 1 ? '1 temporada' : n + ' temporadas'));
      }
      var wp = o['watch/providers'], here = wp && wp.results && wp.results[REGION], flat = here && here.flatrate;
      p.app = null;
      for (var i = 0; flat && i < flat.length && !p.app; i++) {
        var s = service(flat[i].provider_name);
        if (s && appFor(s[1])) { p.app = s[1]; p.service = s[4]; }
      }
      if (p.service && p.app) parts.push(p.service);
      p.meta = parts.join(' · ');
      title(p, o, function () {
        p.detailed = true;
        done(null);
      });
    });
  }

  /**
   * Without a title in the TV's language TMDB answers with the original one, so a Korean series on a German TV reads
   * "닥터X: 하얀 마피아의 시대". Then the English title, when TMDB has one (one more request, only for those).
   */
  function title(p, o, done) {
    var field = p.kind === 'movie' ? 'title' : 'name', own = o[field] || p.title;
    p.title = own;
    if (I18N.lang === 'en' || !own || own !== o['original_' + field] || o.original_language === I18N.lang
        || o.original_language === 'en') { done(); return; }
    tmdb('/' + p.kind + '/' + p.id + '?language=en-US', function (err, en) {
      if (!err && en && en[field]) p.title = en[field];
      done();
    });
  }

  /** TMDB's Animation genre (movies and shows: cartoons and anime), left out with hide_animation=true. */
  var ANIMATION = 16;

  function animated(o) {
    for (var i = 0; o.genre_ids && i < o.genre_ids.length; i++) if (o.genre_ids[i] === ANIMATION) return true;
    return false;
  }

  function addPick(list, o, kind) {
    if (!o.backdrop_path) return;
    if (CONFIG.hideAnimation && animated(o)) return;
    list.push({id: o.id, kind: kind, title: kind === 'movie' ? o.title : o.name, backdrop: o.backdrop_path, meta: '', app: null, detailed: false});
  }

  function keyOf(p) { return p.kind + ':' + p.id; }

  function alternate(out, seen, a, b, max) {
    for (var i = 0; i < Math.max(a.length, b.length) && out.length < max; i++) {
      if (i < a.length && !seen[keyOf(a[i])]) { seen[keyOf(a[i])] = true; out.push(a[i]); }
      if (i < b.length && out.length < max && !seen[keyOf(b[i])]) { seen[keyOf(b[i])] = true; out.push(b[i]); }
    }
  }

  /** Runs fn on each item one after the other (the TV's network is shared with what's playing). */
  function each(items, fn, done) {
    var i = 0;
    (function next() {
      if (i >= items.length) { done(); return; }
      fn(items[i++], next);
    })();
  }

  function fetchList(done) {
    tmdb('/watch/providers/movie?language=' + lang() + '&watch_region=' + REGION, function (err, res) {
      if (err) { done(err); return; }
      var ids = [];
      for (var i = 0; res.results && i < res.results.length; i++) {
        var s = service(res.results[i].provider_name);
        if (s && appFor(s[1])) ids.push(res.results[i].provider_id);
      }
      if (!ids.length) { done(new Error("none of the TV's streaming apps are on TMDB")); return; }
      var common = '&language=' + lang() + '&watch_region=' + REGION + '&with_watch_monetization_types=flatrate&include_adult=false'
          + '&sort_by=popularity.desc&with_watch_providers=' + encodeURIComponent(ids.join('|'))
          + (CONFIG.hideAnimation ? '&without_genres=' + ANIMATION : '');
      var hot = {movie: [], tv: []}, fresh = {movie: [], tv: []};
      each(['movie', 'tv'], function (kind, next) {
        tmdb('/trending/' + kind + '/week?language=' + lang(), function (e, r) {
          var candidates = [];
          for (var j = 0; !e && j < r.results.length && j < 16; j++) addPick(candidates, r.results[j], kind);
          // Trending is only kept when it's on one of the TV's apps: the details say where.
          each(candidates, function (p, n) {
            details(p, function (de) { if (!de && p.app) hot[kind].push(p); n(); });
          }, next);
        });
      }, function () {
        tmdb('/discover/movie?vote_count.gte=30&primary_release_date.gte=' + day(-365) + '&primary_release_date.lte=' + day(0) + common, function (e1, r1) {
          for (var j = 0; !e1 && j < r1.results.length; j++) addPick(fresh.movie, r1.results[j], 'movie');
          tmdb('/discover/tv?vote_count.gte=20&air_date.gte=' + day(-90) + '&air_date.lte=' + day(0) + common, function (e2, r2) {
            for (var k = 0; !e2 && k < r2.results.length; k++) addPick(fresh.tv, r2.results[k], 'tv');
            var list = [], seen = {};
            alternate(list, seen, hot.movie, hot.tv, 24);
            alternate(list, seen, fresh.movie, fresh.tv, 24);
            if (!list.length) { done(new Error('TMDB returned no recommendations')); return; }
            picks = list;
            done(null);
          });
        });
      });
    });
  }

  /** Fetches the list when stale (6 h, a new period of the day, language, key or apps), then this hour's details. */
  function refreshRecs() {
    if (!KEY || fetchingRecs || !installed.length) return;
    var t = Date.now(), p = hourPeriod(new Date()), st = sourceStamp();
    if (st === stamp && failedAt && t - failedAt < 10 * 60000 && t >= failedAt) { firstDone = true; return; }
    var stale = st !== stamp || p !== period || t - listAt > 6 * 3600000 || t < listAt || !picks.length || listLang !== I18N.lang;
    var wanted = all(), missing = false;
    for (var i = 0; i < wanted.length; i++) missing = missing || !wanted[i].detailed;
    if (!stale && !missing) { firstDone = true; return; }
    fetchingRecs = true;
    stamp = st;
    function finish(err) {
      fetchingRecs = false;
      firstDone = true;
      if (err) { recsError = err.message; failedAt = Date.now(); } else { recsError = ''; failedAt = 0; }
      saveRecs();
      changed();
    }
    function detailWanted() {
      var todo = all().filter(function (x) { return !x.detailed; });
      each(todo, function (x, next) { details(x, function () { next(); }); }, function () { finish(null); });
    }
    if (stale) {
      fetchList(function (err) {
        if (err) { finish(err); return; }
        listAt = Date.now();
        period = p;
        listLang = I18N.lang;
        detailWanted();
      });
    } else {
      detailWanted();
    }
  }

  /** This hour's picks for the three tabs, without repeats (the screensaver shows them too). */
  function all() {
    var out = [], seen = {}, kinds = [null, 'movie', 'tv'];
    for (var k = 0; k < kinds.length; k++) {
      var list = now(kinds[k]);
      for (var i = 0; i < list.length; i++) if (!seen[keyOf(list[i])]) { seen[keyOf(list[i])] = true; out.push(list[i]); }
    }
    return out;
  }

  // MARK: - Formatting

  function fmt(v, digits) {
    try { return v.toLocaleString(I18N.locale(), {minimumFractionDigits: digits, maximumFractionDigits: digits}); } catch (e) { return v.toFixed(digits); }
  }

  return {
    city: Place.city,
    onChange: function (fn) { listeners.push(fn); },
    setApps: function (apps) { installed = apps; },
    appFor: appFor,
    refresh: function () { refreshWeather(); refreshTides(); refreshRecs(); },
    get weather() { return weather; },
    get weatherAt() { return weatherAt; },

    // Tide: the table's curve, its highs and lows, and the window when the beach is low enough.
    tide: function () { return tide; },
    tideAt: function () { return tideAt; },
    tideError: function () { return tideError; },
    tideLabel: function () { return tide ? tide.label : ''; },
    tidePlace: function () { return tide ? tide.place : ''; },
    tideSource: function () { return tide ? tide.source : ''; },
    levelAt: levelAt,
    beach: beach,
    beachWindows: beachWindows,
    beachSpans: beachSpans,
    nextExtreme: nextExtreme,
    todayExtremes: extremesToday,
    /** The curve between two instants, for the day's chart. */
    curve: function (from, to) {
      var s = tide && tide.points, out = [];
      for (var i = 0; s && i < s.length; i++) if (s[i][0] >= from && s[i][0] <= to) out.push({t: s[i][0], level: s[i][1]});
      return out;
    },
    moon: moonInfo,
    /** A height with one decimal, in the tide table's own datum: "0,8 m". */
    meters: function (v) { return isNaN(v) ? '—' : fmt(v, 1) + ' m'; },
    /** The same number without the unit, for a row of them where it is repeated. */
    height: function (v) { return isNaN(v) ? '—' : fmt(v, 1); },

    hasKey: function () { return !!KEY; },
    /** No key at all, or the first picks fetch is over: the home knows whether picks exist. */
    settled: function () { return !KEY || firstDone; },
    recsError: function () { return recsError; },
    picks: function (kind, count) { return now(kind, count); },
    showcase: all,
    image: function (path, size) { return path ? 'https://image.tmdb.org/t/p/' + (size || 'w1280') + path : ''; },

    /** Night at the location: from sunset to sunrise (the last forecast; without one, 6:00 and 18:00). */
    isNight: function (at) {
      var theme = Prefs.theme();
      if (theme === 'dark') return true;
      if (theme === 'light') return false;
      var d = new Date(at), mins = d.getHours() * 60 + d.getMinutes();
      function hm(t, fallback) { if (!t) return fallback; var x = new Date(t); return x.getHours() * 60 + x.getMinutes(); }
      var rise = hm(weather && weather.sunrise, 360), set = hm(weather && weather.sunset, 1080);
      return mins < rise || mins >= set;
    },

    degrees: function (v) {
      if (v === undefined || v === null || isNaN(v)) return '—';
      var unit = Prefs.temperature();
      var f = unit === 'F' || (unit === 'auto' && Place.fahrenheit);
      return Math.round(f ? v * 9 / 5 + 32 : v) + '°';
    },
    hour: function (at) {
      var d = new Date(at), h = d.getHours();
      if (I18N.lang === 'en') return (h % 12 || 12) + (h < 12 ? ' AM' : ' PM');
      if (I18N.lang === 'de') return (h < 10 ? '0' : '') + h + ' Uhr';
      return (I18N.lang === 'es' || I18N.lang === 'ru') ? (h < 10 ? '0' : '') + h + ':00' : h + 'h';
    },
    time: function (at) {
      var d = new Date(at), h = d.getHours(), m = d.getMinutes();
      if (I18N.lang === 'en') return (h % 12 || 12) + ':' + (m < 10 ? '0' : '') + m + (h < 12 ? ' AM' : ' PM');
      return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
    },
    /** "12 min ago" when the data is old (no internet), or empty. */
    staleness: function (at, every) {
      if (!at) return '';
      var age = Date.now() - at;
      if (age < every * 2) return '';
      var m = Math.floor(age / 60000), h = Math.floor(m / 60);
      return m < 60 ? tr('há ' + m + ' min', m + ' min ago', 'hace ' + m + ' min') : tr('há ' + h + ' h', h + ' h ago', 'hace ' + h + ' h');
    },
    condition: function (code, day) {
      if (code === undefined || code === null || code < 0) return '';
      if (code === 0) return tr(day ? 'Céu limpo' : 'Noite limpa', 'Clear', day ? 'Despejado' : 'Noche despejada');
      if (code === 1) return tr('Poucas nuvens', day ? 'Mostly Sunny' : 'Mostly Clear', 'Mayormente despejado');
      if (code === 2) return tr('Parcialmente nublado', 'Partly Cloudy', 'Parcialmente nublado');
      if (code === 3) return tr('Nublado', 'Cloudy', 'Nublado');
      if (code === 45 || code === 48) return tr('Neblina', 'Fog', 'Niebla');
      if (code >= 51 && code <= 57) return tr('Garoa', 'Drizzle', 'Llovizna');
      if (code === 65 || code === 67 || code === 82) return tr('Chuva forte', 'Heavy Rain', 'Lluvia fuerte');
      if ((code >= 71 && code <= 77) || code === 85 || code === 86) return tr('Neve', 'Snow', 'Nieve');
      if (code >= 95) return tr('Tempestade', 'Thunderstorms', 'Tormenta');
      return tr('Chuva', 'Rain', 'Lluvia');
    },
    symbol: function (code, day) {
      if (code <= 1) return day ? 'sunny' : 'clear_night';
      if (code === 2) return day ? 'partly_cloudy_day' : 'partly_cloudy_night';
      if (code === 3) return 'cloud';
      if (code === 45 || code === 48) return 'foggy';
      if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snowflake';
      if (code >= 95) return 'thunderstorm';
      return 'rainy';
    }
  };
})();
