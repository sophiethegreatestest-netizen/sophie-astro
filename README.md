# ISS Tracker

A Flask website that tracks the ISS in real time using actual orbital
mechanics (Skyfield + live TLE data from Celestrak) — not a mocked API.

## What it does

- **Live position**: current ISS latitude/longitude/altitude/speed, refreshed
  every 5 seconds, plotted on a world map.
- **Click anywhere on the map** to drop a pin — everything on the left
  (next pass time, "Tonight"/date, visible duration, max altitude, upcoming
  pass list) recalculates for that exact spot, computed from real orbital
  propagation (not canned data).
- **Search Location** bar geocodes a place name (via OpenStreetMap Nominatim,
  no API key needed) and does the same lookup.
- **View Fullscreen** button makes the whole app fill the browser viewport.
- **"Last updated"** ticks live: "now" → "X sec ago" → "X min ago" →
  "X hrs ago", based on the last successful data refresh.

## Run locally

```bash
python -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Then open http://localhost:5000

## Deploy on Railway

1. Push this folder to a GitHub repo.
2. In Railway, "New Project" → "Deploy from GitHub repo".
3. Railway will detect `Procfile` and `requirements.txt` automatically and
   run `gunicorn app:app`.
4. No environment variables or API keys are required — TLE data comes from
   Celestrak (public, no key) and geocoding from Nominatim (public, no key).

## How pass predictions work

- Orbital elements (TLE) are pulled from Celestrak and cached for 2 hours.
- For a given lat/lon, Skyfield computes rise/culminate/set events over the
  next 5 days for any pass where the ISS gets at least 10° above the horizon.
- Times shown to the user are converted to the **local timezone of the
  clicked location** (via `timezonefinder`), not your browser's timezone.

One simplification worth knowing: passes are "above 10° elevation," not
strictly "naked-eye visible" (which would also require the ISS to be sunlit
while the ground location is dark). If you want that stricter definition
later, it's a moderate addition to `app.py` using Skyfield's `almanac` module.

## File structure

```
app.py                  Flask app + all API routes
requirements.txt
Procfile                 for Railway/Heroku-style deploys
templates/index.html
static/css/style.css
static/js/script.js      map rendering, click handling, polling, fullscreen
```
