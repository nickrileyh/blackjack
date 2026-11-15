#!/bin/bash
# Builds index.html (the whole app in one offline file) from src/.
#   npm ci        # once, installs esbuild, react, react-dom, tailwindcss
#   ./build.sh
# Only index.html is generated. Icons, manifest.json and sw.js are hand-made files: never regenerate them here.
set -e
cd "$(dirname "$0")"
OUT=.build
mkdir -p "$OUT"

# app source (the font @import is dropped: fonts are inlined in src/head.html)
python3 - <<'PY'
import re
s = open('src/app.jsx').read()
s = re.sub(r"@import url\([^)]*\);/\*FONTIMPORT\*/", "\n/*FONTIMPORT*/", s)
open('.build/app.jsx', 'w').write(s)
PY
cp src/entry.jsx "$OUT/entry.jsx"
echo 'module.exports = { content: ["./.build/app.jsx"], theme: { extend: {} }, plugins: [] };' > "$OUT/tailwind.config.js"

npx tailwindcss -c "$OUT/tailwind.config.js" -i src/input.css -o "$OUT/tw.css" --minify 2>/dev/null
npx esbuild "$OUT/entry.jsx" --bundle --minify --jsx=automatic --define:process.env.NODE_ENV='"production"' --outfile="$OUT/bundle.js" --log-level=warning

python3 - <<'PY'
head = open('src/head.html').read()
css = open('.build/tw.css').read().strip()
js = open('.build/bundle.js').read().replace('</script', '<\\/script')
out = (head
  + '<script>try{var t=localStorage.getItem("bj:bj-theme-v1");if(t&&t!=="emerald")document.documentElement.setAttribute("data-theme",t);}catch(e){}</script>\n'
  + '<style>' + css + '</style>\n'
  + '<style>html,body{margin:0;background:var(--bg,#07090A);overscroll-behavior:none}:root[data-theme=light]{--bg:#EEF2F8}:root[data-theme=gold]{--bg:#05070B}:root[data-theme=sapphire]{--bg:#06070D}#root{min-height:100vh}:root{--b1:#142024;--b2:#0D1114;--b3:#07090A;--b4:#020304}:root[data-theme=gold]{--b1:#111B2E;--b2:#0C1422;--b3:#05070B}:root[data-theme=sapphire]{--b1:#161B36;--b2:#0D1020;--b3:#06070D}:root[data-theme=light]{--b1:#FFFFFF;--b2:#F3F6FB;--b3:#EEF2F8;--b4:#E4EAF3}#boot{position:fixed;inset:0;z-index:199;background:radial-gradient(90% 60% at 50% 40%,var(--b1) 0%,var(--b2) 40%,var(--b3) 80%,var(--b4) 100%)}</style>\n'
  + '</head>\n<body>\n<div id="boot"></div>\n<div id="root"></div>\n'
  + '<script>' + js + '</script>\n'
  + '<script>if("serviceWorker" in navigator){navigator.serviceWorker.register("sw.js").catch(function(){})}\nif(navigator.storage&&navigator.storage.persist){navigator.storage.persist().catch(function(){})}</script>\n'
  + '</body>\n</html>\n')
open('index.html', 'w').write(out)
print('index.html', len(out), 'bytes')
PY
