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
# every other source file sits next to it (entry.jsx, the Casinos page and its map data, the Plan tab, the phone layout, sound)
for f in src/*.js src/*.jsx; do [ "$f" = src/app.jsx ] || cp "$f" "$OUT/"; done
echo 'module.exports = { content: ["./src/*.jsx"], theme: { extend: {} }, plugins: [] };' > "$OUT/tailwind.config.js"

npx tailwindcss -c "$OUT/tailwind.config.js" -i src/input.css -o "$OUT/tw.css" --minify 2>/dev/null
npx esbuild "$OUT/entry.jsx" --bundle --minify --jsx=automatic --define:process.env.NODE_ENV='"production"' --outfile="$OUT/bundle.js" --log-level=warning

python3 - <<'PY'
import re, json
head = open('src/head.html').read()
css = open('.build/tw.css').read().strip()
js = open('.build/bundle.js').read().replace('</script', '<\\/script')

# The first paint, before the app's script has been read: the page colour and the splash backdrop of the theme in use,
# taken from the theme blocks in src/app.jsx so a new theme needs nothing here. A skin (Kiera) is a light theme repainted.
src = open('src/app.jsx').read()
want = ('--bg', '--velvet', '--velvet-l', '--bg-end')
themes = {}
for m in re.finditer(r':root(?:\[data-(theme|skin)="(\w+)"\])?\{([^}]*)\}', src):
    key = (m.group(1) or 'theme', m.group(2) or '')
    for k, v in re.findall(r'(--[\w-]+)\s*:\s*([^;}]+)', m.group(3)):
        if k in want: themes.setdefault(key, {})[k] = v.strip()
base = themes[('theme', '')]
light = themes.get(('theme', 'light'), {})
skins = sorted(n for (kind, n) in themes if kind == 'skin')
def block(sel, d, parent):
    g = lambda k: d.get(k, parent.get(k, base[k]))
    return '%s{--bg:%s;--b1:%s;--b2:%s;--b3:%s;--b4:%s}' % (sel, g('--bg'), g('--velvet-l'), g('--velvet'), g('--bg'), g('--bg-end'))
boot = block(':root', base, base)
bar = {}
for (kind, n), d in sorted(themes.items(), key=lambda kv: (kv[0][0] == 'skin', kv[0][1])):  # skins last: they sit on top of light
    if not n or '--bg' not in d: continue
    if kind == 'theme':
        boot += block(':root[data-theme=%s]' % n, d, base); bar[n] = '#0E1A3A' if n == 'light' else d['--bg']
    else:
        boot += block(':root[data-skin=%s]' % n, d, light); bar[n] = d['--bg']
pre = ('try{var d=document.documentElement,t=localStorage.getItem("bj:bj-theme-v1"),S=%s,B=%s,c=B[t];'
       'if(S.indexOf(t)>=0){d.setAttribute("data-skin",t);t="light"}if(t&&t!=="emerald")d.setAttribute("data-theme",t);'
       'if(c){var m=document.querySelector(\'meta[name="theme-color"]\');if(m)m.setAttribute("content",c)}}catch(e){}') % (json.dumps(skins), json.dumps(bar, separators=(',', ':')))
import hashlib
stamp = hashlib.sha1((css + js + pre + boot).encode()).hexdigest()[:12]  # this build's stamp: the app compares it with the one the service worker reports
out = (head
  + '<meta name="bj-build" content="' + stamp + '">\n'
  + '<script>' + pre + '</script>\n'
  + '<style>' + css + '</style>\n'
  + '<style>html,body{margin:0;background:var(--bg,#07090A);overscroll-behavior:none}#root{min-height:100vh}' + boot
  + '#boot{position:fixed;inset:0;z-index:199;background:var(--bg)}:root[data-theme=light] #boot{background:radial-gradient(90% 60% at 50% 40%,var(--b1) 0%,var(--b2) 40%,var(--b3) 80%,var(--b4) 100%)}</style>\n'
  + '</head>\n<body>\n<div id="boot"></div>\n<div id="root"></div>\n'
  + '<script>' + js + '</script>\n'
  + '<script>if("serviceWorker" in navigator){navigator.serviceWorker.register("sw.js").catch(function(){})}\nif(navigator.storage&&navigator.storage.persist){navigator.storage.persist().catch(function(){})}</script>\n'
  + '</body>\n</html>\n')
open('index.html', 'w').write(out)
print('index.html', len(out), 'bytes')
PY
