// ── Spotify Web Playback SDK Wrapper ────────────────────────────────

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

// ── Mobile: Spotify Connect (play through external Spotify app) ─────

async function initMobilePlayer() {
  const device = await findExternalDevice();
  if (device) {
    deviceId = device.id;
    playerReady = true;
    console.log('Using external Spotify device:', device.name);
    return deviceId;
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
  // Prefer active device, then first available
  return data.devices?.find(d => d.is_active) || data.devices?.[0] || null;
}

async function transferPlaybackToDevice() {
  const token = await getValidToken();
  const resp = await fetch('https://api.spotify.com/v1/me/player', {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ device_ids: [deviceId], play: false }),
  });
  if (!resp.ok && resp.status !== 204) {
    throw new Error('Could not transfer playback to your device');
  }
}

async function checkPlaybackActive() {
  // Give Spotify a moment to start playing
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

async function playTrack(spotifyUri) {
  const token = await getValidToken();
  const resp = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ uris: [spotifyUri] }),
  });

  if (!resp.ok && resp.status !== 204) {
    const text = await resp.text();
    throw new Error(`Play failed (${resp.status}): ${text}`);
  }
}

async function stopPlayback() {
  const token = await getValidToken();
  await fetch(`https://api.spotify.com/v1/me/player/pause?device_id=${deviceId}`, {
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
