/* ═══════════════════════════════════════════════════════════════════════════
   Norster — frontend game logic (GitHub Pages / PKCE edition)

   SETUP: Fill in these two lines before deploying:
═══════════════════════════════════════════════════════════════════════════ */
const CLIENT_ID    = '49f2865ca36d41a198d4c7d0256723ed';
const REDIRECT_URI = 'https://nkgoma.github.io/MusicSearch/';

/* ── Spotify scopes needed ──────────────────────────────────────────────── */
const SCOPES = [
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-library-read',
].join(' ');

/* ── Game state ─────────────────────────────────────────────────────────── */
const state = {
  accessToken: '',
  userId: '',
  players: [],            // [{ name, tokens }]
  currentPlayerIndex: 0,
  tracks: [],             // unused for game logic; kept for compatibility
  currentTrackIndex: 0,   // turn counter
  revealed: false,
  isPlaying: false,
  deviceId: '',
  playerCount: 2,
  playlistUri: '',        // "spotify:playlist:{id}" of chosen playlist
  playlistStarted: false, // true after first PUT /me/player/play with context_uri
};

let allPlaylists = []; // all fetched playlists; used by client-side search

/* ═══════════════════════════════════════════════════════════════════════════
   PKCE OAUTH — no server or client secret needed
═══════════════════════════════════════════════════════════════════════════ */

function generateCodeVerifier() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64url(array);
}

async function generateCodeChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64url(new Uint8Array(digest));
}

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

async function startLogin() {
  const verifier   = generateCodeVerifier();
  const challenge  = await generateCodeChallenge(verifier);
  sessionStorage.setItem('pkce_verifier', verifier);

  const params = new URLSearchParams({
    response_type:         'code',
    client_id:             CLIENT_ID,
    scope:                 SCOPES,
    redirect_uri:          REDIRECT_URI,
    code_challenge_method: 'S256',
    code_challenge:        challenge,
    show_dialog:           'true',
  });
  window.location = 'https://accounts.spotify.com/authorize?' + params;
}

async function exchangeToken(code) {
  const verifier = sessionStorage.getItem('pkce_verifier');
  sessionStorage.removeItem('pkce_verifier');

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'authorization_code',
      client_id:     CLIENT_ID,
      code,
      redirect_uri:  REDIRECT_URI,
      code_verifier: verifier,
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error_description || data.error);
  console.log('Token granted scopes:', data.scope);
  return data.access_token;
}

/* ═══════════════════════════════════════════════════════════════════════════
   SPOTIFY API — direct browser calls (no proxy needed)
═══════════════════════════════════════════════════════════════════════════ */

async function spotifyFetch(method, path, body) {
  const headers = { Authorization: 'Bearer ' + state.accessToken };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const opts = { method, headers };
  if (body !== undefined) opts.body = JSON.stringify(body);

  const res = await fetch('https://api.spotify.com/v1' + path, opts);
  if (res.status === 204) return {};
  const data = await res.json();
  if (!res.ok) {
    const msg = data?.error?.message || 'Unknown error';
    throw new Error(`${msg} (HTTP ${res.status})`);
  }
  return data;
}

/* ═══════════════════════════════════════════════════════════════════════════
   SCREEN HELPERS
═══════════════════════════════════════════════════════════════════════════ */

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function $(id) { return document.getElementById(id); }

/* ═══════════════════════════════════════════════════════════════════════════
   INIT — runs on page load
═══════════════════════════════════════════════════════════════════════════ */

async function init() {
  const params = new URLSearchParams(window.location.search);
  const code   = params.get('code');
  const error  = params.get('error');

  if (error) {
    showScreen('screen-login');
    alert('Spotify login was cancelled or failed: ' + error);
    return;
  }

  if (code) {
    // Clean the ?code= from the URL bar immediately
    window.history.replaceState({}, document.title, window.location.pathname);
    try {
      state.accessToken = await exchangeToken(code);
      // Fetch the user's own Spotify ID so we can flag playlists they don't own
      const me = await spotifyFetch('GET', '/me');
      state.userId = me.id;
      showScreen('screen-playlists');
      await loadPlaylists();
    } catch (err) {
      showScreen('screen-login');
      alert('Could not get Spotify token: ' + err.message);
    }
    return;
  }

  showScreen('screen-login');
}

