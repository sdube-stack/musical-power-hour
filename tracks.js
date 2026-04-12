// ── Spotify Playlist-Based Track Source ──────────────────────────────

// Spotify's official "All Out" decade playlists
const DECADE_PLAYLISTS = {
  1970: '37i9dQZF1DWTJ7xPn4vNaz', // All Out 70s
  1980: '37i9dQZF1DX4UtSsGT1Sbe', // All Out 80s
  1990: '37i9dQZF1DXbTxRx60FQOi', // All Out 90s
  2000: '37i9dQZF1DX4o1oenSJRJd', // All Out 00s
  2010: '37i9dQZF1DX5Ejj0EkURtP', // All Out 10s
  2020: '37i9dQZF1DX2M1RktxUUHG', // All Out 2020s
};

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

// ── Fetch all decade playlists ──────────────────────────────────────

async function fetchAllDecadeTracks(onProgress) {
  const decades = Object.keys(DECADE_PLAYLISTS).map(Number).sort();
  const decadeMap = {};

  for (let i = 0; i < decades.length; i++) {
    const decade = decades[i];
    if (onProgress) onProgress(`Loading ${decade}s...`, i, decades.length);
    decadeMap[decade] = await fetchPlaylistTracks(DECADE_PLAYLISTS[decade]);
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
