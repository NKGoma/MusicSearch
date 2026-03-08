# MusicSearch — Claude Code Instructions

## Git workflow (REQUIRED on every push)

The working branch is `claude/music-timeline-game-c76ZC`.
Local branch `main` is configured to track it.

**Before every push, always run:**
```
git pull --rebase origin claude/music-timeline-game-c76ZC
```
Then push with:
```
git push origin HEAD:claude/music-timeline-game-c76ZC
```

This prevents the "non-fast-forward" rejection that happens after PRs are merged on GitHub.

## Cache busting

- `app.js` uses `?v=N` in index.html — increment N on every change to app.js
- `style.css` uses `?v=N` in index.html — increment N on every change to style.css

Current versions: style.css?v=2, app.js?v=12

## Project structure

- `index.html` — all screens (login, playlists, setup, game)
- `style.css` — all styles, design tokens at the top of `:root {}`
- `app.js` — Spotify PKCE auth, game logic, `App` object wired to onclick attributes
