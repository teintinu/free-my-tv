/*
 * The apps' faces: one brand per row, matched by the TV's app id or by the name it shows.
 *
 * LG's Developer Mode gives an app no icon (listLaunchPoints is denied to it, and the ids that
 * `getAppLoadStatus` answers carry no artwork), so the home draws the tiles itself: a brand colour and
 * its white mark, or the official wordmark where the mark is the name (Netflix, YouTube, Prime Video,
 * Disney+, Max, Apple TV, Globoplay, Pluto TV…). Those wordmarks already say the name, so the tile
 * shows no label for them; the ones that are just a symbol keep the name under it.
 *
 * `label` rows are the ones whose art is a symbol rather than a name (LG's own apps, Twitch) or that have no
 * art at all (Hulu, Peacock, NFL): the tile draws the name itself at the bottom, translated with the rest of the
 * home, and the mark sits high with room for it. Every app also gets a short animation that plays only
 * while its tile has the focus (tools/make_tiles.py builds web/icons/tile-<slug>.gif from this same
 * table, with the same CSS the home uses — so what the generator draws is what the TV shows).
 * Plain ES5: old webOS runs Chromium 53.
 */
var BRANDS = [
  ['netflix', /^netflix$/, /^netflix$/i, '#0B0B0B', 'icons/logo-netflix-word.svg'],
  ['youtube', /youtube/, /^youtube$/i, '#FFFFFF', 'icons/logo-youtube-word.svg'],
  ['prime', /^amazon$/, /prime video|amazon/i, '#1399E0', 'icons/logo-prime.png'],
  ['disney', /disney/, /disney/i, '#0C1A45', 'icons/logo-disney.svg'],
  ['max', /hbo|wbd/, /^(hbo )?max$|hbo max/i, '#4322A8', 'icons/logo-hbomax.svg'],
  ['appletv', /appletv|apple\.tv/, /apple tv/i, '#000000', 'icons/logo-appletv.svg'],
  ['globoplay', /globoplay/, /globoplay/i, '#FF4A16', 'icons/logo-globoplay.svg'],
  ['pluto', /pluto/, /pluto/i, '#000000', 'icons/logo-pluto.svg'],
  ['hotmart', /hotmart/, /hotmart/i, '#FFFFFF', 'icons/logo-hotmart.svg'],
  ['spotify', /spotify/, /spotify/i, '#1DB954', 'icons/logo-spotify.svg'],
  ['crunchyroll', /crunchyroll/, /crunchyroll/i, '#F47521', 'icons/logo-crunchyroll.svg'],
  ['paramount', /paramount|cbs/, /paramount/i, '#0064FF', 'icons/logo-paramountplus.svg'],
  ['plex', /cdp-30/, /plex/i, '#141414', 'icons/logo-plex.svg'],
  ['deezer', /deezer/, /deezer/i, '#A238FF', 'icons/logo-deezer.svg'],
  ['hulu', /^hulu/, /hulu/i, '#0A0A0A', '', 'label'],
  ['peacock', /peacock/, /peacock/i, '#0A0A0A', '', 'label'],
  ['nfl', /nfl/, /^nfl/i, '#013369', '', 'label'],
  ['twitch', /twitch/, /twitch/i, '#9146FF', 'icons/logo-twitch.svg', 'label'],
  ['discovery', /discovery/, /lg channels/i, '#2C2C30', 'symbols/live_tv.png', 'label'],
  ['music', /app\.music$/, /music/i, '#2C2C30', 'icons/logo-music.svg', 'label'],
  ['photos', /photovideo/, /photo/i, '#2C2C30', 'icons/logo-photos.svg', 'label'],
  ['settings', /settings$/, /settings/i, '#2C2C30', 'symbols/settings.png', 'label'],
  ['browser', /browser/, /browser/i, '#2C2C30', 'icons/logo-globe.svg', 'label']
];

/** The row for an app on the TV, or null (a name and a colour are drawn for it instead). */
function brandFor(app) {
  for (var i = 0; i < BRANDS.length; i++) {
    if (BRANDS[i][1].test(app.id) || (app.title && BRANDS[i][2].test(app.title))) return BRANDS[i];
  }
  return null;
}

if (typeof module !== 'undefined' && module.exports) module.exports = {BRANDS: BRANDS, brandFor: brandFor};
