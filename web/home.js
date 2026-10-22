/*
 * The home screen for web-app TVs (LG webOS, Samsung Tizen), with the Android app's design and behavior (HomeView):
 *  - top: the "For You" title and the tabs (Explore, Movies, Shows); icon-only glass buttons at the right (Live TV,
 *    HDMI Inputs, Settings) and the crypto quotes at the end of the tab row;
 *  - three picks for this hour in the selected tab; the background is the first one's photo, blurred and almost white;
 *  - the glass shelf with the apps; ↓ opens the drawer (inputs, shortcuts, weather, prices); ↑ or Back closes it;
 *  - a night look from sunset to sunrise; a screensaver after a few idle minutes.
 * The remote's arrows, OK and Back move the focus; a pointer (LG's Magic Remote) focuses what it points at.
 */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  function el(tag, cls, parent, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }

  /** Points a symbol at another PNG, and leaves it alone when it already is that one. */
  function setSym(s, name) {
    if (s.__sym === name) return;
    s.__sym = name;
    s.style.webkitMaskImage = 'url(symbols/' + name + '.png)';
    s.style.maskImage = 'url(symbols/' + name + '.png)';
  }

  function sym(name, parent, size) {
    var s = el('span', 'sym', parent);
    setSym(s, name);
    if (size) { s.style.width = size + 'px'; s.style.height = size + 'px'; }
    return s;
  }

  /** Writes text only when it changed: an identical write is a DOM mutation and a repaint. */
  function setText(node, text) {
    if (node && node.textContent !== text) node.textContent = text;
  }

  function coin(i, parent) {
    var c = window.COINS && window.COINS[i];
    if (!c) return;
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 32 32');
    for (var k = 0; k < c.length; k++) {
      var p = document.createElementNS(ns, 'path');
      p.setAttribute('d', c[k]);
      p.setAttribute('fill-rule', 'evenodd');
      svg.appendChild(p);
    }
    parent.appendChild(svg);
  }

  function hasClass(e, c) { return (' ' + e.className + ' ').indexOf(' ' + c + ' ') >= 0; }
  function setClass(e, c, on) {
    if (!e) return;
    if (on && !hasClass(e, c)) e.className = (e.className + ' ' + c).replace(/^\s+/, '');
    else if (!on && hasClass(e, c)) e.className = (' ' + e.className + ' ').replace(' ' + c + ' ', ' ').replace(/^\s+|\s+$/g, '');
  }

  /** A transform written only when it changed: an identical write still costs a style pass. */
  function setTransform(node, value) {
    if (!node || node.__t === value) return;
    node.__t = value;
    node.style.webkitTransform = node.style.transform = value;
  }

  var stage = $('stage'), body = document.body;

  // The home is built while it is still invisible, and it opens with the theme it
  // already computed: without this the day/night colours transitioned from the
  // other theme, so a night start showed a white screen for a second or two.
  // markReady() takes it off two frames after the reveal.
  setClass(body, 'no-anim', true);

  /** The 1920 × 1080 stage fills the window (on the TV it already is 1920 × 1080). */
  var fitScale = -1;
  function fit() {
    var s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    if (s === fitScale) return;
    fitScale = s;
    stage.style.webkitTransform = stage.style.transform = s === 1 ? '' : 'scale(' + s + ')';
  }

  // MARK: - Apps on the shelf

  /** Shelf apps in this order when installed, like the Android app: key, LG app id, name on the TV, brand gradient. */
  var SHELF = [
    ['netflix', /^netflix$/, /netflix/i, ['#0A0A0A', '#000000']],
    ['youtube', /youtube/, /^youtube$/i, ['#1C1C1E', '#09090A']],
    ['prime', /^amazon$/, /prime video|amazon/i, ['#2AA8FF', '#0A68D4']],
    ['disney', /disney/, /disney/i, ['#173584', '#08143F']],
    ['max', /hbo|wbd/, /^(hbo )?max$|hbo max/i, ['#5C30E8', '#221684']],
    ['appletv', /appletv|apple\.tv/, /apple tv/i, ['#1C1C1E', '#000000']],
    ['hulu', /^hulu/, /hulu/i, ['#1CE783', '#0B8F4E']],
    ['paramount', /paramount|cbs/, /paramount/i, ['#0064FF', '#002A86']],
    ['peacock', /peacock/, /peacock/i, ['#1C1C1E', '#000000']],
    ['nfl', /nfl/, /^nfl/i, ['#013369', '#00163D']],
    ['globoplay', /globoplay/, /globoplay/i, ['#FF8A1F', '#FF2D5A']],
    ['spotify', /spotify/, /spotify/i, ['#1DB954', '#0F7A36']]
  ];
  var MAX_SHELF = 8;

  function shelfKey(app) {
    for (var i = 0; i < SHELF.length; i++) if (SHELF[i][1].test(app.id) || SHELF[i][2].test(app.title)) return SHELF[i];
    return null;
  }

  function darken(hex, f) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return '#161618';
    var n = parseInt(m[1], 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return 'rgb(' + Math.round(r * f) + ',' + Math.round(g * f) + ',' + Math.round(b * f) + ')';
  }

  /** A name that fits the tile on one line (the font shrinks for long names). */
  function wordFit(title, width, max) {
    return Math.max(18, Math.min(max, Math.floor(width * 0.8 / (Math.max(4, title.length) * 0.56))));
  }

  /** An app's face: its own icon on its brand color (or its name, when the icon can't be read). */
  // --- Images: load and decode before the view is swapped -------------------
  // On this TV (webOS 4.x, Chromium 53) a background-image paints only once the
  // file has arrived *and* been decoded, so a view swapped first shows empty
  // boxes — on a 1080p TV that reads as a flash. There is no img.decode() in
  // Chromium 53, so the decode is forced by drawing into a 1x1 canvas.
  var preloaded = {};      // url -> true once it arrived and was decoded, false when it failed (no retry)
  var drawable = {};       // url -> Image kept ready to draw at once: the blurred background, a few at most
  var drawableKeys = [];

  function decodeImage(url, done) {
    var img = new Image();
    function finish(ok) {
      if (ok) {
        try {
          var c = document.createElement('canvas');
          c.width = c.height = 1;
          c.getContext('2d').drawImage(img, 0, 0, 1, 1);
        } catch (e) {}
      }
      preloaded[url] = ok;
      done();
    }
    img.onload = function () { finish(true); };
    img.onerror = function () { finish(false); };
    img.src = url;
  }

  function preloadImages(urls, done, timeout) {
    var pending = [], i, u;
    for (i = 0; i < urls.length; i++) {
      u = urls[i];
      if (u && preloaded[u] === undefined && pending.indexOf(u) === -1) pending.push(u);
    }
    if (!pending.length) { done(); return; }
    var left = pending.length, finished = false, timer = null;
    function finish() {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      done();
    }
    // A slow or broken file must never hold the screen hostage.
    timer = setTimeout(finish, timeout || 2500);
    for (i = 0; i < pending.length; i++) {
      decodeImage(pending[i], (function () {
        return function () { if (--left <= 0) finish(); };
      })());
    }
  }

  // Two frames: the first commits the new DOM, the second paints it with the
  // images already decoded. Swapping inside a single frame is what makes the
  // empty state visible.
  function afterPaint(fn) {
    requestAnimationFrame(function () { requestAnimationFrame(fn); });
  }

  /** Keeps an image decoded so the background canvas can be drawn in the same frame as the swap. */
  function prepBackdrop(url, done) {
    if (!url || drawable[url]) { done(); return; }
    var img = new Image();
    img.onload = img.onerror = function () {
      drawable[url] = img;
      drawableKeys.push(url);
      if (drawableKeys.length > 8) delete drawable[drawableKeys.shift()];
      done();
    };
    img.src = url;
  }

  function iconUrls() {
    var urls = [];
    for (var i = 0; i < apps.length; i++) if (apps[i].icon) urls.push(apps[i].icon);
    return urls;
  }

  // The symbols are mask images: a new span that points at a PNG not decoded yet
  // paints empty for a frame. Loading them up front keeps every icon whole.
  var SYMBOLS = ['live_tv', 'hdmi', 'settings', 'apps', 'tv_settings', 'sunny', 'clear_night', 'partly_cloudy_day',
    'partly_cloudy_night', 'cloud', 'foggy', 'snowflake', 'thunderstorm', 'rainy', 'sunrise', 'sunset'];

  function symbolUrls() {
    var urls = [];
    for (var i = 0; i < SYMBOLS.length; i++) urls.push('symbols/' + SYMBOLS[i] + '.png');
    return urls;
  }

  function face(app, box, wordSize) {
    var k = shelfKey(app);
    var top = k ? k[3][0] : app.color ? darken(app.color, 0.92) : '#2A2A2E';
    var bottom = k ? k[3][1] : app.color ? darken(app.color, 0.62) : '#161618';
    box.style.background = '-webkit-linear-gradient(top, ' + top + ', ' + bottom + ')';
    box.style.background = 'linear-gradient(' + top + ', ' + bottom + ')';
    var word = el('div', 'word', box, app.title);
    if (wordSize) word.style.fontSize = wordSize + 'px';
    if (app.icon) {
      var img = el('img', '', box);
      // An icon already loaded is hidden at once; one that isn't keeps the name
      // until it loads, so a tile is never an empty box.
      if (preloaded[app.icon] === true) word.style.visibility = 'hidden';
      img.onload = function () { word.style.visibility = 'hidden'; };
      img.onerror = function () { img.parentNode.removeChild(img); word.style.visibility = ''; };
      img.src = app.icon;
    }
  }

  var apps = [], shelf = [], others = [], inputs = [];

  function pickShelf() {
    var chosen = Prefs.shelf(), out = [];
    if (chosen) {
      for (var i = 0; i < chosen.length && out.length < MAX_SHELF; i++) {
        for (var j = 0; j < apps.length; j++) if (apps[j].id === chosen[i]) out.push(apps[j]);
      }
    } else {
      for (var s = 0; s < SHELF.length && out.length < MAX_SHELF; s++) {
        for (var a = 0; a < apps.length; a++) {
          if ((SHELF[s][1].test(apps[a].id) || SHELF[s][2].test(apps[a].title)) && out.indexOf(apps[a]) < 0) { out.push(apps[a]); break; }
        }
      }
      if (!out.length) out = apps.slice(0, MAX_SHELF);
    }
    shelf = out;
    others = apps.filter(function (x) { return shelf.indexOf(x) < 0; });
  }

  // MARK: - Focus

  var Z = {TOP: 'top', CARDS: 'cards', SHELF: 'shelf', DRAWER: 'drawer', APPS: 'apps', SETTINGS: 'settings', EDIT: 'edit'};
  var st = {zone: Z.SHELF, top: 0, tab: 0, card: 0, shelf: 0, drawer: 0, grid: 0, row: 0, edit: 0};
  var cards = [];

  function sheetOpen() { return st.zone === Z.APPS || st.zone === Z.SETTINGS || st.zone === Z.EDIT; }

  function updateFocus() {
    var i, list;
    list = $('tabs').children;
    for (i = 0; i < list.length; i++) {
      setClass(list[i], 'on', i === st.tab);
      setClass(list[i], 'focus', st.zone === Z.TOP && st.top === i);
    }
    list = $('buttons').children;
    for (i = 0; i < list.length; i++) setClass(list[i], 'focus', st.zone === Z.TOP && st.top === 3 + i);
    setClass($('quotes'), 'hide', st.zone === Z.TOP && st.top >= 3);
    list = $('cards').children;
    for (i = 0; i < list.length; i++) setClass(list[i], 'focus', st.zone === Z.CARDS && st.card === i);
    list = $('tiles').children;
    for (i = 0; i < list.length; i++) setClass(list[i], 'focus', st.zone === Z.SHELF && st.shelf === i);
    list = document.querySelectorAll('#drawer .key');
    for (i = 0; i < list.length; i++) setClass(list[i], 'focus', st.zone === Z.DRAWER && st.drawer === i);
    list = document.querySelectorAll('#apps .cell');
    for (i = 0; i < list.length; i++) setClass(list[i], 'focus', st.zone === Z.APPS && st.grid === i);
    var rows = Math.max(1, Math.ceil(others.length / 5)), r = Math.floor(st.grid / 5), first = Math.max(0, Math.min(rows - 3, r - 1));
    setTransform($('apps').lastChild, 'translateY(' + (-first * 239) + 'px)');
    focusRows($('settings'), st.row, st.zone === Z.SETTINGS);
    focusRows($('shelfedit'), st.edit, st.zone === Z.EDIT);
    setClass(body, 'drawer-open', st.zone === Z.DRAWER);
  }

  function focusRows(sheet, index, on) {
    var rows = sheet.querySelectorAll('.row');
    for (var i = 0; i < rows.length; i++) setClass(rows[i], 'focus', on && i === index);
    var holder = sheet.querySelector('.rows');
    if (!holder) return;
    var visible = 7, first = Math.max(0, Math.min(rows.length - visible, index - 3));
    setTransform(holder, 'translateY(' + (-first * 78) + 'px)');
  }

  function nearest(nodes, x) {
    var best = 0, bestD = 1e9;
    for (var i = 0; i < nodes.length; i++) {
      var r = nodes[i].getBoundingClientRect(), d = Math.abs((r.left + r.right) / 2 - x);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  function centerX(node) {
    if (!node) return 960;
    var r = node.getBoundingClientRect();
    return (r.left + r.right) / 2;
  }

  // MARK: - Top: title, tabs, buttons, quotes

  var TAB_KIND = [null, 'movie', 'tv'];

  var topSig = '';

  function renderTop() {
    var title = tr('Para você', 'For You', 'Para ti');
    var names = [tr('Explorar', 'Explore', 'Explorar'), tr('Filmes', 'Movies', 'Películas'), tr('Séries', 'Shows', 'Series')];
    var defs = [['live_tv', tr('TV aberta', 'Live TV', 'TV en vivo')], ['hdmi', tr('Entradas HDMI', 'HDMI Inputs', 'Entradas HDMI')],
      ['settings', tr('Ajustes', 'Settings', 'Ajustes')]];
    // Same texts as the ones already painted? Leave the nodes alone: rebuilding the
    // tabs and the glass buttons re-created their icon masks on every render.
    var sig = title + '|' + names.join('|') + '|' + defs.join('|');
    if (sig === topSig) return;
    topSig = sig;
    $('title').textContent = title;
    var tabs = $('tabs');
    tabs.innerHTML = '';
    for (var i = 0; i < 3; i++) {
      var t = el('button', 'tab', tabs, names[i]);
      hover(t, Z.TOP, i);
    }
    var buttons = $('buttons');
    buttons.innerHTML = '';
    for (var b = 0; b < 3; b++) {
      var r = el('button', 'round' + (b === 2 ? ' last' : ''), buttons);
      r.style.left = (1596 + 88 * b) + 'px';
      sym(defs[b][0], r);
      el('div', 'tip', r, defs[b][1]);
      hover(r, Z.TOP, 3 + b);
    }
  }

  function renderQuotes() {
    var q = $('quotes'), coins = Data.activeCoins();
    // Same coins as last time? Update the numbers in place. Rebuilding the whole
    // strip made the top-right corner blink on every price refresh (every 30 s).
    var rows = q.querySelectorAll('.q');
    var same = rows.length === coins.length;
    // data-coin holds the index as a string: comparing it with the number made every
    // refresh look different, so the strip was rebuilt on every tick after all.
    for (var r = 0; same && r < rows.length; r++) same = rows[r].getAttribute('data-coin') === String(coins[r]);
    if (same) {
      for (var s = 0; s < coins.length; s++) {
        var value = rows[s].lastElementChild;
        if (value) setText(value, Data.compact(Data.prices[coins[s]]));
      }
      return;
    }
    q.innerHTML = '';
    for (var i = 0; i < coins.length; i++) {
      var item = el('span', 'q', q);
      item.setAttribute('data-coin', coins[i]);
      coin(coins[i], item);
      el('span', '', item, Data.compact(Data.prices[coins[i]]));
    }
  }

  // MARK: - Picks and background

  var cardsGen = 0;

  function renderCards() {
    var list = Data.picks(TAB_KIND[st.tab]);
    var holder = $('cards');
    // Without picks the big clock takes their place — but only once we know there
    // will be none: showing it while the first fetch runs made it vanish again
    // when the posters arrived.
    setNoPicks(!list.length && Data.settled());
    var same = list.length === cards.length;
    for (var i = 0; same && i < list.length; i++) same = list[i].id === cards[i].id && list[i].backdrop === cards[i].backdrop && list[i].meta === cards[i].meta;
    if (same && holder.children.length === list.length) return;
    // Every poster (plus the small one the blurred backdrop is drawn from) is
    // decoded first; only then the cards are swapped in, in one painted frame.
    var backUrl = list.length ? Data.image(list[0].backdrop, 'w300') : '';
    var urls = [];
    for (var u = 0; u < list.length; u++) {
      if (list[u].backdrop) urls.push(Data.image(list[u].backdrop, u === 0 ? 'w1280' : 'w300'));
    }
    if (backUrl) urls.push(backUrl);
    var gen = ++cardsGen;
    preloadImages(urls, function () {
      if (gen !== cardsGen) return;      // a newer swap already took over
      prepBackdrop(backUrl, function () {
        if (gen !== cardsGen) return;
        afterPaint(function () {
          if (gen !== cardsGen) return;
          swapCards(list, holder);
        });
      });
    });
  }

  function swapCards(list, holder) {
    cards = list;
    holder.innerHTML = '';
    var rects = [[80, 1040], [1160, 320], [1520, 320]];
    for (var c = 0; c < list.length; c++) {
      var p = list[c], card = el('div', 'card', holder);
      card.style.left = rects[c][0] + 'px';
      card.style.width = rects[c][1] + 'px';
      var img = el('div', 'img', card);
      // 1040px wide for the hero card, 320px for the two beside it: matching the
      // slot keeps the download honest (w780 for a 320px slot was 6x the bytes).
      img.style.backgroundImage = 'url(' + Data.image(p.backdrop, c === 0 ? 'w1280' : 'w300') + ')';
      el('div', 'name', card, p.title);
      if (c === 0 && p.meta) el('div', 'meta', card, p.meta);
      hover(card, Z.CARDS, c);
    }
    st.card = Math.min(st.card, Math.max(0, list.length - 1));
    if (!list.length && st.zone === Z.CARDS) st.zone = Z.SHELF;
    backdrop(list.length ? Data.image(list[0].backdrop, 'w300') : '');
    setClass(body, 'cards-ready', true);
    updateFocus();
    revealWhenPainted();
  }

  var bgUrl = null, bgFront = 'bgA';

  /** The first pick's photo as the background: drawn tiny and stretched, it's already as soft as a heavy blur. */
  function backdrop(url) {
    if (url === bgUrl) return;
    bgUrl = url;
    var next = bgFront === 'bgA' ? 'bgB' : 'bgA';
    if (!url) {
      setClass($('bgA'), 'on', false);
      setClass($('bgB'), 'on', false);
      return;
    }
    function paint(img) {
      if (bgUrl !== url) return;
      var canvas = $(next), ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      setClass(canvas, 'on', true);
      setClass($(bgFront), 'on', false);
      bgFront = next;
    }
    // Already decoded (the cards preloaded it): draw it now, so the first painted
    // frame already has its background instead of fading one in a moment later.
    if (drawable[url] && drawable[url].width) { paint(drawable[url]); return; }
    var img = new Image();
    img.onload = function () {
      drawable[url] = img;
      drawableKeys.push(url);
      if (drawableKeys.length > 8) delete drawable[drawableKeys.shift()];
      paint(img);
    };
    img.src = url;
  }

  function renderClock() {
    var c = $('clock');
    // The clock shows only where the picks would be: with the picks up its text is
    // left alone, so an idle home has nothing to repaint every minute.
    if (!hasClass(body, 'no-picks')) return;
    var d = new Date();
    setText(c.firstChild, Data.time(d.getTime()));
    var date;
    try {
      date = d.toLocaleDateString(I18N.locale(), {weekday: 'long', day: 'numeric', month: 'long'});
    } catch (e) {
      date = d.toDateString();
    }
    setText(c.lastChild, date);
  }

  /** The picks or the clock, one or the other: the clock is filled the moment it shows. */
  function setNoPicks(on) {
    if (hasClass(body, 'no-picks') === on) return;
    setClass(body, 'no-picks', on);
    if (on) renderClock();
  }

  // MARK: - Shelf

  var shelfSig = '', shelfGen = 0;

  function renderShelf() {
    // Same apps as the ones already painted? Leave them alone: wiping and rebuilding
    // the tiles flashed the shelf every time the app came back to the foreground.
    var sig = '';
    for (var k = 0; k < shelf.length; k++) sig += shelf[k].id + '|';
    if (sig === shelfSig && $('tiles').children.length === shelf.length) return;
    // A logo not decoded yet would paint empty in the rebuilt tile: load them first
    // (they come from memory in every normal run, so this is synchronous).
    var urls = [], missing = false;
    for (var u = 0; u < shelf.length; u++) {
      if (shelf[u].icon) { urls.push(shelf[u].icon); if (preloaded[shelf[u].icon] === undefined) missing = true; }
    }
    if (!missing) { shelfSig = sig; drawShelf(); return; }
    var gen = ++shelfGen;
    preloadImages(urls, function () {
      if (gen !== shelfGen) return;
      shelfSig = sig;
      drawShelf();
    });
  }

  function drawShelf() {
    var n = shelf.length, gap = 48, pad = 40;
    // 16:9 tiles, as on Android: never taller than 126, and the glass keeps its bottom edge.
    var tw = Math.min(126 * 16 / 9, (1760 - Math.max(0, n - 1) * gap) / Math.max(1, n)), th = tw * 9 / 16;
    var width = n * tw + Math.max(0, n - 1) * gap, left = (1920 - width) / 2;
    var platter = $('platter');
    platter.style.display = n ? '' : 'none';
    platter.style.left = (left - pad) + 'px';
    platter.style.width = (width + 2 * pad) + 'px';
    platter.style.top = (814 + 126 - th) + 'px';
    platter.style.height = (th + 2 * pad) + 'px';
    $('quotes').style.right = (1920 - left - width) + 'px';
    var tiles = $('tiles');
    tiles.innerHTML = '';
    for (var i = 0; i < n; i++) {
      var t = el('div', 'tile', tiles);
      t.style.left = (left + i * (tw + gap)) + 'px';
      t.style.top = (854 + 126 - th) + 'px';
      t.style.width = tw + 'px';
      t.style.height = th + 'px';
      face(shelf[i], t, wordFit(shelf[i].title, tw, 30));
      hover(t, Z.SHELF, i);
    }
    st.shelf = Math.min(st.shelf, Math.max(0, n - 1));
  }

  // MARK: - Drawer

  var drawerItems = [], drawerInputs = 0, drawerSig = '';

  function renderDrawer() {
    var d = $('drawer');
    drawerItems = [];
    for (var i = 0; i < inputs.length; i++) {
      var x = inputs[i];
      drawerItems.push({label: x.label || tr('TV aberta', 'Live TV', 'TV en vivo'), symbol: x.symbol, off: !x.connected, run: launcher(x.id, x.label)});
    }
    drawerInputs = drawerItems.length;
    drawerItems.push({label: tr('Todos os Apps', 'All Apps', 'Todas las apps'), symbol: 'apps', run: openApps});
    drawerItems.push({label: tr('Ajustes do Início', 'Home Settings', 'Ajustes de inicio'), symbol: 'settings', run: openSettings});
    drawerItems.push({label: tr('Ajustes da TV', 'TV Settings', 'Ajustes del TV'), symbol: 'tv_settings', run: tvSettings});
    var n = drawerItems.length, gap = 18, groupGap = 56, groups = drawerInputs > 0 && drawerInputs < n ? 2 : 1;
    var tw = Math.min(230, (1760 - Math.max(0, n - groups) * gap - (groups - 1) * groupGap) / Math.max(1, n));
    // The keys are rebuilt only when what they show changed (the app was opened
    // again, an input came on): rebuilding them re-created their icon masks.
    var sig = I18N.lang + '|';
    for (var s = 0; s < n; s++) sig += drawerItems[s].label + ',' + drawerItems[s].symbol + ',' + (drawerItems[s].off ? 1 : 0) + '|';
    if (sig !== drawerSig) {
      drawerSig = sig;
      panelsSig = '';
      d.innerHTML = '';
      var xPos = 80;
      for (var k = 0; k < n; k++) {
        if (k === drawerInputs && k > 0) {
          xPos += groupGap - gap;
          el('div', 'row-title', d, tr('Atalhos', 'Shortcuts', 'Accesos directos')).style.left = (xPos + 4) + 'px';
        }
        if (k === 0 && drawerInputs) el('div', 'row-title', d, tr('Entradas', 'Inputs', 'Entradas')).style.left = '84px';
        var item = drawerItems[k], key = el('div', 'key glass' + (item.off ? ' off' : ''), d);
        key.style.left = xPos + 'px';
        key.style.width = tw + 'px';
        sym(item.symbol, key);
        el('div', 'label', key, item.label);
        hover(key, Z.DRAWER, k);
        xPos += tw + gap;
      }
    }
    renderPanels();
    updateFocus();
  }

  // The weather and the prices change every few minutes. The panels are built once
  // and after that only their text changes: rebuilding them took the glass, the
  // icons and every row out of the screen and put them back on each refresh.
  var panelsSig = '', panels = {weather: null, prices: null};

  function renderPanels() {
    var wx = Prefs.weather(), coins = Data.activeCoins(), qt = coins.length > 0;
    // The structure follows which panels show, which coins, and whether there is
    // weather data at all yet.
    var sig = (wx ? 'w' + (Data.weather ? 1 : 0) : '-') + '|' + (qt ? 'q' + coins.join(',') : '-');
    if (sig !== panelsSig) {
      panelsSig = sig;
      buildPanels(wx, qt, coins);
    }
    if (panels.weather) updateWeather(panels.weather);
    if (panels.prices) updatePrices(panels.prices, coins);
  }

  function buildPanels(wx, qt, coins) {
    var d = $('drawer');
    var old = d.querySelectorAll('.panel');
    for (var o = 0; o < old.length; o++) d.removeChild(old[o]);
    panels = {weather: null, prices: null};
    var split = 80 + 1760 * 0.585;
    if (wx) {
      var w = el('div', 'panel glass', d);
      w.id = 'weather';
      w.style.left = '80px';
      w.style.width = ((qt ? split - 16 : 1840) - 80) + 'px';
      panels.weather = buildWeather(w);
    }
    if (qt) {
      var q = el('div', 'panel glass', d);
      q.id = 'prices';
      var left = wx ? split + 16 : 80;
      q.style.left = left + 'px';
      q.style.width = (1840 - left) + 'px';
      panels.prices = buildPrices(q, coins);
    }
  }

  function buildWeather(card) {
    var box = {head: el('div', 'head', card), hours: [], sun: []};
    var w = Data.weather;
    if (!w) {
      el('div', 'cond', card, tr('Sem dados do clima agora.', 'No weather data right now.', 'No hay datos del clima ahora.')).style.top = '96px';
      return box;
    }
    var now = el('div', 'now', card);
    box.sym = sym(Data.symbol(w.code, w.isDay), now);
    box.temp = el('span', 'temp', now);
    box.cond = el('div', 'cond', card);
    box.range = el('div', 'range', card);
    el('div', 'split', card);
    var hours = el('div', 'hours', card), width = parseFloat(card.style.width) - 30 - 422, hw = width / 6;
    for (var i = 0; i < 6; i++) {
      var h = el('div', 'hour', hours);
      h.style.left = (hw * i) + 'px';
      h.style.width = hw + 'px';
      box.hours.push({row: h, t: el('div', 't', h), sym: sym('sunny', h), d: el('div', 'd', h)});
    }
    var sun = el('div', 'sun', card);
    for (var s = 0; s < 2; s++) {
      var span = el('span', '', sun), text = document.createTextNode('');
      span.appendChild(text);
      box.sun.push({row: span, sym: sym(s ? 'sunset' : 'sunrise', span), text: text});
    }
    return box;
  }

  function rangeText(w) {
    if (I18N.lang === 'ru') return 'Макс. ' + Data.degrees(w.max) + '   Мин. ' + Data.degrees(w.min);
    return tr('Máx. ' + Data.degrees(w.max) + '   Mín. ' + Data.degrees(w.min), 'H:' + Data.degrees(w.max) + '   L:' + Data.degrees(w.min),
      'Máx. ' + Data.degrees(w.max) + '   Mín. ' + Data.degrees(w.min));
  }

  function updateWeather(box) {
    setText(box.head, Data.city || tr('Clima', 'Weather', 'Clima'));
    var w = Data.weather;
    if (!w) return;
    setSym(box.sym, Data.symbol(w.code, w.isDay));
    setText(box.temp, Data.degrees(w.temp));
    setText(box.cond, Data.condition(w.code, w.isDay));
    setText(box.range, rangeText(w));
    var hours = w.hours || [];
    for (var i = 0; i < box.hours.length; i++) {
      var r = box.hours[i], x = hours[i];
      if (r.row.style.display !== (x ? '' : 'none')) r.row.style.display = x ? '' : 'none';
      if (!x) continue;
      setText(r.t, Data.hour(x.at));
      setSym(r.sym, Data.symbol(x.code, x.day));
      setText(r.d, Data.degrees(x.temp));
    }
    setText(box.sun[0].text, w.sunrise ? tr('Nascer ', 'Sunrise ', 'Amanecer ') + Data.time(w.sunrise) : '');
    if (box.sun[0].row.style.display !== (w.sunrise ? '' : 'none')) box.sun[0].row.style.display = w.sunrise ? '' : 'none';
    setText(box.sun[1].text, w.sunset ? tr('Pôr do sol ', 'Sunset ', 'Atardecer ') + Data.time(w.sunset) : '');
    if (box.sun[1].row.style.display !== (w.sunset ? '' : 'none')) box.sun[1].row.style.display = w.sunset ? '' : 'none';
  }

  function buildPrices(card, coins) {
    el('div', 'head', card, tr('Cotações', 'Crypto', 'Cripto'));   // never changes: built once
    var box = {side: el('div', 'side', card), rows: []};
    for (var j = 0; j < coins.length; j++) {
      var row = el('div', 'coin', card);
      row.style.top = (86 + 52 * j) + 'px';
      coin(coins[j], row);
      box.rows.push({n: el('span', 'n', row), p: el('span', 'p', row), c: el('span', 'c', row)});
    }
    return box;
  }

  function updatePrices(box, coins) {
    setText(box.side, Data.staleness(Data.pricesAt, 5 * 60000) || tr('variação em 24 h', '24h change', 'variación en 24 h'));
    for (var j = 0; j < coins.length; j++) {
      var i = coins[j], r = box.rows[j], ch = Data.changes[i], known = !isNaN(ch);
      setText(r.n, Data.coinName(i));
      setText(r.p, Data.money(Data.prices[i]));
      setText(r.c, known ? Data.change(ch) : '');
      setClass(r.c, 'up', known && ch >= 0);
      setClass(r.c, 'down', known && ch < 0);
    }
  }

  function openDrawer() {
    if (!drawerItems.length) return;
    var tiles = $('tiles').children;
    st.zone = Z.DRAWER;
    st.drawer = Math.min(drawerItems.length - 1, nearest(document.querySelectorAll('#drawer .key'), centerX(tiles[st.shelf])));
    updateFocus();
  }

  function closeDrawer() {
    var keys = document.querySelectorAll('#drawer .key');
    st.zone = Z.SHELF;
    if (shelf.length) st.shelf = nearest($('tiles').children, centerX(keys[st.drawer]));
    updateFocus();
  }

  // MARK: - All Apps

  var appsSig = '';

  function renderApps() {
    var sheet = $('apps');
    // The grid is kept between openings: rebuilding it re-created every icon and
    // label, which showed as a flash while the sheet was fading in.
    var sig = I18N.lang + '|';
    for (var a = 0; a < others.length; a++) sig += others[a].id + '|';
    if (sig === appsSig) return;
    appsSig = sig;
    sheet.firstChild.textContent = tr('Todos os Apps', 'All Apps', 'Todas las apps');
    var grid = sheet.lastChild;
    grid.innerHTML = '';
    for (var i = 0; i < others.length; i++) {
      var r = Math.floor(i / 5), c = i % 5, cell = el('div', 'cell', grid);
      cell.style.left = (130 + c * 340) + 'px';
      cell.style.top = (196 + r * 239) + 'px';
      face(others[i], el('div', 'face', cell), wordFit(others[i].title, 300, 34));
      el('div', 'label', cell, others[i].title);
      hover(cell, Z.APPS, i);
    }
  }

  function openApps() {
    renderApps();
    st.zone = Z.APPS;
    st.grid = 0;
    setClass($('apps'), 'open', true);
    updateFocus();
  }

  function closeSheets() {
    setClass($('apps'), 'open', false);
    setClass($('settings'), 'open', false);
    setClass($('shelfedit'), 'open', false);
    st.zone = Z.SHELF;
    updateFocus();
  }

  // MARK: - Home Settings

  function settingRows() {
    var lang = Prefs.language(), unit = Prefs.temperature(), theme = Prefs.theme();
    var auto = tr('Automático', 'Automatic', 'Automático'), on = tr('Ligado', 'On', 'Activado'), off = tr('Desligado', 'Off', 'Desactivado');
    var rows = [
      {label: tr('Idioma', 'Language', 'Idioma'), value: lang === 'ru' ? 'Русский' : lang === 'de' ? 'Deutsch' : lang === 'pt' ? 'Português' : lang === 'en' ? 'English' : lang === 'es' ? 'Español' : auto,
        step: function (d) { cycle('language', ['auto', 'de', 'en', 'es', 'pt', 'ru'], lang, d); I18N.set(Prefs.language()); renderAll(); }},
      {label: tr('Temperatura', 'Temperature', 'Temperatura'), value: unit === 'C' ? '°C' : unit === 'F' ? '°F' : auto,
        step: function (d) { cycle('temperature', ['auto', 'C', 'F'], unit, d); renderPanels(); }},
      {label: tr('Tema', 'Theme', 'Tema'), value: theme === 'light' ? tr('Claro', 'Light', 'Claro') : theme === 'dark' ? tr('Escuro', 'Dark', 'Oscuro') : auto,
        step: function (d) { cycle('theme', ['auto', 'light', 'dark'], theme, d); checkNight(); }},
      {label: tr('Widget do clima', 'Weather widget', 'Widget del clima'), toggle: Prefs.weather(),
        step: function () { Prefs.set('weather', !Prefs.weather()); renderPanels(); }},
      {label: tr('Widget de cotações', 'Quotes widget', 'Widget de cotizaciones'), toggle: Prefs.quotes(),
        step: function () { Prefs.set('quotes', !Prefs.quotes()); Data.settingsChanged(); }}
    ];
    var names = ['Bitcoin', 'Ethereum', 'Solana', tr('Dólar', 'Dollar', 'Dólar')];
    var count = Data.currency === 'BRL' ? 4 : 3;
    for (var i = 0; i < count; i++) {
      (function (i) {
        rows.push({label: names[i], toggle: Prefs.quotes() && Prefs.coin(i), dim: !Prefs.quotes(),
          step: function () { if (Prefs.quotes()) { Prefs.setCoin(i, !Prefs.coin(i)); Data.settingsChanged(); } }});
      })(i);
    }
    rows.push({label: tr('Prateleira', 'Shelf', 'Estante'), value: '›', step: function (d) { if (d >= 0) openShelfEdit(); }});
    rows.push({label: tr('Ajustes da TV', 'TV Settings', 'Ajustes del TV'), value: '›', step: function (d) { if (d >= 0) tvSettings(); }});
    return rows;
  }

  function cycle(name, values, current, d) {
    var i = values.indexOf(current);
    Prefs.set(name, values[(i + (d || 1) + values.length) % values.length]);
  }

  var rowsNow = [], settingsBuild = null;

  function renderSettings() {
    var box = $('settings').firstChild;
    var rows = settingRows();
    rowsNow = rows;
    // Built once, then only the labels, the values and the toggles change: wiping
    // and rebuilding the sheet re-created its title icon on every key press.
    if (!settingsBuild || settingsBuild.rows.length !== rows.length) buildSettings(box, rows);
    setText(settingsBuild.title, tr('Ajustes do Início', 'Home Settings', 'Ajustes de inicio'));
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], e = settingsBuild.rows[i];
      setText(e.label, r.label);
      setClass(e.row, 'dim', !!r.dim);
      if (e.toggle) setClass(e.toggle, 'on', !!r.toggle);
      else setText(e.vtext, r.value === undefined ? '' : String(r.value));
    }
    updateFocus();
  }

  function buildSettings(box, rows) {
    box.innerHTML = '';
    var title = el('div', 'title', box);
    sym('settings', title);
    var titleText = document.createTextNode('');
    title.appendChild(titleText);
    var list = el('div', 'list', box), holder = el('div', 'rows', list);
    list.style.height = Math.min(rows.length, 7) * 78 + 'px';
    var built = {title: titleText, rows: []};
    for (var i = 0; i < rows.length; i++) {
      var row = el('div', 'row', holder), entry = {row: row, vtext: null, toggle: null};
      entry.label = document.createTextNode('');
      row.appendChild(entry.label);
      if (rows[i].toggle !== undefined) entry.toggle = el('div', 'toggle', row);
      else {
        var value = el('span', 'value', row);
        entry.vtext = document.createTextNode('');
        if (rows[i].value === '›') { entry.vtext.textContent = '›'; value.appendChild(entry.vtext); }
        else {
          el('span', 'chev', value, '‹');
          value.appendChild(entry.vtext);
          el('span', 'chev', value, '›');
        }
      }
      hover(row, Z.SETTINGS, i);
      built.rows.push(entry);
    }
    el('div', 'hint', box, tr('OK ou as setas mudam o valor.', 'OK or the arrows change the value.', 'OK o las flechas cambian el valor.'));
    settingsBuild = built;
  }

  function openSettings() {
    st.zone = Z.SETTINGS;
    st.row = 0;
    renderSettings();
    setClass($('settings'), 'open', true);
    updateFocus();
  }

  // MARK: - Shelf editor: which apps, in what order

  function ordinal(n) {
    if (I18N.lang === 'ru') return n + '-е';
    if (I18N.lang === 'de') return n + '.';
    if (I18N.lang !== 'en') return n + 'º';
    var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function editList() {
    var ids = shelf.map(function (a) { return a.id; });
    return {ids: ids, rows: apps.slice().sort(function (a, b) {
      var ia = ids.indexOf(a.id), ib = ids.indexOf(b.id);
      if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      return a.title.toLowerCase() < b.title.toLowerCase() ? -1 : 1;
    })};
  }

  var editBuild = null;

  function renderShelfEdit() {
    var box = $('shelfedit').firstChild, e = editList();
    // Same in-place treatment as the settings sheet: the rows are built once.
    if (!editBuild || editBuild.rows.length !== e.rows.length) buildShelfEdit(box, e.rows);
    setText(editBuild.title, tr('Prateleira', 'Shelf', 'Estante'));
    for (var i = 0; i < e.rows.length; i++) {
      var a = e.rows[i], at = e.ids.indexOf(a.id), b = editBuild.rows[i];
      setText(b.label, a.title);
      setText(b.vtext, at >= 0 ? tr('Na prateleira · ', 'On · ', 'En el estante · ') + ordinal(at + 1) : tr('Fora', 'Off', 'Fuera'));
    }
    updateFocus();
  }

  function buildShelfEdit(box, rows) {
    box.innerHTML = '';
    var title = el('div', 'title', box);
    sym('apps', title);
    var titleText = document.createTextNode('');
    title.appendChild(titleText);
    var list = el('div', 'list', box), holder = el('div', 'rows', list);
    list.style.height = Math.min(rows.length, 7) * 78 + 'px';
    var built = {title: titleText, rows: []};
    for (var i = 0; i < rows.length; i++) {
      var row = el('div', 'row', holder);
      var label = document.createTextNode('');
      row.appendChild(label);
      var value = el('span', 'value', row);
      var vtext = document.createTextNode('');
      value.appendChild(vtext);
      hover(row, Z.EDIT, i);
      built.rows.push({label: label, vtext: vtext});
    }
    el('div', 'hint', box, tr('OK põe ou tira · ← → mudam a ordem', 'OK adds or removes · ← → change the order', 'OK pone o quita · ← → cambian el orden'));
    editBuild = built;
  }

  function openShelfEdit() {
    setClass($('settings'), 'open', false);
    st.zone = Z.EDIT;
    st.edit = 0;
    renderShelfEdit();
    setClass($('shelfedit'), 'open', true);
    updateFocus();
  }

  function editShelf(dx) {
    var e = editList(), app = e.rows[st.edit];
    if (!app) return;
    var ids = e.ids.slice(), at = ids.indexOf(app.id);
    if (dx === 0) {
      if (at >= 0) ids.splice(at, 1);
      else if (ids.length < MAX_SHELF) ids.push(app.id);
      else { toast(tr('A prateleira cabe até ' + MAX_SHELF + ' apps.', 'The shelf holds up to ' + MAX_SHELF + ' apps.', 'El estante tiene hasta ' + MAX_SHELF + ' apps.')); return; }
    } else {
      if (at < 0) return;
      var to = Math.max(0, Math.min(ids.length - 1, at + dx));
      ids.splice(at, 1);
      ids.splice(to, 0, app.id);
    }
    Prefs.set('shelf', ids);
    pickShelf();
    renderShelf();
    var again = editList();
    for (var i = 0; i < again.rows.length; i++) if (again.rows[i].id === app.id) st.edit = i;
    renderShelfEdit();
  }

  // MARK: - Opening things

  function launcher(id, name) {
    return function () {
      TV.launch(id, null, function (ok) {
        if (!ok) toast(tr('Não deu para abrir ', "Couldn't open ", 'No se pudo abrir ') + (name || id));
      });
    };
  }

  function tvSettings() {
    TV.settings(function (ok) {
      if (!ok) toast(tr('Não deu para abrir os Ajustes da TV', "Couldn't open TV Settings", 'No se pudieron abrir los Ajustes del TV'));
    });
  }

  function liveTV() {
    for (var i = 0; i < inputs.length; i++) if (inputs[i].key === 'live') return inputs[i];
    return null;
  }

  function activate() {
    switch (st.zone) {
      case Z.TOP:
        if (st.top < 3) return;
        if (st.top === 3) { var live = liveTV(); if (live) launcher(live.id, tr('TV aberta', 'Live TV', 'TV en vivo'))(); }
        else if (st.top === 4) { st.zone = Z.SHELF; openDrawer(); st.drawer = 1 < drawerInputs ? 1 : 0; updateFocus(); }
        else openSettings();
        return;
      case Z.CARDS:
        var p = cards[st.card], app = p && Data.appFor(p.app);
        if (app) launcher(app.id, app.title)();
        return;
      case Z.SHELF:
        if (shelf[st.shelf]) launcher(shelf[st.shelf].id, shelf[st.shelf].title)();
        return;
      case Z.DRAWER:
        if (drawerItems[st.drawer]) drawerItems[st.drawer].run();
        return;
      case Z.APPS:
        if (others[st.grid]) launcher(others[st.grid].id, others[st.grid].title)();
        return;
      case Z.SETTINGS:
        if (rowsNow[st.row]) { rowsNow[st.row].step(1); if (st.zone === Z.SETTINGS) renderSettings(); }
        return;
      case Z.EDIT:
        editShelf(0);
        return;
    }
  }

  function selectTab(i) {
    if (i === st.tab) return;
    st.tab = i;
    renderCards();
  }

  function move(dx, dy) {
    var tiles = $('tiles').children, cardNodes = $('cards').children;
    switch (st.zone) {
      case Z.SHELF:
        if (dx) st.shelf = Math.max(0, Math.min(shelf.length - 1, st.shelf + dx));
        else if (dy > 0) { openDrawer(); return; }
        else if (dy < 0) {
          if (cards.length) { st.zone = Z.CARDS; st.card = nearest(cardNodes, centerX(tiles[st.shelf])); }
          else { st.zone = Z.TOP; st.top = st.tab; }
        }
        break;
      case Z.CARDS:
        if (dx) st.card = Math.max(0, Math.min(cards.length - 1, st.card + dx));
        else if (dy < 0) { st.zone = Z.TOP; st.top = st.tab; }
        else if (shelf.length) { st.zone = Z.SHELF; st.shelf = nearest(tiles, centerX(cardNodes[st.card])); }
        break;
      case Z.TOP:
        if (dx) {
          st.top = Math.max(0, Math.min(5, st.top + dx));
          if (st.top < 3) selectTab(st.top);   // as on Apple TV: focusing a tab selects it
        } else if (dy > 0) {
          if (cards.length) { st.zone = Z.CARDS; st.card = Math.min(cards.length - 1, st.top < 3 ? 0 : cards.length - 1); }
          else st.zone = Z.SHELF;
        }
        break;
      case Z.DRAWER:
        if (dx) st.drawer = Math.max(0, Math.min(drawerItems.length - 1, st.drawer + dx));
        else if (dy < 0) { closeDrawer(); return; }
        break;
      case Z.APPS:
        var g = st.grid + dx + dy * 5;
        if (g >= 0 && g < others.length && (dx === 0 || Math.floor(g / 5) === Math.floor(st.grid / 5))) st.grid = g;
        break;
      case Z.SETTINGS:
        if (dy) st.row = Math.max(0, Math.min(rowsNow.length - 1, st.row + dy));
        else if (dx && rowsNow[st.row]) {
          var r = rowsNow[st.row];
          if (r.value !== '›') { r.step(dx); renderSettings(); }
        }
        break;
      case Z.EDIT:
        if (dy) st.edit = Math.max(0, Math.min(apps.length - 1, st.edit + dy));
        else if (dx) editShelf(dx);
        break;
    }
    updateFocus();
  }

  function back() {
    if (st.zone === Z.EDIT) { setClass($('shelfedit'), 'open', false); openSettings(); st.row = rowsNow.length - 2; updateFocus(); return; }
    if (sheetOpen()) { closeSheets(); return; }
    if (st.zone === Z.DRAWER) { closeDrawer(); return; }
    if (st.zone !== Z.SHELF && shelf.length) { st.zone = Z.SHELF; updateFocus(); return; }
    TV.back();
  }

  /** The pointer focuses what it's over (the Magic Remote, or a mouse when previewing). */
  function hover(node, zone, index) {
    node.onmouseover = function () {
      if (saverOn || (sheetOpen() !== (zone === Z.APPS || zone === Z.SETTINGS || zone === Z.EDIT))) return;
      if (zone === Z.DRAWER && st.zone !== Z.DRAWER) return;
      if (zone !== Z.DRAWER && st.zone === Z.DRAWER && zone !== Z.SHELF) return;
      if (zone === Z.SHELF && st.zone === Z.DRAWER) closeDrawer();
      st.zone = zone;
      if (zone === Z.TOP) { st.top = index; if (index < 3) selectTab(index); }
      else if (zone === Z.CARDS) st.card = index;
      else if (zone === Z.SHELF) st.shelf = index;
      else if (zone === Z.DRAWER) st.drawer = index;
      else if (zone === Z.APPS) st.grid = index;
      else if (zone === Z.SETTINGS) st.row = index;
      else if (zone === Z.EDIT) st.edit = index;
      updateFocus();
    };
    node.onclick = function () { node.onmouseover(); activate(); };
  }

  // MARK: - Toast

  var toastTimer = 0;
  function toast(text) {
    var t = $('toast');
    t.textContent = text;
    setClass(t, 'on', true);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { setClass(t, 'on', false); }, 6000);
  }

  // MARK: - Night, clock, screensaver

  function checkNight() {
    var night = Data.isNight(Date.now());
    setClass(body, 'night', night);
    // The page behind the stage (seen for the moment between load and the reveal)
    // follows the same theme: the light background was the first white flash.
    setClass(document.documentElement, 'night', night);
  }

  var saverOn = false, idleAt = Date.now(), saverIndex = 0, saverTimer = 0, SAVER_AFTER = 5 * 60000;

  function showSaver() {
    var photos = Data.showcase().filter(function (p) { return p.backdrop && Data.appFor(p.app); });
    saverOn = true;
    var s = $('saver');
    s.innerHTML = '';
    var a = el('div', 'photo', s), b = el('div', 'photo', s);
    el('div', 'shade', s);
    var clock = el('div', 'clock', s);
    el('div', 'time', clock);
    el('div', 'date', clock);
    el('div', 'title', clock);
    var front = a;
    function next() {
      if (!saverOn) return;
      var p = photos.length ? photos[saverIndex++ % photos.length] : null;
      var back = front === a ? b : a;
      tickSaverClock(clock);
      if (p) {
        // w1280 instead of the original file: on a 1080p panel the original is
        // several MB and took seconds to decode, holding the whole layer empty.
        var url = Data.image(p.backdrop, 'w1280');
        preloadImages([url], function () {
          if (!saverOn || front === back) return;
          back.style.backgroundImage = 'url(' + url + ')';
          clock.lastChild.textContent = p.title;
          // One frame with the photo in place before the crossfade starts, so the
          // fade never runs against an empty layer.
          afterPaint(function () {
            if (!saverOn || front === back) return;
            var previous = front;
            setClass(back, 'on', true);                  // new photo fades in on top
            front = back;
            // The old one is only hidden once the new one is fully opaque: fading
            // both at once made the screen visibly darker in the middle.
            setTimeout(function () {
              if (back === front) setClass(previous, 'on', false);
            }, 1600);
          });
        }, 8000);
      }
      saverTimer = setTimeout(next, 12000);
    }
    // The saver is revealed only once its first photo is decoded; shown before,
    // the layer was empty and the TV stayed black while the file downloaded.
    preloadImages(photos.length ? [Data.image(photos[0].backdrop, 'w1280')] : [], function () {
      if (!saverOn) return;
      setClass(s, 'on', true);
      next();
    }, 6000);
  }

  function tickSaverClock(clock) {
    var d = new Date();
    setText(clock.firstChild, Data.time(d.getTime()).replace(/ (AM|PM)$/, ''));
    var date;
    try {
      date = d.toLocaleDateString(I18N.locale(), {weekday: 'long', day: 'numeric', month: 'long'});
    } catch (e) {
      date = d.toDateString();
    }
    setText(clock.children[1], date);
  }

  function hideSaver() {
    saverOn = false;
    clearTimeout(saverTimer);
    setClass($('saver'), 'on', false);
  }

  function poke() {
    idleAt = Date.now();
    if (saverOn) { hideSaver(); return true; }
    return false;
  }

  // MARK: - Keys

  document.addEventListener('keydown', function (e) {
    var k = e.keyCode;
    if (poke()) { e.preventDefault(); return; }   // the first press only wakes the screen
    if (k === TV.keys.left) move(-1, 0);
    else if (k === TV.keys.right) move(1, 0);
    else if (k === TV.keys.up) move(0, -1);
    else if (k === TV.keys.down) move(0, 1);
    else if (k === TV.keys.ok) activate();
    else if (k === TV.keys.back || k === 27 || k === 8) back();
    else return;
    e.preventDefault();
  });
  document.addEventListener('mousemove', function () { poke(); });

  // MARK: - Start

  var revealed = false;

  // The home is revealed whole: the shelf painted, and the picks either painted or
  // known to be none. Revealing as soon as the shelf was up showed the picks a
  // moment later — the staged appearance that reads as a flash on a TV.
  function revealWhenPainted() {
    if (revealed) return;
    var tiles = $('tiles');
    if (!tiles || !tiles.children.length) return;
    if (!hasClass(body, 'cards-ready') && !hasClass(body, 'no-picks')) return;
    markReady();
  }

  function markReady() {
    if (revealed) return;
    revealed = true;
    setClass(body, 'ready', true);
    // One more painted frame, and the transitions are back for the rest of the run.
    afterPaint(function () { setClass(body, 'no-anim', false); });
  }

  // Developer Mode reminder. LG's session lasts 1000 hours; this TV's token file
  // (/var/luna/preferences/devmode_enabled) was written on 2026-10-22 17:05, so
  // the estimate is that moment plus 1000 hours. After pressing EXTEND in the
  // Developer Mode app, rebuild with the new date.
  var DEVMODE_EXPIRES = new Date('2026-12-03T09:05:00-03:00');

  function renderDevMode() {
    var box = $('devmode');
    if (!box) return;
    var left = DEVMODE_EXPIRES.getTime() - Date.now();
    var days = Math.ceil(left / 86400000);
    // Hidden while there is time: the pill only appears when the session is
    // close to expiring (15 days), and turns red in the last five.
    var text = '';
    var warn = false, crit = false;
    if (left <= 0) {
      text = 'Developer Mode expirou — reative no app Developer Mode';
      crit = true;
    } else if (days <= 5) {
      text = 'Developer Mode expira em ' + days + (days === 1 ? ' dia' : ' dias') + ' — renove agora';
      crit = true;
    } else if (days <= 15) {
      text = 'Developer Mode expira em ' + days + ' dias';
      warn = true;
    }
    setText(box, text);   // the pill is redrawn only when its days change
    setClass(box, 'on', !!text);
    setClass(box, 'warn', warn);
    setClass(box, 'crit', crit);
  }

  function renderAll() {
    renderTop();
    renderQuotes();
    cards = [];
    renderCards();
    renderShelf();
    renderDrawer();
    renderClock();
    checkNight();
    if (st.zone === Z.SETTINGS) renderSettings();
    updateFocus();
    revealWhenPainted();
    renderDevMode();
  }

  function loadApps(done) {
    TV.apps(function (list) {
      apps = list;
      Data.setApps(apps);
      pickShelf();
      TV.inputs(function (list2) {
        inputs = list2;
        if (done) done();
      });
    });
  }

  /** Back to the home screen (the app was opened again): the shelf, everything closed, the first tab. */
  function reset() {
    hideSaver();
    closeSheets();
    st.zone = Z.SHELF;
    st.shelf = 0;
    if (st.tab !== 0) { st.tab = 0; renderCards(); }
    updateFocus();
  }

  Data.onChange(function () {
    renderQuotes();
    renderCards();
    renderPanels();
    checkNight();
    revealWhenPainted();
  });

  // Safety net: never leave the screen hidden if the data never arrives.
  setTimeout(markReady, 2500);

  function reopened() {
    // LG: with handlesRelaunch the app has to come to the front itself, or opening it again while it runs shows nothing.
    if (window.PalmSystem && window.PalmSystem.activate) window.PalmSystem.activate();
    reset();
    loadApps(function () { renderShelf(); renderDrawer(); Data.refresh(); });
  }

  window.addEventListener('resize', fit);
  document.addEventListener('webOSRelaunch', reopened);   // LG: opened again while running
  window.addEventListener('appcontrol', reopened);        // Samsung: the same
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { hideSaver(); return; }
    idleAt = Date.now();
    loadApps(function () { renderShelf(); renderDrawer(); updateFocus(); Data.refresh(); });
  });

  I18N.set(Prefs.language());
  fit();
  // Day or night right away: the home is still invisible, and the page behind it
  // must already be the right colour (a night start used to flash the light one).
  checkNight();
  renderTop();
  loadApps(function () {
    // Icons are file:// files and the symbols are mask images: both still paint a
    // frame after their decode. Loading them first keeps every tile and button
    // complete on the very first painted frame.
    preloadImages(iconUrls().concat(symbolUrls()), function () {
      renderAll();
      Data.refresh();
    }, 2000);
  });
  setInterval(function () {
    renderClock();
    checkNight();
    renderDevMode();
    Data.refresh();
    if (!saverOn && !sheetOpen() && Date.now() - idleAt > SAVER_AFTER) showSaver();
    if (saverOn) tickSaverClock($('saver').querySelector('.clock'));
  }, 30000);

  // For the browser preview and tests.
  window.FreeMyTV = {state: st, move: move, activate: activate, back: back, showSaver: showSaver, hideSaver: hideSaver, toast: toast};
})();
