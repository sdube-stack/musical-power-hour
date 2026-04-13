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

// ── Reported songs (persisted in localStorage) ──────────────────────

function getReportedSongs() {
  try {
    return JSON.parse(localStorage.getItem('reported_songs') || '[]');
  } catch { return []; }
}

function reportSong(artist, title) {
  const reported = getReportedSongs();
  const key = `${artist}|||${title}`.toLowerCase();
  if (!reported.includes(key)) {
    reported.push(key);
    localStorage.setItem('reported_songs', JSON.stringify(reported));
  }
}

function isSongReported(artist, title) {
  const reported = getReportedSongs();
  return reported.includes(`${artist}|||${title}`.toLowerCase());
}

// ── Search Spotify for a specific song ──────────────────────────────

async function searchSpotifyTrack(artist, title) {
  const token = await getValidToken();
  const q = `track:${title} artist:${artist}`;
  const resp = await fetch(
    `https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=track&limit=1`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  if (!resp.ok) return null;
  const data = await resp.json();
  const t = data.tracks?.items?.[0];
  if (!t) return null;

  return {
    uri: t.uri,
    title: t.name,
    artist: (t.artists || []).map(a => a.name).join(', '),
    year: parseInt(t.album?.release_date?.substring(0, 4), 10) || 0,
    originalTitle: title,
    originalArtist: artist,
  };
}

// ── Parallel batch search ───────────────────────────────────────────

async function searchBatch(songs, onProgress) {
  const BATCH_SIZE = 10;
  const results = [];

  for (let i = 0; i < songs.length; i += BATCH_SIZE) {
    if (onProgress) onProgress(i, songs.length);
    const batch = songs.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(s => searchSpotifyTrack(s.artist, s.title))
    );
    results.push(...batchResults);
  }

  return results.filter(r => r !== null);
}

// ── Pick random songs from billboard data ───────────────────────────

function pickSongsFromBillboard(data, decade, count) {
  const reported = getReportedSongs();
  const startYear = decade;
  const endYear = decade + 9;
  const pool = [];

  for (let y = startYear; y <= endYear; y++) {
    const yearSongs = data[y] || [];
    for (const s of yearSongs) {
      const key = `${s.artist}|||${s.title}`.toLowerCase();
      if (!reported.includes(key)) {
        pool.push(s);
      }
    }
  }

  return shuffleTracks(pool).slice(0, count);
}

// ── Build playlists from billboard data ─────────────────────────────

async function buildBillboardShufflePlaylist(onProgress) {
  const data = await loadBillboard();
  const allSongs = [];

  for (const decade of DECADES) {
    allSongs.push(...pickSongsFromBillboard(data, decade, 20));
  }

  const picked = shuffleTracks(allSongs).slice(0, 60);
  onProgress?.('Searching Spotify...');
  return await searchBatch(picked, (i, total) => {
    onProgress?.(`Searching Spotify... (${i}/${total})`);
  });
}

async function buildBillboardDecadePlaylist(onProgress) {
  const data = await loadBillboard();
  const allPicked = [];

  for (const decade of DECADES) {
    allPicked.push(...pickSongsFromBillboard(data, decade, 10));
  }

  onProgress?.('Searching Spotify...');
  return await searchBatch(allPicked, (i, total) => {
    onProgress?.(`Searching Spotify... (${i}/${total})`);
  });
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
