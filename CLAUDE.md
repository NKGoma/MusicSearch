# MusicSearch — Claude Code Instructions

## Git workflow (REQUIRED)

Always work on the `claude/music-timeline-game-c76ZC` branch — never commit to `main`.

```bash
# Before starting work, make sure the branch is current:
git pull origin claude/music-timeline-game-c76ZC

# Commit normally, then push:
git push -u origin claude/music-timeline-game-c76ZC
```

`main` tracks `origin/main` and must never be committed to directly.
If you find yourself on `main`, switch back: `git checkout claude/music-timeline-game-c76ZC`

## Cache busting

- `app.js` uses `?v=N` in index.html — increment N on every change to app.js
- `style.css` uses `?v=N` in index.html — increment N on every change to style.css

Current versions: style.css?v=2, app.js?v=13

## Project structure

- `index.html` — all screens (login, playlists, setup, game)
- `style.css` — all styles, design tokens at the top of `:root {}`
- `app.js` — Spotify PKCE auth, game logic, `App` object wired to onclick attributes