/* ═══════════════════════════════════════════════════════════════════════════
   PLAYLIST SCREEN
═══════════════════════════════════════════════════════════════════════════ */

function renderPlaylistGrid(playlists) {
  const grid = $('playlist-grid');
  if (playlists.length === 0) {
    grid.innerHTML = '<p class="loading-msg">No playlists match your search.</p>';
    return;
  }
  grid.innerHTML = '';
  playlists.forEach(pl => {
    const img  = pl.images && pl.images[0] ? pl.images[0].url : null;
    const card = document.createElement('div');
    card.className = 'playlist-card';
    card.innerHTML = `
      ${img
        ? `<img src="${img}" alt="${escapeHtml(pl.name)}" />`
        : `<div class="playlist-placeholder">🎵</div>`}
      <div class="playlist-name">${escapeHtml(pl.name)}</div>
    `;
    card.addEventListener('click', () => selectPlaylist(pl));
    grid.appendChild(card);
  });
}

async function loadPlaylists() {
  const grid = $('playlist-grid');
  grid.innerHTML = '<p class="loading-msg">Loading your playlists…</p>';

  const searchInput = $('playlist-search');
  if (searchInput) searchInput.value = '';

  try {
    const collected = [];
    const BASE = 'https://api.spotify.com/v1';
    let path = '/me/playlists?limit=50';

    while (path) {
      const data = await spotifyFetch('GET', path);
      (data.items || []).filter(Boolean).forEach(pl => collected.push(pl));
      path = data.next ? data.next.slice(BASE.length) : null;
    }

    allPlaylists = collected;

    if (allPlaylists.length === 0) {
      grid.innerHTML = '<p class="loading-msg">No playlists found.</p>';
      return;
    }

    renderPlaylistGrid(allPlaylists);
  } catch (err) {
    grid.innerHTML = `<p class="loading-msg">Error loading playlists: ${err.message}</p>`;
  }
}

function selectPlaylist(playlist) {
  state.playlistUri     = 'spotify:playlist:' + playlist.id;
  state.playlistStarted = false;
  showScreen('screen-setup');
  renderPlayerInputs(state.playerCount);
}

/* ═══════════════════════════════════════════════════════════════════════════
   PLAYER SETUP SCREEN
═══════════════════════════════════════════════════════════════════════════ */

function renderPlayerInputs(n) {
  const container = $('player-names');
  container.innerHTML = '';
  for (let i = 1; i <= n; i++) {
    const row = document.createElement('div');
    row.className = 'player-input-row';
    row.innerHTML = `
      <div class="player-num">${i}</div>
      <input type="text" placeholder="Player ${i}'s name" id="pname-${i}" autocomplete="off" />
    `;
    container.appendChild(row);
  }
  $('player-count-display').textContent = n;
}

/* ═══════════════════════════════════════════════════════════════════════════
   GAME SCREEN
═══════════════════════════════════════════════════════════════════════════ */

function renderGameUI() {
  const player = state.players[state.currentPlayerIndex];
  $('current-player-label').textContent = `${player.name}'s turn`;
  updateTokenBar();
  resetSongCard();
}

function updateTokenBar() {
  $('token-bar').innerHTML = state.players.map((p, i) => `
    <div class="token-chip ${i === state.currentPlayerIndex ? 'active-player' : ''}">
      <span>${escapeHtml(p.name)}</span>
      <span class="token-coins">🪙 ${p.tokens}</span>
    </div>
  `).join('');
}

