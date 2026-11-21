#!/usr/bin/env python3
"""Builds the Inter weight 650 that sits in src/head.html, from the 600 and 700 already embedded there.

The app's numbers are set halfway between semibold and bold (Nick, 21 Nov 2026: "find a middle"), and the embedded
Inter is four static weights (400, 500, 600, 700), so a browser asked for 650 would simply use 700. This reads the 600
and 700 faces out of src/head.html, checks that every glyph has the same outline structure in both, interpolates the
two half way (outlines, widths and kerning) with fontTools, and writes the result back as a fifth face,
font-weight:650. Same glyphs, same subset, same version as the others, so it is the same typeface, not a second one.

    pip install fonttools brotli
    python3 tools/fonts/inter-650.py      # then ./build.sh

Run it again only if the embedded Inter is ever replaced. It replaces an existing 650 face in place.
"""
import base64, logging, os, re, sys, tempfile
from fontTools import varLib
from fontTools.designspaceLib import AxisDescriptor, DesignSpaceDocument, SourceDescriptor
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

logging.disable(logging.WARNING)
HEAD = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "src", "head.html")
FACE = re.compile(r"@font-face\{[^}]*\}")

def face(html, weight):
    hit = [m for m in FACE.finditer(html) if "font-family:'Inter'" in m.group(0) and f"font-weight:{weight};" in m.group(0)]
    return hit[0] if hit else None

def main():
    html = open(HEAD, encoding="utf8").read()
    tmp = tempfile.mkdtemp()
    paths = {}
    for w in (600, 700):
        m = face(html, w)
        if not m: sys.exit(f"no Inter {w} face in src/head.html")
        raw = base64.b64decode(re.search(r"base64,([^)]*)\)", m.group(0)).group(1))
        src = os.path.join(tmp, f"{w}.woff2"); open(src, "wb").write(raw)
        t = TTFont(src); t.flavor = None
        if "STAT" in t: del t["STAT"]
        paths[w] = os.path.join(tmp, f"{w}.ttf"); t.save(paths[w])
    a, b = TTFont(paths[600]), TTFont(paths[700])
    if a.getGlyphOrder() != b.getGlyphOrder(): sys.exit("the two weights do not hold the same glyphs")
    odd = [g for g in a.getGlyphOrder() if a["glyf"][g].numberOfContours != b["glyf"][g].numberOfContours
           or (a["glyf"][g].numberOfContours > 0 and len(a["glyf"][g].coordinates) != len(b["glyf"][g].coordinates))]
    if odd: sys.exit("glyphs that cannot be interpolated: " + ", ".join(odd[:12]))
    ds = DesignSpaceDocument()
    ax = AxisDescriptor(); ax.name = "Weight"; ax.tag = "wght"; ax.minimum = 600; ax.default = 600; ax.maximum = 700; ds.addAxis(ax)
    for w in (600, 700):
        s = SourceDescriptor(); s.path = paths[w]; s.location = {"Weight": w}; s.familyName = "Inter"; ds.addSource(s)
    vf, _, _ = varLib.build(ds)
    mid = instancer.instantiateVariableFont(vf, {"wght": 650})
    mid["OS/2"].usWeightClass = 650
    if "STAT" in mid: del mid["STAT"]
    out = os.path.join(tmp, "650.woff2"); mid.flavor = "woff2"; mid.save(out)
    data = open(out, "rb").read()
    css = "@font-face{font-family:'Inter';font-style:normal;font-weight:650;font-display:swap;src:url(data:font/woff2;base64," + base64.b64encode(data).decode() + ") format('woff2')}"
    old = face(html, 650)
    if old: html = html[:old.start()] + css + html[old.end():]
    else: m = face(html, 600); html = html[:m.end()] + css + html[m.end():]
    open(HEAD, "w", encoding="utf8").write(html)
    print(f"Inter 650: {len(data)} bytes, {len(a.getGlyphOrder())} glyphs, {'replaced' if old else 'added'} in src/head.html")

if __name__ == "__main__":
    main()
