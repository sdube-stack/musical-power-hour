// ── Quiz Mode Logic ─────────────────────────────────────────────────

// ── Fuzzy Answer Matching ───────────────────────────────────────────

function normalizeAnswer(str) {
  return str
    .toLowerCase()
    .replace(/^(the|a|an)\s+/i, '')
    .replace(/['']/g, "'")
    .replace(/[^a-z0-9'\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchAnswer(guess, correct) {
  if (!guess || !guess.trim()) return false;
  const g = normalizeAnswer(guess);
  const c = normalizeAnswer(correct);
  if (!g) return false;
  if (g === c) return true;
  if (c.includes(g) || g.includes(c)) return true;
  return false;
}

function matchArtist(guess, correct) {
  if (matchAnswer(guess, correct)) return true;
  // Strip feat./ft./featuring/& and try primary artist only
  const primary = correct.replace(/\s*(feat\.?|ft\.?|featuring|&|,)\s*.*/i, '').trim();
  if (primary !== correct && matchAnswer(guess, primary)) return true;
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
