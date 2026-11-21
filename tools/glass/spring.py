#!/usr/bin/env python3
"""The glass springs, fitted as CSS cubic-bezier curves.

The app's glass moves on damped springs (Nick, 21 Nov 2026: "Springy like Apple's"). Motion driven from script
(Glider in src/app.jsx: the tab highlight, a segment's thumb) uses the spring itself, springOf() there, the same
formula as curve() here. CSS has no spring, so for transitions each spring is fitted here with the cubic-bezier that
follows it most closely: off the mark at once, past its place once, and back. A bezier, not linear(): every browser
runs a bezier on the compositor, where a press or the tab bar's fold keeps moving while the page is busy; Safari's
handling of linear() there could not be checked.

    python3 tools/glass/spring.py        prints the three custom properties and how closely each fits

z is the damping ratio (lower = more bounce), k how many time constants fit in the duration.
  --spring       z .68  about 5% past the mark: a piece of glass arriving, a switch's knob, the sidebar's highlight
  --spring-b     z .42  about 23% back the other way: a pressed control let go (the lift is only a few percent)
  --spring-soft  z .84  about 1%: the tab bar folding and unfolding, where more would leave the screen

The fit of the soft one comes out a little high (2% past the mark), which on a 320px phone would carry the opening
tab bar to the edge of the screen; in the app its last number is lowered by hand, 1.138 to 1.1, for a peak of 1%:
cubic-bezier(.3,.48,.1,1.1).
"""
import math, random

def curve(z, k, n):
    a = k; b = k * math.sqrt(1 - z * z) / z
    return [1.0 if i == n else 1 - math.exp(-a * (i / n)) * (math.cos(b * i / n) + (a / b) * math.sin(b * i / n)) for i in range(n + 1)]

def bez(x1, y1, x2, y2, n):
    out = []
    for i in range(n + 1):
        p = i / n; lo, hi = 0.0, 1.0
        for _ in range(40):
            t = (lo + hi) / 2
            x = 3 * (1 - t) ** 2 * t * x1 + 3 * (1 - t) * t * t * x2 + t ** 3
            if x < p: lo = t
            else: hi = t
        t = (lo + hi) / 2
        out.append(3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t * t * y2 + t ** 3)
    return out

def fit(z, k, seed=1):
    n = 60; want = curve(z, k, n); rnd = random.Random(seed)
    def err(v):
        got = bez(*v, n); return sum((g - w) ** 2 for g, w in zip(got, want))
    best = [0.3, 1.3, 0.5, 1.0]; be = err(best); step = 0.25
    for it in range(4000):
        c = [best[0] + rnd.gauss(0, step), best[1] + rnd.gauss(0, step * 2), best[2] + rnd.gauss(0, step), best[3] + rnd.gauss(0, step)]
        c[0] = min(1, max(0, c[0])); c[2] = min(1, max(0, c[2]))
        e = err(c)
        if e < be: best, be = c, e
        if it % 400 == 399: step *= 0.6
    got = bez(*best, n)
    return [round(x, 3) for x in best], max(abs(g - w) for g, w in zip(got, want)), max(want), max(got)

if __name__ == "__main__":
    for name, z, k in (("spring", 0.68, 6.2), ("spring-b", 0.42, 5.2), ("spring-soft", 0.84, 6.8)):
        v, worst, pw, pg = fit(z, k)
        print("--%s:cubic-bezier(%s);   /* spring peaks at %.3f, the bezier at %.3f; never more than %.3f apart */" % (name, ",".join(("%g" % x) for x in v), pw, pg, worst))
