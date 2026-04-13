// ── Spotify Playlist-Based Track Source ──────────────────────────────

// Decade search queries — used to find Spotify's official playlists
const DECADE_SEARCHES = {
  1970: 'All Out 70s',
  1980: 'All Out 80s',
  1990: 'All Out 90s',
  2000: 'All Out 00s',
  2010: 'All Out 10s',
  2020: 'All Out 2020s',
};

// Cache resolved playlist IDs so we only search once per session
const resolvedDecadeIds = {};

// ── Fetch tracks from a Spotify playlist ────────────────────────────

async function fetchPlaylistTracks(playlistId) {
  const tracks = [];

  // Fetch the full playlist object (includes first page of tracks)
  const token = await getValidToken();
  const resp = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });

  if (!resp.ok) {
    const body = await resp.text();
    console.error(`Playlist fetch failed (${resp.status}):`, body);
    let parsed;
    try { parsed = JSON.parse(body); } catch (e) {}
    const detail = parsed?.error?.message || `HTTP ${resp.status}`;
    throw new Error(`Spotify: ${detail}`);
  }

  const playlist = await resp.json();
  const tracksObj = playlist.tracks || playlist.items;

  // Parse first page
  parseTrackItems(tracksObj?.items, tracks);

  // Paginate if more tracks exist
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

// ── Search for a Spotify playlist by name ───────────────────────────

async function searchForPlaylist(query) {
  if (resolvedDecadeIds[query]) return resolvedDecadeIds[query];

  const token = await getValidToken();
  const resp = await fetch(
    `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=playlist&limit=5`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );

  if (!resp.ok) return null;
  const data = await resp.json();

  // Prefer Spotify's own playlists (owner "Spotify" or id "spotify")
  const playlists = data.playlists?.items || [];
  const match = playlists.find(p =>
    p.owner?.id === 'spotify' && p.name?.toLowerCase().includes('all out')
  ) || playlists[0];

  if (match) {
    resolvedDecadeIds[query] = match.id;
    return match.id;
  }
  return null;
}

// ── Fetch all decade playlists ──────────────────────────────────────

async function fetchAllDecadeTracks(onProgress) {
  const decades = Object.keys(DECADE_SEARCHES).map(Number).sort();
  const decadeMap = {};

  for (let i = 0; i < decades.length; i++) {
    const decade = decades[i];
    const query = DECADE_SEARCHES[decade];
    if (onProgress) onProgress(`Finding ${decade}s playlist...`, i, decades.length);

    const playlistId = await searchForPlaylist(query);
    if (!playlistId) {
      console.warn(`Could not find playlist for ${query}`);
      decadeMap[decade] = [];
      continue;
    }

    if (onProgress) onProgress(`Loading ${decade}s...`, i, decades.length);
    try {
      decadeMap[decade] = await fetchPlaylistTracks(playlistId);
    } catch (e) {
      console.warn(`Failed to load ${decade}s:`, e.message);
      decadeMap[decade] = [];
    }
  }

  return decadeMap;
}

// ── Fetch the current user's playlists ──────────────────────────────

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
