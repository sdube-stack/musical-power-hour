// ── Spotify PKCE OAuth ──────────────────────────────────────────────
// Replace this with your Spotify Developer App Client ID
const CLIENT_ID = 'ca2c60803e6a4ba6b535844e65d51da1';
const REDIRECT_URI = window.location.hostname === '127.0.0.1'
  ? 'http://127.0.0.1:5173/callback.html'
  : `${window.location.origin}${window.location.pathname.replace(/\/[^/]*$/, '')}/callback.html`;
const SCOPES = 'streaming user-read-email user-read-private user-modify-playback-state user-read-playback-state playlist-read-private playlist-read-collaborative';

let accessToken = null;
let refreshToken = null;
let tokenExpiry = 0;

// ── PKCE Helpers ────────────────────────────────────────────────────

function generateRandomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const values = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(values, v => chars[v % chars.length]).join('');
}

async function sha256(plain) {
  const encoder = new TextEncoder();
  return crypto.subtle.digest('SHA-256', encoder.encode(plain));
}

function base64urlEncode(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ── Login Flow ──────────────────────────────────────────────────────

async function loginWithSpotify() {
  const verifier = generateRandomString(128);
  sessionStorage.setItem('pkce_verifier', verifier);

  const challenge = base64urlEncode(await sha256(verifier));

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: challenge,
  });

  window.location.href = `https://accounts.spotify.com/authorize?${params}`;
}

// ── Token Exchange (called from callback.html) ──────────────────────

async function exchangeCodeForToken(code) {
  const verifier = sessionStorage.getItem('pkce_verifier');
  if (!verifier) throw new Error('Missing PKCE verifier');

  const resp = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: verifier,
    }),
  });

  if (!resp.ok) throw new Error(`Token exchange failed: ${resp.status}`);
  const data = await resp.json();

  accessToken = data.access_token;
  refreshToken = data.refresh_token;
  tokenExpiry = Date.now() + data.expires_in * 1000;

  sessionStorage.setItem('spotify_access_token', accessToken);
  sessionStorage.setItem('spotify_refresh_token', refreshToken);
  sessionStorage.setItem('spotify_token_expiry', tokenExpiry.toString());
  sessionStorage.removeItem('pkce_verifier');
}

// ── Token Refresh ───────────────────────────────────────────────────

async function refreshAccessToken() {
  const rt = refreshToken || sessionStorage.getItem('spotify_refresh_token');
  if (!rt) throw new Error('No refresh token available');

  const resp = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: rt,
      client_id: CLIENT_ID,
    }),
  });

  if (!resp.ok) throw new Error(`Token refresh failed: ${resp.status}`);
  const data = await resp.json();

  accessToken = data.access_token;
  if (data.refresh_token) refreshToken = data.refresh_token;
  tokenExpiry = Date.now() + data.expires_in * 1000;

  sessionStorage.setItem('spotify_access_token', accessToken);
  if (data.refresh_token) sessionStorage.setItem('spotify_refresh_token', data.refresh_token);
  sessionStorage.setItem('spotify_token_expiry', tokenExpiry.toString());
}

// ── Get Valid Token (auto-refreshes if needed) ──────────────────────

async function getValidToken() {
  // Load from session if not in memory
  if (!accessToken) {
    accessToken = sessionStorage.getItem('spotify_access_token');
    refreshToken = sessionStorage.getItem('spotify_refresh_token');
    tokenExpiry = parseInt(sessionStorage.getItem('spotify_token_expiry') || '0', 10);
  }

  // Refresh if expiring within 5 minutes
  if (accessToken && Date.now() > tokenExpiry - 300000) {
    await refreshAccessToken();
  }

  return accessToken;
}

function isLoggedIn() {
  return !!sessionStorage.getItem('spotify_access_token');
}

let currentUserId = null;

async function getCurrentUserId() {
  if (currentUserId) return currentUserId;
  const token = await getValidToken();
  const resp = await fetch('https://api.spotify.com/v1/me', {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (resp.ok) {
    const data = await resp.json();
    currentUserId = data.id;
  }
  return currentUserId;
}

function logout() {
  accessToken = null;
  refreshToken = null;
  tokenExpiry = 0;
  sessionStorage.removeItem('spotify_access_token');
  sessionStorage.removeItem('spotify_refresh_token');
  sessionStorage.removeItem('spotify_token_expiry');
}
