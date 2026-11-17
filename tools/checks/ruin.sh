#!/bin/sh
# Deals real blackjack to check the Plan page's risk of ruin (see ruin-test.jsx). Slow, so run it on its own.
set -e
cd "$(dirname "$0")/../.."
./build.sh >/dev/null
cp tools/checks/ruin-test.jsx .build/ruin-test.jsx
npx esbuild .build/ruin-test.jsx --bundle --platform=node --format=cjs --outfile=.build/ruin-test.cjs --loader:.js=jsx --log-level=error
node .build/ruin-test.cjs "$@"
