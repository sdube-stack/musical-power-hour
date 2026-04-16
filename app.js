// ── Name That Tune – Game Controller ────────────────────────────────

const ROUND_DURATION = 60000;   // 60 seconds per song
const ART_REVEAL_AT = 30000;    // album art at 30s (party only)
const FULL_REVEAL_AT = 50000;   // title/artist at 50s (party only)
const SONGS_PER_DECADE = 10;
const QUIZ_REVEAL_DURATION = 5000; // 5 seconds to show correct answers
const SPEED_GUESS_CUTOFF = 30000;  // must submit within 30s for speed bonus

let gameState = 'LOGIN';  // LOGIN | READY | LOADING | PLAYING | PAUSED | GAME_OVER
let gameType = 'party';   // party | quiz
let gameMode = 'shuffle'; // shuffle | decades | playlist
let playlist = [];
let currentIndex = 0;
let roundStartTime = 0;
let pauseOffset = 0;
let timerInterval = null;
let currentPhase = 'hidden'; // hidden | art | revealed

// Quiz state
let quizScore = 0;
let quizRoundScores = [];
let quizPlayerName = '';
let quizSongCount = 20;
let quizSubmitted = false;
let quizRevealStart = 0;
let quizSaved = false;

// Playlist data (cached for re-filtering)
let allUserPlaylists = null;
let selectedPlaylistTrackCount = 0;

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
    // Enter to submit quiz guess
    if (e.code === 'Enter' && gameState === 'PLAYING' && gameType === 'quiz' && !quizSubmitted) {
      e.preventDefault();
      submitQuizGuess();
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
  if (typeof Spotify === 'undefined') {
    window.onSpotifyWebPlaybackSDKReady = () => initPlayer();
  } else {
    await initPlayer();
  }
}

// ── Type Selection (Party / Quiz) ───────────────────────────────────

function selectType(type) {
  gameType = type;
  document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`[data-type="${type}"]`).classList.add('active');

  const $decadesBtn = document.getElementById('decades-btn');
  const $quizSetup = document.getElementById('quiz-setup');
  const $scoreboardBtn = document.getElementById('scoreboard-btn');

  if (type === 'quiz') {
    $decadesBtn.classList.add('hidden');
    $quizSetup.classList.remove('hidden');
    $scoreboardBtn.classList.remove('hidden');
    // If decades was selected, switch to shuffle
    if (gameMode === 'decades') selectMode('shuffle');
    // Reload playlists with 10+ filter if in playlist mode
    if (gameMode === 'playlist') reloadPlaylistPicker();
  } else {
    $decadesBtn.classList.remove('hidden');
    $quizSetup.classList.add('hidden');
    $scoreboardBtn.classList.add('hidden');
    // Reload playlists with 60+ filter if in playlist mode
    if (gameMode === 'playlist') reloadPlaylistPicker();
  }
}

// ── Mode Selection ──────────────────────────────────────────────────

let selectedPlaylistId = null;
let userPlaylistsLoaded = false;

function selectMode(mode) {
  gameMode = mode;
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector(`[data-mode="${mode}"]:not(.hidden)`);
  if (btn) btn.classList.add('active');

  const $picker = document.getElementById('playlist-picker');
  if (mode === 'playlist') {
    $picker.classList.remove('hidden');
    if (!userPlaylistsLoaded) loadUserPlaylists();
    // Update song count max for quiz
    updateSongCountMax();
  } else {
    $picker.classList.add('hidden');
    // Reset song count max for shuffle
    if (gameType === 'quiz') {
      document.getElementById('song-count').max = 100;
    }
  }
}

function updateSongCountMax() {
  if (gameType !== 'quiz') return;
  const $count = document.getElementById('song-count');
  if (gameMode === 'playlist' && selectedPlaylistTrackCount > 0) {
    $count.max = selectedPlaylistTrackCount;
    if (parseInt($count.value) > selectedPlaylistTrackCount) {
      $count.value = selectedPlaylistTrackCount;
    }
  } else {
    $count.max = 100;
  }
}

function reloadPlaylistPicker() {
  userPlaylistsLoaded = false;
  selectedPlaylistId = null;
  selectedPlaylistTrackCount = 0;
  loadUserPlaylists();
}

