// ── Spotify Playback ────────────────────────────────────────────────

let spotifyPlayer = null;
let deviceId = null;
let playerReady = false;
let currentAlbumArt = null;

// Mobile browsers don't support the Web Playback SDK — use Spotify Connect instead
const useMobilePlayback = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

// Callbacks the game can hook into
let onPlayerReady = null;
let onPlayerError = null;
let onPlaybackStateChanged = null;

function initPlayer() {
  if (useMobilePlayback) return initMobilePlayer();
  return initDesktopPlayer();
}

// ── Mobile: Spotify Connect (play on user's active device) ──────────
// We never load the Web Playback SDK on mobile — it registers a phantom
// "speaker" that captures audio. Instead we just hit the REST API without
// a device_id so Spotify plays on whatever device is currently active
// (phone speaker, AirPods, car, etc.).

async function initMobilePlayer() {
  const device = await findExternalDevice();
  if (device) {
    // Don't store deviceId — we always target the active device
    playerReady = true;
    console.log('Spotify device found:', device.name);
    return;
  }
  throw new Error('No Spotify device found');
}

async function findExternalDevice() {
  const token = await getValidToken();
  const resp = await fetch('https://api.spotify.com/v1/me/player/devices', {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  return data.devices?.find(d => d.is_active) || data.devices?.[0] || null;
}

async function checkPlaybackActive() {
  await new Promise(r => setTimeout(r, 2000));
  const token = await getValidToken();
  const resp = await fetch('https://api.spotify.com/v1/me/player', {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!resp.ok || resp.status === 204) return false;
  const data = await resp.json();
  return data.is_playing === true;
}

// ── Desktop: Web Playback SDK ───────────────────────────────────────
// SDK script is loaded dynamically so it never touches mobile browsers.

function loadSpotifySDK() {
  if (document.querySelector('script[src*="spotify-player"]')) return;
  const script = document.createElement('script');
  script.src = 'https://sdk.scdn.co/spotify-player.js';
  document.body.appendChild(script);
}

function initDesktopPlayer() {
  return new Promise((resolve, reject) => {
    if (typeof Spotify === 'undefined') {
      reject(new Error('Spotify SDK not loaded'));
      return;
    }

    spotifyPlayer = new Spotify.Player({
      name: 'Name That Tune',
      getOAuthToken: async (cb) => {
        const token = await getValidToken();
        cb(token);
      },
      volume: 0.8,
    });

    spotifyPlayer.addListener('ready', ({ device_id }) => {
      deviceId = device_id;
      playerReady = true;
      console.log('Spotify player ready, device:', device_id);
      if (onPlayerReady) onPlayerReady();
      resolve(device_id);
    });

    spotifyPlayer.addListener('not_ready', ({ device_id }) => {
      playerReady = false;
      console.warn('Device went offline:', device_id);
    });

    spotifyPlayer.addListener('player_state_changed', (state) => {
      if (!state) return;
      const track = state.track_window?.current_track;
      if (track) {
        currentAlbumArt = track.album?.images?.[0]?.url || null;
      }
      if (onPlaybackStateChanged) onPlaybackStateChanged(state);
    });

    spotifyPlayer.addListener('initialization_error', ({ message }) => {
      console.error('Init error:', message);
      if (onPlayerError) onPlayerError('init', message);
      reject(new Error(message));
    });

    spotifyPlayer.addListener('authentication_error', ({ message }) => {
      console.error('Auth error:', message);
      if (onPlayerError) onPlayerError('auth', message);
    });

    spotifyPlayer.addListener('playback_error', ({ message }) => {
      console.error('Playback error:', message);
      if (onPlayerError) onPlayerError('playback', message);
    });

    spotifyPlayer.connect();
  });
}

// ── Playback Controls ───────────────────────────────────────────────
// On mobile, omit device_id so Spotify targets the currently active
// device. This survives device switches (e.g. connecting AirPods).

async function playTrack(spotifyUri) {
  const token = await getValidToken();
  const url = useMobilePlayback
    ? 'https://api.spotify.com/v1/me/player/play'
    : `https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`;

  let resp = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ uris: [spotifyUri] }),
  });

  // On mobile, retry once after a brief pause (handles device switching)
  if (useMobilePlayback && !resp.ok && resp.status !== 204) {
    await new Promise(r => setTimeout(r, 2000));
    const retryToken = await getValidToken();
    resp = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${retryToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ uris: [spotifyUri] }),
    });
  }

  if (!resp.ok && resp.status !== 204) {
    const text = await resp.text();
    throw new Error(`Play failed (${resp.status}): ${text}`);
  }
}

async function stopPlayback() {
  const token = await getValidToken();
  const url = useMobilePlayback
    ? 'https://api.spotify.com/v1/me/player/pause'
    : `https://api.spotify.com/v1/me/player/pause?device_id=${deviceId}`;
  await fetch(url, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${token}` },
  });
}

async function setVolume(percent) {
  if (spotifyPlayer) {
    await spotifyPlayer.setVolume(percent / 100);
  }
}

function getAlbumArt() {
  return currentAlbumArt;
}

function disconnectPlayer() {
  if (spotifyPlayer) {
    spotifyPlayer.disconnect();
    spotifyPlayer = null;
  }
  deviceId = null;
  playerReady = false;
}
