// ── Name That Tune – Game Controller ────────────────────────────────

const ROUND_DURATION = 60000;   // 60 seconds per song
const ART_REVEAL_AT = 30000;    // album art at 30s
const FULL_REVEAL_AT = 50000;   // title/artist at 50s
const SONGS_PER_DECADE = 10;

let gameState = 'LOGIN';  // LOGIN | READY | LOADING | PLAYING | PAUSED | GAME_OVER
let gameMode = 'shuffle'; // shuffle | decades | playlist
let playlist = [];
let currentIndex = 0;
let roundStartTime = 0;
let pauseOffset = 0;
let timerInterval = null;
let currentPhase = 'hidden'; // hidden | art | revealed

// ── DOM refs (set in initGame) ──────────────────────────────────────
let $loginScreen, $gameScreen, $gameOverScreen;
let $songCounter, $progressBar, $timer, $timerRing;
let $centerStage, $questionMark, $albumArt, $albumArtBg;
let $songTitle, $songArtist, $songYear;
let $pauseOverlay, $toast;

function initGame() {
  $loginScreen = document.getElementById('login-screen');
  $gameScreen = document.getElementById('game-screen');
  $gameOverScreen = document.getElementById('gameover-screen');
  $songCounter = document.getElementById('song-counter');
  $progressBar = document.getElementById('progress-fill');
  $timer = document.getElementById('timer-text');
  $timerRing = document.getElementById('timer-ring-progress');
  $centerStage = document.getElementById('center-stage');
  $questionMark = document.getElementById('question-mark');
  $albumArt = document.getElementById('album-art');
  $albumArtBg = document.getElementById('album-art-bg');
  $songTitle = document.getElementById('song-title');
  $songArtist = document.getElementById('song-artist');
  $songYear = document.getElementById('song-year');
  $pauseOverlay = document.getElementById('pause-overlay');
  $toast = document.getElementById('toast');

  if (isLoggedIn()) {
    showReadyState();
  }

  document.addEventListener('keydown', (e) => {
    if ((e.code === 'Space' || e.code === 'Escape') && (gameState === 'PLAYING' || gameState === 'PAUSED')) {
      e.preventDefault();
      togglePause();
    }
  });
}

// ── Screen Transitions ──────────────────────────────────────────────

function showReadyState() {
  gameState = 'READY';
  $loginScreen.classList.add('hidden');
  $gameScreen.classList.remove('hidden');
  $songCounter.textContent = '';
  $albumArt.classList.add('hidden');
  $songTitle.classList.add('hidden');
  $songArtist.classList.add('hidden');
  $songYear.classList.add('hidden');
  initSpotifySDK();
}

async function initSpotifySDK() {
  if (useMobilePlayback) {
    try { await initPlayer(); } catch (e) {
      console.log('No Spotify device found yet — will retry on game start');
    }
    return;
  }
  // Load the SDK dynamically (only on desktop — never on mobile)
  loadSpotifySDK();
  if (typeof Spotify === 'undefined') {
    window.onSpotifyWebPlaybackSDKReady = () => initPlayer();
  } else {
    await initPlayer();
  }
}

// ── Mode Selection ──────────────────────────────────────────────────

let selectedPlaylistId = null;
let userPlaylistsLoaded = false;

function selectMode(mode) {
  gameMode = mode;
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`[data-mode="${mode}"]`).classList.add('active');

  const $picker = document.getElementById('playlist-picker');
  if (mode === 'playlist') {
    $picker.classList.remove('hidden');
    if (!userPlaylistsLoaded) loadUserPlaylists();
  } else {
    $picker.classList.add('hidden');
  }
}

