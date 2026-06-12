# SONG — Tamil devotional sanger i raga Mohanam

Prosjekt for å lage sanger av to tamilske Shiva-bhakti-tekster
(Vattūr-tempelets vognfestival): «சித்திரத் தேரேறினாய் சிவனே» og
«ஒருபா ஒரு பஃது».

## Innhold

| Fil | Hva |
|---|---|
| `lyrics/01-chithirath-ther-erinaai.txt` | Tekst 1 (refreng-sang) |
| `lyrics/02-orupa-orupahthu.txt` | Tekst 2 (venba-syklus, 10 vers) |
| `style-prompt.txt` | Stil-prompt (engelsk) for musikk-API-er |
| `generate_song.py` | Sender tekst + stil til fal.ai eller ElevenLabs, laster ned MP3 |
| `sketch_mohanam.py` | Lokal instrumentalskisse (ingen API-nøkkel nødvendig) |

## Spor 1: Ekte sang via API (krever nøkkel)

```bash
# fal.ai (ACE-Step, støtter tekst + stil): https://fal.ai/dashboard/keys
export FAL_KEY=...
python3 generate_song.py --provider fal \
    --lyrics lyrics/01-chithirath-ther-erinaai.txt --out output/song1.mp3

# ElevenLabs Music: https://elevenlabs.io
export ELEVENLABS_API_KEY=...
python3 generate_song.py --provider elevenlabs \
    --lyrics lyrics/01-chithirath-ther-erinaai.txt --out output/song1.mp3
```

Suno har ikke offisielt API; tredjeparts-wrappere finnes og kan kobles
inn ved å tilpasse `request_fal()` i `generate_song.py`.

## Spor 2: Lokal instrumentalskisse (fungerer nå)

```bash
pip install numpy lameenc   # lameenc er valgfri (MP3)
python3 sketch_mohanam.py   # -> output/mohanam_sketch.wav/.mp3
```

Programmerte toner i Mohanam-skala (S R2 G3 P D2): tanpura-drone,
nadaswaram-aktig melodistemme med gamaka-glidninger og thavil-aktig
adi tala-rytme. En skisse av stemningen — ikke ekte vokal/nadaswaram.
