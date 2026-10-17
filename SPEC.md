# Sonora Music - Shared Architecture Specification

## Namespace Pattern
All JS modules attach to `window.Sonora`:
```js
(function(){
  const Sonora = window.Sonora = window.Sonora || {};
  Sonora.ModuleName = { ... };
})();
```

## Data Models
```
Track: { id, title, artist, album, albumId, artistId, duration, artworkUrl, sourceUrl, filePath, isFavorite, playCount, lastPlayed, dateAdded, genre, year, trackNumber, lyrics, isDownloaded }
Album: { id, title, artist, artistId, artworkUrl, year, genre, trackCount }
Artist: { id, name, imageUrl, bio, trackCount, albumCount }
Playlist: { id, name, description, artworkUrl, trackIds, createdAt, updatedAt, isCollaborative }
Mix: { id, name, description, artworkUrl, trackIds, type, genre, mood }
```

## Module APIs

### Store (Sonora.Store)
- get(key), set(key, value), subscribe(key, cb), on(event, cb), emit(event, data)

### Router (Sonora.Router)
- navigate(path), on(path, handler), getParam(name), getCurrentPath()

### DB (Sonora.DB)
- init(), tracks.getAll/getById/add/search/getByGenre/getFavorites/getMostPlayed/getRecent
- albums.getAll/getById, artists.getAll/getById
- playlists.getAll/getById/create/update/delete/addTrack/removeTrack
- mixes.getAll/getById
- history.add/getRecent
- downloads.save/get/getAll/delete
- settings.get/set

### Player (Sonora.Player)
- play(track), pause(), resume(), toggle(), next(), previous()
- seek(s), seekPercent(0-1), setVolume(0-1)
- toggleShuffle(), cycleRepeat()
- setQueue(tracks, idx), addToQueue(track), getQueue()
- getCurrentTrack(), isPlaying(), getProgress()
- getAnalyser() -> AnalyserNode

### Themes (Sonora.Themes)
- setTheme(id), getTheme(), setFontSize(s), setDarkMode(m), setCustomBg(url), extractDominantColor(url)
- Theme IDs: system, blue, coral, purple, green, gray, orange, pink

### Pages Pattern
```
Sonora.Pages.PageName = { render(), init(), destroy() }
```

## CSS Classes
- .page, .page-{name}, .section, .section__title, .section__content
- .card, .track-item, .btn, .btn--primary, .btn--icon
- .hidden, .active, .loading

## Color Palette (Coral default)
- Primary: #FF4757, Secondary: #FF6B35, Tertiary: #FF3E2E
- Surface Light: #FFFFFF, Surface Dark: #1a1a2e
- Background Light: #F5F5F5, Background Dark: #121212