async function loadUserPlaylists() {
  const $list = document.getElementById('playlist-list');
  $list.innerHTML = '<div class="playlist-loading">Loading your playlists...</div>';

  if (!allUserPlaylists) {
    allUserPlaylists = await fetchUserPlaylists();
  }

  const minTracks = gameType === 'quiz' ? 10 : 60;
  const playlists = allUserPlaylists.filter(p => p.trackCount >= minTracks);
  userPlaylistsLoaded = true;

  if (playlists.length === 0) {
    $list.innerHTML = `<div class="playlist-loading">No playlists with ${minTracks}+ songs found</div>`;
    return;
  }

  $list.innerHTML = '';
  const $search = document.getElementById('playlist-search');
  $search.value = '';
  // Remove old listeners by cloning
  const $newSearch = $search.cloneNode(true);
  $search.parentNode.replaceChild($newSearch, $search);
  $newSearch.addEventListener('input', () => {
    const q = $newSearch.value.toLowerCase();
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
      selectedPlaylistTrackCount = p.trackCount;
      updateSongCountMax();
    });
    $list.appendChild(item);
  }
}

// ── Loading State ───────────────────────────────────────────────────

function showLoading(message) {
  gameState = 'LOADING';
  document.getElementById('start-btn').classList.add('hidden');
  document.getElementById('type-selector').classList.add('hidden');
  document.getElementById('mode-selector').classList.add('hidden');
  document.getElementById('playlist-picker').classList.add('hidden');
  document.getElementById('quiz-setup').classList.add('hidden');
  document.getElementById('scoreboard-btn').classList.add('hidden');
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
  const tracks = await buildBillboardShufflePlaylist((msg) => updateLoading(msg));
  if (tracks.length === 0) throw new Error('No tracks found on Spotify');
  return tracks;
}

async function buildDecadePlaylist() {
  const tracks = await buildBillboardDecadePlaylist((msg) => updateLoading(msg));
  if (tracks.length === 0) throw new Error('No tracks found on Spotify');
  return tracks;
}

