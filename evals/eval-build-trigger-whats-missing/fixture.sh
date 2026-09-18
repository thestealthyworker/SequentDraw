#!/usr/bin/env bash
# Seeds the run's empty workspace with this case's booking map, so the
# prompt's `maps/booking-map.json` resolves from the working directory.
#
# Runs outside the agent's sandbox, before Claude starts, and only when the
# suite is invoked with --scaffold. It copies one file that lives beside
# this script and nothing else: no network, no installs, nothing from the
# fixture is executed.
set -euo pipefail

case_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p ./maps
cp "${case_dir}/fixture/booking-map.json" ./maps/booking-map.json
echo "scaffolded: maps/booking-map.json"