function renderPostRevealActions() {
  const panel = $('post-reveal-actions');
  if (!panel) return;

  const currentPlayer = state.players[state.currentPlayerIndex];

  let html = `
    <div class="pra-correct">
      <span class="pra-label">Did <strong>${escapeHtml(currentPlayer.name)}</strong> guess correctly?</span>
      <button class="btn btn-green pra-btn" onclick="App.markCorrect(this)">✓ Yes — +1 token</button>
    </div>
  `;

  const others = state.players
    .map((p, i) => ({ p, i }))
    .filter(({ i }) => i !== state.currentPlayerIndex);

  if (others.length > 0) {
    html += `<div class="pra-others"><span class="pra-label">Others — use a token:</span>`;
    others.forEach(({ p, i }) => {
      html += `
        <button class="btn btn-dim pra-btn pra-other-btn" ${p.tokens <= 0 ? 'disabled' : ''}
                onclick="App.spendToken(${i}, this)">
          ${escapeHtml(p.name)} 🪙 ${p.tokens}
        </button>
      `;
    });
    html += `</div>`;
  }

  panel.innerHTML = html;
  panel.classList.remove('hidden');
}

function resetSongCard() {
  const card = $('song-card');
  card.classList.remove('revealed');
  card.classList.add('mystery');
  $('btn-reveal').classList.remove('hidden');
  $('btn-next').classList.add('hidden');
  $('btn-play-pause').textContent = state.isPlaying ? '⏸ Pause' : '▶ Play';
  state.revealed = false;
  const panel = $('post-reveal-actions');
  if (panel) { panel.innerHTML = ''; panel.classList.add('hidden'); }
}

function showDeviceWarning() {
  $('device-warning').classList.remove('hidden');
}