async function buildCustomPlaylist() {
  if (!selectedPlaylistId) throw new Error('Select a playlist first');

  updateLoading('Loading your playlist...');
  const tracks = await fetchPlaylistTracks(selectedPlaylistId);

  if (tracks.length === 0) throw new Error('Playlist is empty or could not be loaded');

  const count = gameType === 'quiz' ? quizSongCount : 60;
  return shuffleTracks(tracks).slice(0, count);
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

  // Quiz validation
  if (gameType === 'quiz') {
    quizPlayerName = document.getElementById('player-name').value.trim();
    quizSongCount = parseInt(document.getElementById('song-count').value, 10);
    if (!quizPlayerName) {
      showToast('Enter a player or team name', 3000);
      return;
    }
    if (isNaN(quizSongCount) || quizSongCount < 10) {
      showToast('Song count must be at least 10', 3000);
      return;
    }
    quizScore = 0;
    quizRoundScores = [];
    quizSubmitted = false;
    quizSaved = false;
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

    // For quiz shuffle, limit to requested song count
    if (gameType === 'quiz' && gameMode === 'shuffle') {
      playlist = playlist.slice(0, quizSongCount);
    }
  } catch (err) {
    hideLoading();
    showReadyState();
    selectType(gameType);
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
  if (gameMode === 'decades' && gameType === 'party') {
    const decade = Math.floor(track.year / 10) * 10;
    const decadeStr = `${decade}s`;
    $decadeLabel.textContent = decadeStr;
    $decadeLabel.classList.remove('hidden');
    const songInDecade = (currentIndex % SONGS_PER_DECADE) + 1;
    $songCounter.textContent = `${decadeStr} — Song ${songInDecade}/${SONGS_PER_DECADE}  (${currentIndex + 1} of ${totalSongs})`;
  } else {
    $decadeLabel.classList.add('hidden');
    if (gameType === 'quiz') {
      $songCounter.textContent = `Song ${currentIndex + 1} of ${totalSongs}  |  Score: ${quizScore}`;
    } else {
      $songCounter.textContent = `Song ${currentIndex + 1} of ${totalSongs}`;
    }
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

  // Quiz: show guess form, hide reveal
  if (gameType === 'quiz') {
    quizSubmitted = false;
    const $guess = document.getElementById('quiz-guess');
    $guess.classList.remove('hidden');
    document.getElementById('guess-title').value = '';
    document.getElementById('guess-artist').value = '';
    document.getElementById('guess-year').value = '';
    document.getElementById('guess-title').disabled = false;
    document.getElementById('guess-artist').disabled = false;
    document.getElementById('guess-year').disabled = false;
    document.getElementById('submit-guess-btn').disabled = false;
    document.getElementById('quiz-reveal').classList.add('hidden');
    // Focus the first input
    setTimeout(() => document.getElementById('guess-title').focus(), 100);
  }

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

  // ── Quiz mode game loop ─────────────────────────────────────────
  if (gameType === 'quiz') {
    if (quizSubmitted) {
      // In reveal phase — wait 5 seconds then advance
      const revealElapsed = Date.now() - quizRevealStart;
      const revealRemaining = Math.max(0, QUIZ_REVEAL_DURATION - revealElapsed);
      $timer.textContent = Math.ceil(revealRemaining / 1000) + 's';
      if (revealElapsed >= QUIZ_REVEAL_DURATION) {
        advanceToNext();
      }
      return;
    }

    // Guessing phase
    const remaining = Math.max(0, ROUND_DURATION - elapsed);
    const seconds = Math.ceil(remaining / 1000);
    $timer.textContent = seconds + 's';

    const progress = elapsed / ROUND_DURATION;
    if ($timerRing) {
      const circumference = 2 * Math.PI * 54;
      $timerRing.style.strokeDashoffset = circumference * (1 - progress);
    }

    if (elapsed >= ROUND_DURATION) {
      submitQuizGuess();
    }
    return;
  }

  // ── Party mode game loop (unchanged) ────────────────────────────
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

// ── Quiz: Submit Guess ──────────────────────────────────────────────

function submitQuizGuess() {
  if (quizSubmitted) return;
  quizSubmitted = true;
  quizRevealStart = Date.now();

  const elapsed = Date.now() - roundStartTime;
  const submittedInFirst30s = elapsed <= SPEED_GUESS_CUTOFF;

  const guessTitle = document.getElementById('guess-title').value;
  const guessArtist = document.getElementById('guess-artist').value;
  const guessYear = document.getElementById('guess-year').value;

  const track = playlist[currentIndex];
  const result = scoreRound(guessTitle, guessArtist, guessYear, track, submittedInFirst30s);

  quizScore += result.points;
  quizRoundScores.push(result);

  // Disable inputs
  document.getElementById('guess-title').disabled = true;
  document.getElementById('guess-artist').disabled = true;
  document.getElementById('guess-year').disabled = true;
  document.getElementById('submit-guess-btn').disabled = true;

  // Show reveal
  showQuizReveal(track, result);

  // Update score in counter
  const totalSongs = playlist.length;
  $songCounter.textContent = `Song ${currentIndex + 1} of ${totalSongs}  |  Score: ${quizScore}`;

  // Speed guesser effect
  if (result.speedBonus) {
    triggerSpeedGuesser();
  }
}

function showQuizReveal(track, result) {
  const $guess = document.getElementById('quiz-guess');
  $guess.classList.add('hidden');

  const $reveal = document.getElementById('quiz-reveal');
  $reveal.classList.remove('hidden');

  // Show album art during reveal
  const artUrl = getAlbumArt() || track.albumArt;
  if (artUrl) {
    $albumArt.src = artUrl;
    $albumArt.classList.remove('hidden');
    $albumArtBg.style.backgroundImage = `url(${artUrl})`;
    $albumArtBg.classList.remove('hidden');
    extractColors(artUrl);
  }
  $questionMark.classList.add('hidden');
  $centerStage.className = 'center-stage phase-revealed';

  const check = '✓';
  const cross = '✗';

  document.getElementById('reveal-title').innerHTML =
    `<span class="${result.titleCorrect ? 'correct' : 'wrong'}">${result.titleCorrect ? check : cross}</span> ${track.title}`;
  document.getElementById('reveal-artist').innerHTML =
    `<span class="${result.artistCorrect ? 'correct' : 'wrong'}">${result.artistCorrect ? check : cross}</span> ${track.artist}`;

  if (result.yearClose) {
    document.getElementById('reveal-year').innerHTML =
      `<span class="close-enough">~</span> ${track.year} <span class="close-enough-text">Close enough I guess...</span>`;
  } else {
    document.getElementById('reveal-year').innerHTML =
      `<span class="${result.yearCorrect ? 'correct' : 'wrong'}">${result.yearCorrect ? check : cross}</span> ${track.year}`;
  }

  let pointsText = `+${result.points} point${result.points !== 1 ? 's' : ''}`;
  if (result.allCorrect && !result.speedBonus) pointsText += ' (all correct bonus!)';
  if (result.speedBonus) pointsText += ' (⚡ speed bonus!)';
  document.getElementById('reveal-points').innerHTML = pointsText;
  document.getElementById('reveal-points').className =
    'reveal-points' + (result.points >= 4 ? ' great' : result.points >= 1 ? ' ok' : ' none');
}

// ── Phase Transitions (party mode) ──────────────────────────────────

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

  if (gameType === 'quiz') {
    showQuizScoreScreen();
  } else {
    $gameOverScreen.classList.remove('hidden');
  }
}

function showQuizScoreScreen() {
  const $screen = document.getElementById('quiz-score-screen');
  $screen.classList.remove('hidden');

  const maxPoints = playlist.length * 5;
  const ratio = maxPoints > 0 ? (quizScore / maxPoints) : 0;

  document.getElementById('quiz-final-name').textContent = quizPlayerName;
  document.getElementById('quiz-final-score').textContent =
    `${quizScore} / ${maxPoints} points`;
  document.getElementById('quiz-final-ratio').textContent =
    `${(ratio * 100).toFixed(1)}% · ${playlist.length} songs`;

  // Reset save button
  const $saveBtn = document.getElementById('save-score-btn');
  $saveBtn.disabled = false;
  $saveBtn.textContent = 'Save to Scoreboard';
  quizSaved = false;
}

function saveQuizScore() {
  if (quizSaved) return;
  quizSaved = true;

  const maxPoints = playlist.length * 5;
  const ratio = maxPoints > 0 ? (quizScore / maxPoints) : 0;

  saveToScoreboard({
    name: quizPlayerName,
    songCount: playlist.length,
    points: quizScore,
    maxPoints,
    ratio,
    date: new Date().toISOString(),
  });

  const $btn = document.getElementById('save-score-btn');
  $btn.disabled = true;
  $btn.textContent = 'Saved!';
  showToast('Score saved to scoreboard', 2000);
}

// ── Scoreboard UI ───────────────────────────────────────────────────

function showScoreboard() {
  renderScoreboard();
  document.getElementById('scoreboard-overlay').classList.remove('hidden');
}

function showScoreboardFromEnd() {
  renderScoreboard();
  document.getElementById('scoreboard-overlay').classList.remove('hidden');
}

function closeScoreboard() {
  document.getElementById('scoreboard-overlay').classList.add('hidden');
}

function clearScoreboardUI() {
  clearScoreboard();
  renderScoreboard();
  showToast('Scoreboard cleared', 2000);
}

function renderScoreboard() {
  const board = getScoreboard();
  const $list = document.getElementById('scoreboard-list');

  if (board.length === 0) {
    $list.innerHTML = '<div class="scoreboard-empty">No scores yet</div>';
    return;
  }

  let html = '<table class="scoreboard-table"><thead><tr>' +
    '<th>#</th><th>Name</th><th>Songs</th><th>Points</th><th>Ratio</th>' +
    '</tr></thead><tbody>';

  board.forEach((entry, i) => {
    html += `<tr>
      <td>${i + 1}</td>
      <td>${escapeHtml(entry.name)}</td>
      <td>${entry.songCount}</td>
      <td>${entry.points}/${entry.maxPoints}</td>
      <td>${(entry.ratio * 100).toFixed(1)}%</td>
    </tr>`;
  });

  html += '</tbody></table>';
  $list.innerHTML = html;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
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
  document.getElementById('quiz-score-screen').classList.add('hidden');
  $loginScreen.classList.remove('hidden');
  gameState = 'LOGIN';
}

// ── Restart ─────────────────────────────────────────────────────────

function restartGame() {
  $gameOverScreen.classList.add('hidden');
  document.getElementById('quiz-score-screen').classList.add('hidden');
  $gameScreen.classList.remove('hidden');
  document.getElementById('start-btn').classList.remove('hidden');
  document.getElementById('type-selector').classList.remove('hidden');
  document.getElementById('mode-selector').classList.remove('hidden');
  document.getElementById('decade-label').classList.add('hidden');
  document.getElementById('loading-indicator').classList.add('hidden');
  document.getElementById('quiz-guess').classList.add('hidden');
  document.getElementById('quiz-reveal').classList.add('hidden');

  // Restore type/mode selection state
  selectType(gameType);
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
