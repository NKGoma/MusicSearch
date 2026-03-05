require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || 'http://localhost:3000/callback';
const PORT = process.env.PORT || 3000;

const SCOPES = [
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-read-playback-state',
  'user-modify-playback-state',
].join(' ');

// ── OAuth: redirect user to Spotify login ─────────────────────────────────────
app.get('/login', (req, res) => {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    scope: SCOPES,
    redirect_uri: REDIRECT_URI,
  });
  res.redirect('https://accounts.spotify.com/authorize?' + params.toString());
});

// ── OAuth: Spotify sends user back here with a code ───────────────────────────
app.get('/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.send('Error: no code from Spotify');

  try {
    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization:
          'Basic ' +
          Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64'),
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
      }),
    });

    const data = await tokenRes.json();
    if (data.error) return res.send('Spotify error: ' + data.error_description);

    // Pass token to the frontend via URL hash (never stored server-side)
    res.redirect('/?token=' + data.access_token);
  } catch (err) {
    console.error(err);
    res.send('Server error during token exchange');
  }
});

// ── Helper: forward a Spotify API call on behalf of the frontend ──────────────
async function spotifyAPI(token, method, path, body) {
  const opts = {
    method,
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch('https://api.spotify.com/v1' + path, opts);
  if (res.status === 204) return {};         // Spotify returns 204 for play/pause
  return res.json();
}

// ── API proxy routes ──────────────────────────────────────────────────────────

// List current user's playlists (up to 50)
app.get('/api/playlists', async (req, res) => {
  try {
    const data = await spotifyAPI(req.headers.authorization?.split(' ')[1], 'GET', '/me/playlists?limit=50');
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get tracks from a playlist (up to 100)
app.get('/api/playlist/:id/tracks', async (req, res) => {
  try {
    const data = await spotifyAPI(
      req.headers.authorization?.split(' ')[1],
      'GET',
      `/playlists/${req.params.id}/tracks?limit=100&fields=items(track(name,uri,artists,album(release_date,images)))`
    );
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get available Spotify devices
app.get('/api/devices', async (req, res) => {
  try {
    const data = await spotifyAPI(req.headers.authorization?.split(' ')[1], 'GET', '/me/player/devices');
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Play a specific track on a device
app.post('/api/play', async (req, res) => {
  const { uri, deviceId } = req.body;
  try {
    const endpoint = deviceId ? `/me/player/play?device_id=${deviceId}` : '/me/player/play';
    await spotifyAPI(req.headers.authorization?.split(' ')[1], 'PUT', endpoint, {
      uris: [uri],
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Pause playback
app.post('/api/pause', async (req, res) => {
  try {
    await spotifyAPI(req.headers.authorization?.split(' ')[1], 'PUT', '/me/player/pause');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Start server ──────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('');
  console.log('🎵  Norster is running!');
  console.log(`👉  Open http://localhost:${PORT} in your browser`);
  console.log('');
});
