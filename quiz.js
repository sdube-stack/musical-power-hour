// ── Quiz Mode Logic ─────────────────────────────────────────────────

// ── Fuzzy Answer Matching ───────────────────────────────────────────

function normalizeAnswer(str) {
  return str
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip accents (é→e)
    .replace(/^(the|a|an)\s+/i, '')
    .replace(/['']/g, "'")
    .replace(/[^a-z0-9'\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function isFuzzyMatch(a, b) {
  // Allow ~20% edit distance, minimum 2 edits for short strings
  const maxDist = Math.max(2, Math.floor(Math.max(a.length, b.length) * 0.2));
  return levenshtein(a, b) <= maxDist;
}

function matchAnswer(guess, correct) {
  if (!guess || !guess.trim()) return false;
  const g = normalizeAnswer(guess);
  const c = normalizeAnswer(correct);
  if (!g) return false;
  if (g === c) return true;
  if (c.includes(g) || g.includes(c)) return true;
  if (isFuzzyMatch(g, c)) return true;
  return false;
}

function matchArtist(guess, correct) {
  if (matchAnswer(guess, correct)) return true;
  // Split on common separators and match any individual artist
  const parts = correct.split(/\s*(?:,|&|\band\b|feat\.?|ft\.?|featuring)\s*/i).filter(Boolean);
  for (const part of parts) {
    if (matchAnswer(guess, part)) return true;
  }
  return false;
}

function matchYear(guessStr, correctYear) {
  const guess = parseInt(guessStr, 10);
  if (isNaN(guess)) return { correct: false, close: false };
  if (guess === correctYear) return { correct: true, close: false };
  if (Math.abs(guess - correctYear) <= 1) return { correct: false, close: true };
  return { correct: false, close: false };
}

// ── Round Scoring ───────────────────────────────────────────────────

function scoreRound(guessTitle, guessArtist, guessYear, track, submittedInFirst30s) {
  const titleCorrect = matchAnswer(guessTitle, track.title);
  const artistCorrect = matchArtist(guessArtist, track.artist);
  const yearResult = matchYear(guessYear, track.year);
  const yearGetsPoint = yearResult.correct || yearResult.close;

  let points = 0;
  if (titleCorrect) points++;
  if (artistCorrect) points++;
  if (yearGetsPoint) points++;

  const allCorrect = titleCorrect && artistCorrect && yearGetsPoint;
  if (allCorrect) points++;

  const speedBonus = allCorrect && submittedInFirst30s;
  if (speedBonus) points++;

  return {
    points,
    titleCorrect,
    artistCorrect,
    yearCorrect: yearResult.correct,
    yearClose: yearResult.close,
    yearGetsPoint,
    allCorrect,
    speedBonus,
  };
}

// ── Scoreboard (localStorage) ───────────────────────────────────────

const SCOREBOARD_KEY = 'mph_scoreboard';

function getScoreboard() {
  try {
    return JSON.parse(localStorage.getItem(SCOREBOARD_KEY) || '[]');
  } catch (e) {
    return [];
  }
}

function saveToScoreboard(entry) {
  const board = getScoreboard();
  board.push(entry);
  board.sort((a, b) => b.ratio - a.ratio);
  localStorage.setItem(SCOREBOARD_KEY, JSON.stringify(board.slice(0, 50)));
}

function clearScoreboard() {
  localStorage.removeItem(SCOREBOARD_KEY);
}

// ── Speed Guesser Effect ────────────────────────────────────────────

function triggerSpeedGuesser() {
  const overlay = document.getElementById('speed-guesser-overlay');
  overlay.classList.remove('hidden');
  overlay.innerHTML = '<div class="speed-guesser-text">⚡ SPEED GUESSER ⚡</div>';

  // Spawn random lightning bolts
  for (let i = 0; i < 12; i++) {
    setTimeout(() => {
      const bolt = document.createElement('div');
      bolt.className = 'lightning-bolt';
      bolt.textContent = '⚡';
      bolt.style.left = Math.random() * 90 + 5 + '%';
      bolt.style.top = Math.random() * 80 + 10 + '%';
      bolt.style.fontSize = (1.5 + Math.random() * 2) + 'rem';
      overlay.appendChild(bolt);
    }, i * 150);
  }

  setTimeout(() => {
    overlay.classList.add('hidden');
    overlay.innerHTML = '';
  }, 2500);
}
