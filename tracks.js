// ── Billboard-based Track Source ─────────────────────────────────────

let billboardData = null;
const DECADES = [1970, 1980, 1990, 2000, 2010, 2020];

// ── Load billboard.json ─────────────────────────────────────────────

async function loadBillboard() {
  if (billboardData) return billboardData;
  const resp = await fetch('billboard.json');
  billboardData = await resp.json();
  return billboardData;
}

// ── Report wrong songs (Google Form submission) ────────────────────

// Replace these with your Google Form values
const REPORT_FORM_ID = '1FAIpQLSceBOulnR21w1JR_Ynj2rrE87IbxZYjwECL3lbQ7nl8BeyS7g';
const REPORT_FIELD_TITLE = 'entry.295455205';
const REPORT_FIELD_ARTIST = 'entry.1152023199';
const REPORT_FIELD_YEAR = 'entry.40724187';

let reportsThisSession = 0;
const MAX_REPORTS_PER_SESSION = 5;

function reportSong(artist, title, year, auto = false) {
  if (!auto && reportsThisSession >= MAX_REPORTS_PER_SESSION) return false;
  if (!auto) reportsThisSession++;

  // Submit to Google Form (fire-and-forget, no-cors)
  if (REPORT_FORM_ID !== 'YOUR_FORM_ID_HERE') {
    const url = `https://docs.google.com/forms/d/e/${REPORT_FORM_ID}/formResponse`;
    const body = new URLSearchParams({
      [REPORT_FIELD_TITLE]: title,
      [REPORT_FIELD_ARTIST]: artist,
      [REPORT_FIELD_YEAR]: String(year || ''),
    });
    fetch(url, { method: 'POST', body, mode: 'no-cors' }).catch(() => {});
  }

  return true;
}

function canReport() {
  return reportsThisSession < MAX_REPORTS_PER_SESSION;
}

// ── Search Cache (localStorage) ─────────────────────────────────────

const SEARCH_CACHE_KEY = 'mph_search_cache';

function getSearchCache() {
  try { return JSON.parse(localStorage.getItem(SEARCH_CACHE_KEY) || '{}'); } catch (e) { return {}; }
}

function setSearchCache(cache) {
  try { localStorage.setItem(SEARCH_CACHE_KEY, JSON.stringify(cache)); } catch (e) {}
}

// ── Search Spotify for a specific song ──────────────────────────────

