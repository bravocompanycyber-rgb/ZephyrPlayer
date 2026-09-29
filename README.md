# ZephyrPlayer 2.5

Local desktop media player. **No accounts. No required online APIs.**

**Support:** bravocompanycyber@gmail.com

## Run

```cmd
npm install
npm start
```

## Local engines (optional but recommended)

Place next to the app folder:

| File | Purpose |
|------|---------|
| `mpv.exe` | Full codecs, quality, audio devices |
| `yt-dlp.exe` | YouTube / HTTP streams |
| `shaders/*.glsl` | Anime4K |
| `whisper-cli.exe` | Local speech-to-text |
| `models/ggml-base.bin` | Whisper model (or tiny/small/medium) |

## Removed online services

- OpenSubtitles in-app search — removed
- TMDB metadata / posters — removed

## License

See `LICENSE.txt` and `THIRD_PARTY_NOTICES.txt`.