async function playCurrentSong() {
  try {
    const devData = await spotifyFetch('GET', '/me/player/devices');
    const devices = devData.devices || [];
    const device  = devices.find(d => d.is_active) || devices[0];

    if (!device) { showDeviceWarning(); return; }
    state.deviceId = device.id;

    if (!state.playlistStarted) {
      // First play: start the chosen playlist with shuffle
      await spotifyFetch('PUT', `/me/player/play?device_id=${state.deviceId}`, {
        context_uri: state.playlistUri,
      });
      await spotifyFetch('PUT', `/me/player/shuffle?state=true&device_id=${state.deviceId}`);
      state.playlistStarted = true;
    } else {
      // Subsequent plays: resume (no body = resume current position)
      await spotifyFetch('PUT', `/me/player/play?device_id=${state.deviceId}`);
    }

    state.isPlaying = true;
    $('btn-play-pause').textContent = '⏸ Pause';
    $('device-warning').classList.add('hidden');
  } catch (err) {
    console.error('Play error:', err);
    showDeviceWarning();
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   App — exposed to HTML onclick attributes
═══════════════════════════════════════════════════════════════════════════ */

const App = {
  login: startLogin,

  logout() {
    state.accessToken = '';
    state.userId = '';
    state.tracks = [];
    showScreen('screen-login');
    startLogin();
  },

  changePlayerCount(delta) {
    const next = Math.max(2, Math.min(10, state.playerCount + delta));
    state.playerCount = next;
    renderPlayerInputs(next);
  },

  filterPlaylists() {
    const query = ($('playlist-search')?.value ?? '').trim().toLowerCase();
    const filtered = query
      ? allPlaylists.filter(pl => pl.name.toLowerCase().includes(query))
      : allPlaylists;
    renderPlaylistGrid(filtered);
  },

  backToPlaylists() {
    state.playlistUri     = '';
    state.playlistStarted = false;
    state.currentPlayerIndex = 0;
    state.currentTrackIndex  = 0;
    showScreen('screen-playlists');
    loadPlaylists();
  },

  startGame() {
    if (!state.playlistUri) {
      alert('Please choose a playlist first.');
      return;
    }
    const players = [];
    for (let i = 1; i <= state.playerCount; i++) {
      const input = $(`pname-${i}`);
      players.push({ name: input?.value.trim() || `Player ${i}`, tokens: 3 });
    }
    state.players = players;
    state.currentPlayerIndex = 0;
    state.currentTrackIndex  = 0;
    state.playlistStarted    = false;
    state.isPlaying          = false;

    showScreen('screen-game');
    renderGameUI();
    playCurrentSong();
  },

  async reveal() {
    if (state.revealed) return;
    state.revealed = true;

    try {
      const data  = await spotifyFetch('GET', '/me/player/currently-playing');
      const track = data?.item;
      $('reveal-year').textContent   = track ? (track.album?.release_date || '????').slice(0, 4) : '????';
      $('reveal-title').textContent  = track?.name ?? 'Unknown';
      $('reveal-artist').textContent = track ? track.artists.map(a => a.name).join(', ') : '';
    } catch (err) {
      $('reveal-year').textContent   = '????';
      $('reveal-title').textContent  = 'Unknown';
      $('reveal-artist').textContent = '';
    }

    $('song-card').classList.remove('mystery');
    $('song-card').classList.add('revealed');
    $('btn-reveal').classList.add('hidden');
    $('btn-next').classList.remove('hidden');
    renderPostRevealActions();
  },

  async nextPlayer() {
    try {
      await spotifyFetch('POST', `/me/player/next?device_id=${state.deviceId}`);
      await new Promise(r => setTimeout(r, 700));
    } catch (err) {
      console.error('Skip error:', err);
    }
    state.currentPlayerIndex = (state.currentPlayerIndex + 1) % state.players.length;
    state.currentTrackIndex++;
    state.revealed  = false;
    state.isPlaying = true;
    $('btn-play-pause').textContent = '⏸ Pause';
    renderGameUI();
  },

  async togglePlayPause() {
    try {
      if (state.isPlaying) {
        await spotifyFetch('PUT', '/me/player/pause');
        state.isPlaying = false;
        $('btn-play-pause').textContent = '▶ Play';
      } else {
        await spotifyFetch('PUT', '/me/player/play?device_id=' + state.deviceId);
        state.isPlaying = true;
        $('btn-play-pause').textContent = '⏸ Pause';
      }
    } catch (err) {
      console.error('togglePlayPause error:', err.message);
      showDeviceWarning();
    }
  },

  async useToken() {
    const player = state.players[state.currentPlayerIndex];
    if (player.tokens <= 0) { alert(`${player.name} has no tokens left!`); return; }
    if (!confirm(`Use one of ${player.name}'s tokens to skip this song?`)) return;

    player.tokens--;
    state.currentTrackIndex++;
    updateTokenBar();
    resetSongCard();

    try {
      await spotifyFetch('POST', `/me/player/next?device_id=${state.deviceId}`);
      await new Promise(r => setTimeout(r, 700));
      state.isPlaying = true;
      $('btn-play-pause').textContent = '⏸ Pause';
    } catch (err) {
      console.error('Skip error:', err);
      showDeviceWarning();
    }
  },

  retryDevice() {
    $('device-warning').classList.add('hidden');
    playCurrentSong();
  },

  // Current player guessed correctly — award +1 token
  markCorrect(btn) {
    state.players[state.currentPlayerIndex].tokens++;
    updateTokenBar();
    btn.disabled = true;
    btn.textContent = '✓ Token awarded!';
  },

  // Another player spends a token to claim/attack
  spendToken(playerIndex, btn) {
    const player = state.players[playerIndex];
    if (player.tokens <= 0) return;
    player.tokens--;
    updateTokenBar();
    btn.disabled = true;
    btn.textContent = `${escapeHtml(player.name)} 🪙 ${player.tokens} (used)`;
  },
};

/* ═══════════════════════════════════════════════════════════════════════════
   UTILITIES
═══════════════════════════════════════════════════════════════════════════ */

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ── Boot ─────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', init);