async function searchSpotifyTrack(artist, title, billboardYear) {
  const cacheKey = `${artist}|||${title}`;
  const cache = getSearchCache();

  // Return cached result if available (null means "not found" is also cached)
  if (cacheKey in cache) {
    return cache[cacheKey];
  }

  const token = await getValidToken();
  const q = `track:${title} artist:${artist}`;
  const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=track&limit=1`;
  const resp = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });

  if (resp.status === 429) {
    rateLimitHit = true;
    throw new Error('Spotify rate limit reached — wait a few minutes and try again');
  }

  if (!resp.ok) return null; // Don't cache errors — retry next time

  const data = await resp.json();
  const t = data.tracks?.items?.[0];
  if (!t) {
    reportSong(artist, title + ' [NOT FOUND ON SPOTIFY]', billboardYear, true);
    cache[cacheKey] = null;
    setSearchCache(cache);
    return null;
  }

  const result = {
    uri: t.uri,
    title: cleanTitle(t.name),
    artist: (t.artists || []).map(a => a.name).join(', '),
    albumArt: t.album?.images?.[0]?.url || null,
    year: billboardYear || parseInt(t.album?.release_date?.substring(0, 4), 10) || 0,
    originalTitle: title,
    originalArtist: artist,
  };

  cache[cacheKey] = result;
  setSearchCache(cache);
  return result;
}

function cleanTitle(title) {
  return title
    .replace(/\s*[-–—]\s*(Original Version|Remaster(ed)?(\s+\d{4})?|Single Version|Album Version|Radio Edit|Mono|Stereo|Deluxe|Bonus Track|Re-?recorded|Live|Edit|Mix)\s*/gi, '')
    .replace(/\s*\((Original Version|Remaster(ed)?(\s+\d{4})?|Single Version|Album Version|Radio Edit|Mono|Stereo|Deluxe|Bonus Track|Re-?recorded|From .+)\)\s*/gi, '')
    .replace(/\s*\[(Original Version|Remaster(ed)?(\s+\d{4})?|Single Version|Album Version|Radio Edit)\]\s*/gi, '')
    .trim();
}

// ── Parallel batch search ───────────────────────────────────────────

async function searchBatch(songs, onProgress) {
  const BATCH_SIZE = 10;
  const results = [];

  for (let i = 0; i < songs.length; i += BATCH_SIZE) {
    if (onProgress) onProgress(i, songs.length);
    const batch = songs.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(s => searchSpotifyTrack(s.artist, s.title, s.billboardYear))
    );
    results.push(...batchResults);
  }

  return results.filter(r => r !== null);
}

// ── Pick random songs from billboard data ───────────────────────────

function pickSongsFromBillboard(data, decade, count) {
  const startYear = decade;
  const endYear = decade + 9;
  const pool = [];

  for (let y = startYear; y <= endYear; y++) {
    for (const s of (data[y] || [])) {
      pool.push({ ...s, billboardYear: y });
    }
  }

  return shuffleTracks(pool).slice(0, count);
}

// ── Build playlists from billboard data ─────────────────────────────

let rateLimitHit = false;

async function searchDecadeUntilFull(songs, needed, onProgress, progressOffset) {
  const found = [];

  for (let i = 0; i < songs.length && found.length < needed; i++) {
    if (rateLimitHit) break;
    if (onProgress) onProgress(progressOffset + found.length);
    const s = songs[i];
    const r = await searchSpotifyTrack(s.artist, s.title, s.billboardYear);
    if (r) found.push(r);
  }

  return found;
}

async function buildBillboardShufflePlaylist(onProgress) {
  rateLimitHit = false;
  const data = await loadBillboard();
  const result = [];

  for (let i = 0; i < DECADES.length; i++) {
    const decade = DECADES[i];
    onProgress?.(`Searching ${decade}s...`);
    // Pick a large pool, search until we have 10
    const pool = pickSongsFromBillboard(data, decade, 30);
    const found = await searchDecadeUntilFull(pool, 10, null, 0);
    result.push(...found);
  }

  return shuffleTracks(result);
}

async function buildBillboardDecadePlaylist(onProgress) {
  rateLimitHit = false;
  const data = await loadBillboard();
  const result = [];

  for (let i = 0; i < DECADES.length; i++) {
    const decade = DECADES[i];
    onProgress?.(`Searching ${decade}s...`);
    // Pick a large pool, search until we have 10
    const pool = pickSongsFromBillboard(data, decade, 30);
    const found = await searchDecadeUntilFull(pool, 10, null, 0);
    result.push(...found);
  }

  return result;
}

// ── Fetch playlist tracks (for My Playlist mode) ────────────────────

async function fetchPlaylistTracks(playlistId) {
  const tracks = [];

  const token = await getValidToken();
  const resp = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });

  if (!resp.ok) {
    const body = await resp.text();
    let parsed;
    try { parsed = JSON.parse(body); } catch (e) {}
    const detail = parsed?.error?.message || `HTTP ${resp.status}`;
    throw new Error(`Spotify: ${detail}`);
  }

  const playlist = await resp.json();
  const tracksObj = playlist.tracks || playlist.items;

  parseTrackItems(tracksObj?.items, tracks);

  let nextUrl = tracksObj?.next || null;
  while (nextUrl) {
    const t = await getValidToken();
    const pageResp = await fetch(nextUrl, {
      headers: { 'Authorization': `Bearer ${t}` },
    });
    if (!pageResp.ok) break;
    const page = await pageResp.json();
    parseTrackItems(page.items, tracks);
    nextUrl = page.next || null;
  }

  return tracks;
}

function parseTrackItems(items, tracks) {
  for (const item of (items || [])) {
    const t = item?.track || item?.item;
    if (!t || !t.uri || !t.name || t.uri.startsWith('spotify:local:')) continue;

    const year = parseInt(t.album?.release_date?.substring(0, 4), 10) || 0;
    tracks.push({
      uri: t.uri,
      title: t.name,
      artist: (t.artists || []).map(a => a.name).join(', '),
      albumArt: t.album?.images?.[0]?.url || null,
      year,
    });
  }
}

// ── Fetch user playlists ────────────────────────────────────────────

async function fetchUserPlaylists() {
  const playlists = [];
  let url = 'https://api.spotify.com/v1/me/playlists?limit=50';

  while (url) {
    const token = await getValidToken();
    const resp = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (resp.status === 403) {
      throw new Error('SCOPE_MISSING');
    }
    if (!resp.ok) break;
    const data = await resp.json();

    for (const p of (data.items || [])) {
      if (!p) continue;
      playlists.push({
        id: p.id,
        name: p.name,
        image: p.images?.[0]?.url || null,
        trackCount: p.items?.total || p.tracks?.total || 0,
        owner: p.owner?.display_name || '',
      });
    }
    url = data.next || null;
  }
  return playlists;
}

// ── Fisher-Yates shuffle ────────────────────────────────────────────

function shuffleTracks(arr) {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}
