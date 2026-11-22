---
title: Duck
sdk: docker
app_port: 7860
---

# Duck

Duck is a self-hosted arcade, movie library and web browser. The homepage shows the Duck wordmark and pond artwork. Enter a URL or DuckDuckGo search there to open it with Scramjet v2. The navigation opens the Games and Movies libraries.

## Run locally

On Windows, double-click `start-windows.bat`. With Node.js 22.13 or newer, you can also start it from a terminal.

```sh
npm ci
npm start
```

Open [Duck](http://127.0.0.1:8080/). The default server listens on your computer’s loopback interface.

## Games

Games opens a searchable, paged catalog. Choose a library, search by title or sort alphabetically. Each title has its own shareable player URL. Back returns to your results, and the version selector changes libraries when they carry the same title.

The bundled snapshot contains 5,167 community entries from GN-Math, Chicken King’s Vault, Truffled and Ultimate Game Stash. The project includes 5,146 HTML launch documents in compressed packs. The other 21 entries link to the publisher named by Truffled. The ten built-in games run locally. Imported games can fetch art, scripts, audio and other assets from the original hosts. GameArter and GameZipper supply additional game listings at runtime.

## Movies

Movies opens a searchable catalog of 389 feature-length films and the original three trailer listings. Full films have the same four playback options (Archive stream, Primary server, Backup server and Archive player). The Internet Archive assigns the two storage servers for each film. The bundled catalog uses 316 distinct storage hosts. Duck remembers the selected option for the next film and keeps your position when switching between MP4 streams. Trailers are labeled separately.

The movie catalog stores metadata and playable URLs. Video streams from the selected source. The importer checks the media headers, byte ranges and archive player before saving an entry.

## Refresh the bundled catalogs

The normal start command uses the included snapshots. These commands rebuild and verify them.

```sh
npm run catalog:refresh
python scripts/import-game-documents.py
npm run movies:refresh
npm run check
npm run verify:games
```

The game packer uses Python 3 and accepts `--cache-dir PATH` to keep source archives between imports. Include `data/` when copying the project or deploying it. Restart the server after replacing bundled data.

## Deploy on Render

Use the existing `render.yaml` service, include the game packs and movie catalog, and set `DUCK_PASSWORD` to at least 12 characters. The service needs HTTPS for its session cookie and service worker. Duck requires a password on a public interface. Search providers and game or movie hosts may require human verification or restrict playback on a particular network.

