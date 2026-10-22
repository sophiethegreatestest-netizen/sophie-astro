"""
ISS Tracker - Flask backend

Real orbital mechanics via Skyfield (no mocked/fake data):
  - /api/current            -> current ISS lat/lon/altitude/speed
  - /api/passes?lat=&lon=   -> upcoming passes for a given point on Earth
  - /api/search?q=          -> geocode a place name to lat/lon (OpenStreetMap Nominatim)

TLE (orbital element) data is fetched from Celestrak and cached in memory,
refreshed every 2 hours. If the fetch fails and we have no cached TLE yet,
the API returns a 503 rather than inventing fake orbital data.
"""
import time
import threading
from datetime import timedelta

import requests
from flask import Flask, jsonify, render_template, request
from skyfield.api import load, wgs84, EarthSatellite
from timezonefinder import TimezoneFinder
from zoneinfo import ZoneInfo

app = Flask(__name__)

TLE_URL = "https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE"
TLE_REFRESH_SECONDS = 2 * 60 * 60  # refresh every 2 hours

ts = load.timescale()
tf = TimezoneFinder()

_tle_lock = threading.Lock()
_satellite = None
_tle_last_fetch = 0
_tle_last_error = None


def get_satellite():
    """Return a cached EarthSatellite, refreshing from Celestrak periodically."""
    global _satellite, _tle_last_fetch, _tle_last_error
    with _tle_lock:
        stale = (time.time() - _tle_last_fetch) > TLE_REFRESH_SECONDS
        if _satellite is None or stale:
            try:
                resp = requests.get(TLE_URL, timeout=10)
                resp.raise_for_status()
                lines = [l for l in resp.text.strip().splitlines() if l.strip()]
                name, line1, line2 = lines[0], lines[1], lines[2]
                _satellite = EarthSatellite(line1, line2, name, ts)
                _tle_last_fetch = time.time()
                _tle_last_error = None
            except Exception as exc:  # noqa: BLE001
                _tle_last_error = str(exc)
                if _satellite is None:
                    raise
                # keep serving the stale satellite object rather than fail outright
        return _satellite


def format_pass(rise_dt_utc, duration_min, max_alt_deg, tz_name):
    """Turn a UTC rise time into the date/time labels the UI displays."""
    local_tz = ZoneInfo(tz_name) if tz_name else ZoneInfo("UTC")
    local_dt = rise_dt_utc.astimezone(local_tz)
    today_local = ts.now().utc_datetime().astimezone(local_tz).date()
    delta_days = (local_dt.date() - today_local).days
    if delta_days == 0:
        date_label = "Tonight" if local_dt.hour >= 17 else "Today"
    elif delta_days == 1:
        date_label = "Tomorrow"
    else:
        date_label = local_dt.strftime("%b %-d") if hasattr(local_dt, "strftime") else str(local_dt.date())

    time_label = local_dt.strftime("%-I:%M %p") if hasattr(local_dt, "strftime") else ""

    return {
        "date_label": date_label,
        "time_label": time_label,
        "iso": local_dt.isoformat(),
        "duration_min": round(duration_min, 1),
        "max_altitude_deg": round(max_alt_deg, 1) if max_alt_deg is not None else None,
    }


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/current")
def api_current():
    try:
        sat = get_satellite()
    except Exception:  # noqa: BLE001
        return jsonify({"error": "Could not fetch ISS orbital data right now. Try again shortly."}), 503

    t = ts.now()
    geocentric = sat.at(t)
    subpoint = wgs84.subpoint(geocentric)

    vx, vy, vz = geocentric.velocity.km_per_s
    speed_km_s = (vx ** 2 + vy ** 2 + vz ** 2) ** 0.5
    speed_mph = speed_km_s * 2236.936292  # km/s -> mph

    return jsonify({
        "latitude": round(subpoint.latitude.degrees, 4),
        "longitude": round(subpoint.longitude.degrees, 4),
        "altitude_km": round(subpoint.elevation.km, 1),
        "speed_mph": round(speed_mph),
        "timestamp": t.utc_iso(),
    })


@app.route("/api/passes")
def api_passes():
    try:
        lat = float(request.args.get("lat"))
        lon = float(request.args.get("lon"))
    except (TypeError, ValueError):
        return jsonify({"error": "lat and lon query parameters are required"}), 400

    try:
        sat = get_satellite()
    except Exception:  # noqa: BLE001
        return jsonify({"error": "Could not fetch ISS orbital data right now. Try again shortly."}), 503

    observer = wgs84.latlon(lat, lon)
    difference = sat - observer

    t0 = ts.now()
    t1 = ts.tt_jd(t0.tt + 5)  # look ahead 5 days

    times, events = sat.find_events(observer, t0, t1, altitude_degrees=10.0)

    tz_name = tf.timezone_at(lat=lat, lng=lon) or "UTC"

    passes = []
    pending = {}
    for t, event in zip(times, events):
        if event == 0:  # rise
            pending = {"rise": t}
        elif event == 1:  # culminate (highest point)
            alt, az, dist = difference.at(t).altaz()
            pending["max_altitude_deg"] = alt.degrees
        elif event == 2:  # set
            if "rise" in pending:
                rise_dt = pending["rise"].utc_datetime()
                set_dt = t.utc_datetime()
                duration_min = (set_dt - rise_dt).total_seconds() / 60.0
                passes.append(format_pass(
                    rise_dt, duration_min, pending.get("max_altitude_deg"), tz_name
                ))
            pending = {}

    return jsonify({
        "latitude": lat,
        "longitude": lon,
        "timezone": tz_name,
        "passes": passes,
    })


@app.route("/api/search")
def api_search():
    query = (request.args.get("q") or "").strip()
    if not query:
        return jsonify({"error": "q parameter is required"}), 400

    headers = {"User-Agent": "iss-tracker-app/1.0 (educational project)"}
    try:
        resp = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={"q": query, "format": "json", "limit": 1},
            headers=headers,
            timeout=10,
        )
        resp.raise_for_status()
        results = resp.json()
    except Exception:  # noqa: BLE001
        return jsonify({"error": "Location search is temporarily unavailable"}), 503

    if not results:
        return jsonify({"error": "No matching location found"}), 404

    top = results[0]
    return jsonify({
        "display_name": top.get("display_name", query),
        "latitude": float(top["lat"]),
        "longitude": float(top["lon"]),
    })

print(app.url_map)
for rule in app.url_map.iter_rules():
    print(rule, "->", rule.endpoint, "->", app.view_functions[rule.endpoint])
if __name__ == "__main__":
    app.run(debug=True, port=5000)
