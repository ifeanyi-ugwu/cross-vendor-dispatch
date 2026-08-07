#!/usr/bin/env bash
#
# Produces src/data/durations.json: driving times between every fixed place the
# planner knows about, measured on the real Doha road network rather than
# guessed from straight-line distance.
#
# Run this when the fixtures change. It needs Docker and about 2GB of disk,
# takes several minutes, and downloads a 240MB extract. None of that is needed
# to run the app — the small JSON result is committed and the browser reads it
# directly, which is the whole reason the routing engine is a build-time tool.
#
#   ./tools/build-routing-matrix.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OSM_DIR="$ROOT/data/osm"
PORT="${OSRM_PORT:-5010}"

# Geofabrik publishes no Qatar-only extract, so the whole Gulf is used. Cropping
# it first turned out to be unnecessary: extraction runs in about a minute and
# peaks under 4GB, which is not worth another tool in the chain.
SOURCE_URL="https://download.geofabrik.de/asia/gcc-states-latest.osm.pbf"

mkdir -p "$OSM_DIR"

if [[ ! -f "$OSM_DIR/gcc-states.osm.pbf" ]]; then
  echo "==> downloading Gulf extract (240MB)"
  curl -L --progress-bar -o "$OSM_DIR/gcc-states.osm.pbf" "$SOURCE_URL"
fi

if [[ ! -f "$OSM_DIR/gcc-states.osrm.mldgr" ]]; then
  echo "==> building the routing graph"
  docker run --rm -v "$OSM_DIR:/data" osrm/osrm-backend \
    osrm-extract -p /opt/car.lua /data/gcc-states.osm.pbf
  docker run --rm -v "$OSM_DIR:/data" osrm/osrm-backend \
    osrm-partition /data/gcc-states.osrm
  docker run --rm -v "$OSM_DIR:/data" osrm/osrm-backend \
    osrm-customize /data/gcc-states.osrm
fi

echo "==> serving the graph on :$PORT"
CONTAINER=$(docker run --rm -d -p "$PORT:5000" -v "$OSM_DIR:/data" osrm/osrm-backend \
  osrm-routed --algorithm mld /data/gcc-states.osrm)
trap 'docker stop "$CONTAINER" > /dev/null 2>&1 || true' EXIT

for _ in $(seq 1 30); do
  if curl -sf "http://localhost:$PORT/route/v1/driving/51.53,25.32;51.52,25.28" > /dev/null; then
    break
  fi
  sleep 1
done

echo "==> querying the duration table"
OSRM_URL="http://localhost:$PORT" node "$ROOT/tools/query-matrix.mjs"

echo "==> done: src/data/durations.json"