async function loadUserPlaylists() {
  const $list = document.getElementById('playlist-list');
  $list.innerHTML = '<div class="playlist-loading">Loading your playlists...</div>';

  const allPlaylists = await fetchUserPlaylists();
  const playlists = allPlaylists.filter(p => p.trackCount >= 60);
  userPlaylistsLoaded = true;

  if (playlists.length === 0) {
    $list.innerHTML = '<div class="playlist-loading">No playlists with 60+ songs found</div>';
    return;
  }

  $list.innerHTML = '';
  const $search = document.getElementById('playlist-search');
  $search.value = '';
  $search.addEventListener('input', () => {
    const q = $search.value.toLowerCase();
    $list.querySelectorAll('.playlist-item').forEach(item => {
      const name = item.querySelector('.playlist-name').textContent.toLowerCase();
      item.style.display = name.includes(q) ? '' : 'none';
    });
  });

  for (const p of playlists) {
    const item = document.createElement('button');
    item.className = 'playlist-item';
    item.dataset.id = p.id;

    const img = document.createElement('img');
    img.className = 'playlist-thumb';
    img.alt = '';
    if (p.image) img.src = p.image;

    const info = document.createElement('div');
    info.className = 'playlist-info';

    const name = document.createElement('div');
    name.className = 'playlist-name';
    name.textContent = p.name;

    const meta = document.createElement('div');
    meta.className = 'playlist-meta';
    meta.textContent = `${p.trackCount} songs${p.owner ? ' · ' + p.owner : ''}`;

    info.appendChild(name);
    info.appendChild(meta);
    item.appendChild(img);
    item.appendChild(info);

    item.addEventListener('click', () => {
      document.querySelectorAll('.playlist-item').forEach(i => i.classList.remove('selected'));
      item.classList.add('selected');
      selectedPlaylistId = p.id;
    });
    $list.appendChild(item);
  }
}

// ── Loading State ───────────────────────────────────────────────────

function showLoading(message) {
  gameState = 'LOADING';
  document.getElementById('start-btn').classList.add('hidden');
  document.getElementById('mode-selector').classList.add('hidden');
  document.getElementById('playlist-picker').classList.add('hidden');
  $questionMark.classList.add('hidden');

  const $loading = document.getElementById('loading-indicator');
  $loading.classList.remove('hidden');
  document.getElementById('loading-text').textContent = message;
}

function updateLoading(message) {
  document.getElementById('loading-text').textContent = message;
}

function hideLoading() {
  document.getElementById('loading-indicator').classList.add('hidden');
}

// ── Playlist Builders ───────────────────────────────────────────────

async function buildShufflePlaylist() {
  return await buildBillboardShufflePlaylist((msg) => updateLoading(msg));
}

async function buildDecadePlaylist() {
  return await buildBillboardDecadePlaylist((msg) => updateLoading(msg));
}

async function buildCustomPlaylist() {
  if (!selectedPlaylistId) throw new Error('Select a playlist first');

  updateLoading('Loading your playlist...');
  const tracks = await fetchPlaylistTracks(selectedPlaylistId);

  if (tracks.length === 0) throw new Error('Playlist is empty or could not be loaded');
  return shuffleTracks(tracks).slice(0, 60);
}

// ── Game Start ──────────────────────────────────────────────────────

async function startGame() {
  // On mobile, retry finding an external Spotify device
  if (useMobilePlayback && !playerReady) {
    try { await initPlayer(); } catch (e) {}
  }

  if (!playerReady) {
    const msg = useMobilePlayback
      ? 'Open Spotify on your phone first, then try again'
      : 'Waiting for Spotify player...';
    showToast(msg, 5000);
    return;
  }

  showLoading('Preparing songs...');

  try {
    if (gameMode === 'decades') {
      playlist = await buildDecadePlaylist();
    } else if (gameMode === 'playlist') {
      playlist = await buildCustomPlaylist();
    } else {
      playlist = await buildShufflePlaylist();
    }
  } catch (err) {
    hideLoading();
    showReadyState();
    selectMode(gameMode);
    showToast(err.message, 6000);
    return;
  }

  hideLoading();
  document.getElementById('game-title').classList.add('hidden');
  document.getElementById('timer-container').classList.remove('hidden');
  currentIndex = 0;
  gameState = 'PLAYING';

  await startRound();

  // On mobile, verify audio is actually playing — don't fail silently
  if (useMobilePlayback) {
    const isPlaying = await checkPlaybackActive();
    if (!isPlaying) {
      clearInterval(timerInterval);
      await stopPlayback();
      gameState = 'READY';
      showToast('Spotify is not playing audio. Open Spotify, play any song for a moment, then come back and try again.', 6000);
      restartGame();
      return;
    }
  }

  timerInterval = setInterval(gameLoop, 100);
}

// ── Round Management ────────────────────────────────────────────────

