/* ═══════════════════════════════════════════════════════════════════════════
   Norster — frontend game logic
   All game state lives in the `state` object below.
═══════════════════════════════════════════════════════════════════════════ */

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

// ── Screen helpers ────────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function $(id) { return document.getElementById(id); }

// ── Spotify API calls (go through our Express proxy) ─────────────────────────
async function api(method, path, body) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + state.accessToken,
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

// ── Initialise: called on page load ──────────────────────────────────────────
async function init() {
  // Check if Spotify just sent us back a token in the URL
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');

  if (token) {
    state.accessToken = token;
    // Clean the token from the URL bar (tidier UX)
    window.history.replaceState({}, document.title, '/');
    showScreen('screen-playlists');
    await loadPlaylists();
  } else {
    showScreen('screen-login');
  }
}

// ── Playlist screen ───────────────────────────────────────────────────────────
async function loadPlaylists() {
  const grid = $('playlist-grid');
  grid.innerHTML = '<p class="loading-msg">Loading your playlists…</p>';

  try {
    const data = await api('GET', '/api/playlists');
    const playlists = (data.items || []).filter(p => p); // remove nulls

    if (playlists.length === 0) {
      grid.innerHTML = '<p class="loading-msg">No playlists found. Make sure you have at least one playlist on Spotify.</p>';
      return;
    }

    grid.innerHTML = '';
    playlists.forEach(pl => {
      const img = pl.images && pl.images[0] ? pl.images[0].url : null;
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
  // Load tracks in the background while we move to setup screen
  showScreen('screen-setup');
  renderPlayerInputs(state.playerCount);

  // Fetch & shuffle tracks
  try {
    const data = await api('GET', `/api/playlist/${playlist.id}/tracks`);
    const items = (data.items || []).filter(i => i && i.track && i.track.uri);
    state.tracks = shuffle(items.map(i => ({
      title:    i.track.name,
      artist:   i.track.artists.map(a => a.name).join(', '),
      year:     (i.track.album.release_date || '????').slice(0, 4),
      uri:      i.track.uri,
      albumArt: i.track.album.images && i.track.album.images[0] ? i.track.album.images[0].url : null,
    })));
  } catch (err) {
    alert('Could not load tracks: ' + err.message);
  }
}

// ── Player setup screen ───────────────────────────────────────────────────────
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

// Exposed to HTML buttons
const App = {
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
    // Collect player names
    const players = [];
    for (let i = 1; i <= state.playerCount; i++) {
      const input = $(`pname-${i}`);
      const name = input ? input.value.trim() || `Player ${i}` : `Player ${i}`;
      players.push({ name, tokens: 3 });
    }

    if (state.tracks.length === 0) {
      alert('Tracks are still loading — please wait a moment and try again.');
      return;
    }

    state.players = players;
    state.currentPlayerIndex = 0;
    state.currentTrackIndex = 0;
    state.revealed = false;
    state.isPlaying = false;

    showScreen('screen-game');
    renderGameUI();
    playCurrentSong();
  },

  async reveal() {
    if (state.revealed) return;
    state.revealed = true;

    const track = state.tracks[state.currentTrackIndex];
    $('reveal-year').textContent = track.year;
    $('reveal-title').textContent = track.title;
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
    state.revealed = false;
    state.isPlaying = false;

    if (state.currentTrackIndex >= state.tracks.length) {
      alert('No more songs in the playlist! Going back to the start.');
      state.currentTrackIndex = 0;
      state.tracks = shuffle(state.tracks);
    }

    renderGameUI();
    playCurrentSong();
  },

  async togglePlayPause() {
    try {
      if (state.isPlaying) {
        await api('POST', '/api/pause');
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
    if (player.tokens <= 0) {
      alert(`${player.name} has no tokens left!`);
      return;
    }
    if (!confirm(`Use one of ${player.name}'s tokens to skip this song?`)) return;

    player.tokens--;
    updateTokenBar();

    // Skip to next track (same player's turn)
    state.currentTrackIndex++;
    state.revealed = false;
    state.isPlaying = false;

    if (state.currentTrackIndex >= state.tracks.length) {
      state.currentTrackIndex = 0;
      state.tracks = shuffle(state.tracks);
    }

    resetSongCard();
    playCurrentSong();
  },

  async retryDevice() {
    $('device-warning').classList.add('hidden');
    await playCurrentSong();
  },
};

// ── Game UI helpers ───────────────────────────────────────────────────────────
function renderGameUI() {
  const player = state.players[state.currentPlayerIndex];
  $('current-player-label').textContent = `${player.name}'s turn`;

  updateTokenBar();
  resetSongCard();
}

function updateTokenBar() {
  const bar = $('token-bar');
  bar.innerHTML = state.players.map((p, i) => `
    <div class="token-chip ${i === state.currentPlayerIndex ? 'active-player' : ''}">
      <span>${p.name}</span>
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
}

function showDeviceWarning() {
  $('device-warning').classList.remove('hidden');
}

// ── Spotify playback ──────────────────────────────────────────────────────────
async function playCurrentSong() {
  const track = state.tracks[state.currentTrackIndex];
  if (!track) return;

  try {
    // Find an active device first
    const devData = await api('GET', '/api/devices');
    const devices = devData.devices || [];
    const device = devices.find(d => d.is_active) || devices[0];

    if (!device) {
      showDeviceWarning();
      return;
    }

    state.deviceId = device.id;

    await api('POST', '/api/play', { uri: track.uri, deviceId: state.deviceId });
    state.isPlaying = true;
    $('btn-play-pause').textContent = '⏸ Pause';
    $('device-warning').classList.add('hidden');
  } catch (err) {
    console.error('Play error:', err);
    showDeviceWarning();
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────
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

// ── Boot ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
