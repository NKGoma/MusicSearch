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
].join(' ');

/* ── Game state ─────────────────────────────────────────────────────────── */
const state = {
  accessToken: '',
  players: [],            // [{ name, tokens }]
  currentPlayerIndex: 0,
  tracks: [],             // shuffled [{title, artist, year, uri, albumArt}]
  currentTrackIndex: 0,
  revealed: false,
  isPlaying: false,
  deviceId: '',
  playerCount: 2,
};

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
  return data.access_token;
}

/* ═══════════════════════════════════════════════════════════════════════════
   SPOTIFY API — direct browser calls (no proxy needed)
═══════════════════════════════════════════════════════════════════════════ */

async function spotifyFetch(method, path, body) {
  const opts = {
    method,
    headers: {
      Authorization: 'Bearer ' + state.accessToken,
      'Content-Type': 'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch('https://api.spotify.com/v1' + path, opts);
  if (res.status === 204) return {};
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
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

async function loadPlaylists() {
  const grid = $('playlist-grid');
  grid.innerHTML = '<p class="loading-msg">Loading your playlists…</p>';

  try {
    const data = await spotifyFetch('GET', '/me/playlists?limit=50');
    const playlists = (data.items || []).filter(Boolean);

    if (playlists.length === 0) {
      grid.innerHTML = '<p class="loading-msg">No playlists found.</p>';
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
  } catch (err) {
    grid.innerHTML = `<p class="loading-msg">Error loading playlists: ${err.message}</p>`;
  }
}

async function selectPlaylist(playlist) {
  showScreen('screen-setup');
  renderPlayerInputs(state.playerCount);

  try {
    const data  = await spotifyFetch('GET',
      `/playlists/${playlist.id}/tracks?limit=100&fields=items(track(name,uri,artists,album(release_date,images)))`
    );
    const items = (data.items || []).filter(i => i && i.track && i.track.uri);
    state.tracks = shuffle(items.map(i => ({
      title:    i.track.name,
      artist:   i.track.artists.map(a => a.name).join(', '),
      year:     (i.track.album.release_date || '????').slice(0, 4),
      uri:      i.track.uri,
      albumArt: i.track.album.images?.[0]?.url ?? null,
    })));
  } catch (err) {
    alert('Could not load tracks: ' + err.message);
  }
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

function resetSongCard() {
  const card = $('song-card');
  card.classList.remove('revealed');
  card.classList.add('mystery');
  $('btn-reveal').classList.remove('hidden');
  $('btn-next').classList.add('hidden');
  $('btn-play-pause').textContent = '⏸ Pause';
  state.revealed = false;
}

function showDeviceWarning() {
  $('device-warning').classList.remove('hidden');
}

async function playCurrentSong() {
  const track = state.tracks[state.currentTrackIndex];
  if (!track) return;

  try {
    const devData = await spotifyFetch('GET', '/me/player/devices');
    const devices = devData.devices || [];
    const device  = devices.find(d => d.is_active) || devices[0];

    if (!device) { showDeviceWarning(); return; }

    state.deviceId = device.id;
    await spotifyFetch('PUT', `/me/player/play?device_id=${state.deviceId}`, { uris: [track.uri] });
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

  changePlayerCount(delta) {
    const next = Math.max(2, Math.min(10, state.playerCount + delta));
    state.playerCount = next;
    renderPlayerInputs(next);
  },

  backToPlaylists() {
    state.tracks = [];
    state.currentTrackIndex = 0;
    showScreen('screen-playlists');
    loadPlaylists();
  },

  startGame() {
    if (state.tracks.length === 0) {
      alert('Tracks are still loading — please wait a moment and try again.');
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
    state.isPlaying = false;

    showScreen('screen-game');
    renderGameUI();
    playCurrentSong();
  },

  reveal() {
    if (state.revealed) return;
    state.revealed = true;

    const track = state.tracks[state.currentTrackIndex];
    $('reveal-year').textContent   = track.year;
    $('reveal-title').textContent  = track.title;
    $('reveal-artist').textContent = track.artist;

    const card = $('song-card');
    card.classList.remove('mystery');
    card.classList.add('revealed');

    $('btn-reveal').classList.add('hidden');
    $('btn-next').classList.remove('hidden');
  },

  nextPlayer() {
    state.currentPlayerIndex = (state.currentPlayerIndex + 1) % state.players.length;
    state.currentTrackIndex++;
    if (state.currentTrackIndex >= state.tracks.length) {
      state.currentTrackIndex = 0;
      state.tracks = shuffle(state.tracks);
    }
    renderGameUI();
    playCurrentSong();
  },

  async togglePlayPause() {
    try {
      if (state.isPlaying) {
        await spotifyFetch('PUT', '/me/player/pause');
        state.isPlaying = false;
        $('btn-play-pause').textContent = '▶ Play';
      } else {
        await playCurrentSong();
      }
    } catch (err) {
      showDeviceWarning();
    }
  },

  useToken() {
    const player = state.players[state.currentPlayerIndex];
    if (player.tokens <= 0) { alert(`${player.name} has no tokens left!`); return; }
    if (!confirm(`Use one of ${player.name}'s tokens to skip this song?`)) return;

    player.tokens--;
    updateTokenBar();
    state.currentTrackIndex++;
    if (state.currentTrackIndex >= state.tracks.length) {
      state.currentTrackIndex = 0;
      state.tracks = shuffle(state.tracks);
    }
    resetSongCard();
    playCurrentSong();
  },

  retryDevice() {
    $('device-warning').classList.add('hidden');
    playCurrentSong();
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
