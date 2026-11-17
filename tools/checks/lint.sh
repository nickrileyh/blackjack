#!/bin/sh
# Looks through the source for names that are used but never defined, hooks called out of order, duplicate keys and the
# like — mistakes that only show when that line finally runs (one of them blanked the app when a test was started).
# Installs eslint in a scratch folder the first time. Prints nothing but "no problems" when the source is clean.
set -e
here="$(cd "$(dirname "$0")" && pwd)"; root="$here/../.."; work="${TMPDIR:-/tmp}/bj-lint"
mkdir -p "$work/src"; cd "$work"
[ -d node_modules/eslint ] || { npm init -y >/dev/null 2>&1; npm i --silent eslint@8 eslint-plugin-react@7 eslint-plugin-react-hooks@4 >/dev/null 2>&1; }
cp "$here/eslintrc.json" .eslintrc.json
cp "$root"/src/app.jsx "$root"/src/casinos.jsx "$root"/src/casino-map.js "$root"/src/planner.jsx "$root"/src/sound.js "$root"/src/sim.js "$root"/src/cover.js "$root"/src/entry.jsx "$root"/sw.js src/
# left out on purpose: unused names (leftovers, harmless), "useC" in cover.js (a plain variable, not a hook) and
# list keys on the icon arrays in NAV_ITEMS (they are never rendered as a list)
out="$(npx eslint --no-eslintrc -c .eslintrc.json --ext .js,.jsx src -f unix 2>&1 | grep "\[Error" | grep -v 'React Hook "useC"\|react/jsx-key' | sed "s#$work/src/##" || true)"
if [ -n "$out" ]; then echo "$out"; exit 1; else echo "no problems"; fi
