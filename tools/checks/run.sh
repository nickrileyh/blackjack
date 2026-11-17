#!/bin/sh
# Bundles the app's source with a few internal functions exported, then runs the arithmetic checks in Node.
set -e
cd "$(dirname "$0")/../.."
./build.sh >/dev/null
cp .build/app.jsx .build/app-x.jsx
echo 'export { handValue, settle, isBlackjack, drawdownFromMix, patternOf };' >> .build/app-x.jsx
cp tools/checks/math-test.jsx .build/math-test.jsx
npx esbuild .build/math-test.jsx --bundle --platform=node --format=cjs --outfile=.build/math-test.cjs --loader:.js=jsx --log-level=error
node .build/math-test.cjs
# the Plan tab's arithmetic (src/planner.jsx)
cp tools/checks/plan-test.jsx .build/plan-test.jsx
npx esbuild .build/plan-test.jsx --bundle --platform=node --format=cjs --outfile=.build/plan-test.cjs --loader:.js=jsx --log-level=error
node .build/plan-test.cjs