async function startRound() {
  currentPhase = 'hidden';
  roundStartTime = Date.now();

  const track = playlist[currentIndex];
  const totalSongs = playlist.length;

  // Show decade label in decades mode
  const $decadeLabel = document.getElementById('decade-label');
  if (gameMode === 'decades') {
    const decade = Math.floor(track.year / 10) * 10;
    const decadeStr = `${decade}s`;
    $decadeLabel.textContent = decadeStr;
    $decadeLabel.classList.remove('hidden');
    const songInDecade = (currentIndex % SONGS_PER_DECADE) + 1;
    $songCounter.textContent = `${decadeStr} — Song ${songInDecade}/${SONGS_PER_DECADE}  (${currentIndex + 1} of ${totalSongs})`;
  } else {
    $decadeLabel.classList.add('hidden');
    $songCounter.textContent = `Song ${currentIndex + 1} of ${totalSongs}`;
  }
  $progressBar.style.width = `${((currentIndex) / totalSongs) * 100}%`;

  // Reset UI to hidden state
  $centerStage.className = 'center-stage phase-hidden';
  $questionMark.classList.remove('hidden');
  document.getElementById('report-btn').classList.add('hidden');
  $albumArt.classList.add('hidden');
  $albumArt.src = '';
  $albumArtBg.style.backgroundImage = '';
  $albumArtBg.classList.add('hidden');
  $songTitle.classList.add('hidden');
  $songArtist.classList.add('hidden');
  $songYear.classList.add('hidden');
  $songTitle.textContent = '';
  $songArtist.textContent = '';
  $songYear.textContent = '';

  try {
    await playTrack(track.uri);
  } catch (err) {
    console.error('Failed to play track:', err);
    showToast(`Skipping: ${track.title} (unavailable)`, 2000);
    playlist.splice(currentIndex, 1);
    if (currentIndex >= playlist.length) {
      setTimeout(() => endGame(), 2000);
    } else {
      setTimeout(() => startRound(), 2000);
    }
  }
}

function gameLoop() {
  if (gameState !== 'PLAYING') return;

  const elapsed = Date.now() - roundStartTime;
  const remaining = Math.max(0, ROUND_DURATION - elapsed);
  const seconds = Math.ceil(remaining / 1000);

  $timer.textContent = seconds + 's';

  const progress = elapsed / ROUND_DURATION;
  if ($timerRing) {
    const circumference = 2 * Math.PI * 54;
    $timerRing.style.strokeDashoffset = circumference * (1 - progress);
  }

  if (elapsed >= FULL_REVEAL_AT && currentPhase !== 'revealed') {
    revealFull();
  } else if (elapsed >= ART_REVEAL_AT && currentPhase === 'hidden') {
    revealAlbumArt();
  }

  if (elapsed >= ROUND_DURATION) {
    advanceToNext();
  }
}

// ── Phase Transitions ───────────────────────────────────────────────

function revealAlbumArt() {
  currentPhase = 'art';

  $centerStage.className = 'center-stage phase-art';
  $questionMark.classList.add('hidden');

  const artUrl = getAlbumArt() || playlist[currentIndex]?.albumArt;
  if (artUrl) {
    $albumArt.src = artUrl;
    $albumArt.classList.remove('hidden');
    $albumArtBg.style.backgroundImage = `url(${artUrl})`;
    $albumArtBg.classList.remove('hidden');
    extractColors(artUrl);
  }
}

function revealFull() {
  currentPhase = 'revealed';
  const track = playlist[currentIndex];

  $centerStage.className = 'center-stage phase-revealed';

  $songTitle.textContent = track.title;
  $songArtist.textContent = track.artist;
  $songYear.textContent = track.year;
  $songTitle.classList.remove('hidden');
  $songArtist.classList.remove('hidden');
  $songYear.classList.remove('hidden');

  // Show report button (only for billboard-sourced tracks)
  const $report = document.getElementById('report-btn');
  if (track.originalTitle && canReport()) {
    $report.classList.remove('hidden');
    $report.onclick = () => {
      const sent = reportSong(track.originalArtist, track.originalTitle, track.year);
      if (sent) {
        $report.textContent = 'Reported — thanks!';
        $report.disabled = true;
      }
    };
    $report.textContent = 'Wrong song?';
    $report.disabled = false;
  } else {
    $report.classList.add('hidden');
  }
}

async function advanceToNext() {
  currentIndex++;
  const totalSongs = playlist.length;
  $progressBar.style.width = `${(currentIndex / totalSongs) * 100}%`;

  if (currentIndex >= totalSongs) {
    endGame();
    return;
  }

  await startRound();
}

// ── Game End ────────────────────────────────────────────────────────

async function endGame() {
  gameState = 'GAME_OVER';
  clearInterval(timerInterval);
  await stopPlayback();

  $gameScreen.classList.add('hidden');
  $gameOverScreen.classList.remove('hidden');
}

// ── Quit Game ───────────────────────────────────────────────────────

async function quitGame() {
  clearInterval(timerInterval);
  await stopPlayback();
  $pauseOverlay.classList.add('hidden');
  restartGame();
}

// ── Pause / Resume ──────────────────────────────────────────────────

async function togglePause() {
  if (gameState === 'PLAYING') {
    gameState = 'PAUSED';
    pauseOffset = Date.now() - roundStartTime;
    $pauseOverlay.classList.remove('hidden');
    await stopPlayback();
  } else if (gameState === 'PAUSED') {
    gameState = 'PLAYING';
    roundStartTime = Date.now() - pauseOffset;
    $pauseOverlay.classList.add('hidden');
    const track = playlist[currentIndex];
    await playTrack(track.uri);
  }
}

// ── Color Extraction ────────────────────────────────────────────────

function extractColors(imageUrl) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 50;
    canvas.height = 50;
    ctx.drawImage(img, 0, 0, 50, 50);

    try {
      const data = ctx.getImageData(0, 0, 50, 50).data;
      let r = 0, g = 0, b = 0, count = 0;

      for (let i = 0; i < data.length; i += 16) {
        const pr = data[i], pg = data[i + 1], pb = data[i + 2];
        const brightness = (pr + pg + pb) / 3;
        if (brightness > 30 && brightness < 220) {
          r += pr; g += pg; b += pb; count++;
        }
      }

      if (count > 0) {
        r = Math.round(r / count);
        g = Math.round(g / count);
        b = Math.round(b / count);
        document.documentElement.style.setProperty('--accent-r', r);
        document.documentElement.style.setProperty('--accent-g', g);
        document.documentElement.style.setProperty('--accent-b', b);
        document.documentElement.style.setProperty('--accent', `rgb(${r},${g},${b})`);
      }
    } catch (e) { /* CORS — keep defaults */ }
  };
  img.src = imageUrl;
}

// ── Toast Notifications ─────────────────────────────────────────────

function showToast(message, duration = 3000) {
  $toast.textContent = message;
  $toast.classList.remove('hidden');
  $toast.classList.add('show');
  setTimeout(() => {
    $toast.classList.remove('show');
    $toast.classList.add('hidden');
  }, duration);
}

// ── Logout ──────────────────────────────────────────────────────────

function doLogout() {
  disconnectPlayer();
  logout();
  $gameScreen.classList.add('hidden');
  $gameOverScreen.classList.add('hidden');
  $loginScreen.classList.remove('hidden');
  gameState = 'LOGIN';
}

// ── Restart ─────────────────────────────────────────────────────────

function restartGame() {
  $gameOverScreen.classList.add('hidden');
  $gameScreen.classList.remove('hidden');
  document.getElementById('start-btn').classList.remove('hidden');
  document.getElementById('mode-selector').classList.remove('hidden');
  document.getElementById('decade-label').classList.add('hidden');
  document.getElementById('loading-indicator').classList.add('hidden');
  if (gameMode === 'playlist') {
    document.getElementById('playlist-picker').classList.remove('hidden');
  }
  document.getElementById('game-title').classList.remove('hidden');
  document.getElementById('timer-container').classList.add('hidden');
  $questionMark.classList.add('hidden');
  $centerStage.className = 'center-stage phase-hidden';
  $albumArt.classList.add('hidden');
  $albumArtBg.classList.add('hidden');
  $songTitle.classList.add('hidden');
  $songArtist.classList.add('hidden');
  $songYear.classList.add('hidden');
  $progressBar.style.width = '0%';
  gameState = 'READY';
}
