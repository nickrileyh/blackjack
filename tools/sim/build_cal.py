# Pack calibration tables for the app (base64 Uint16, quantized) + a dequantized JSON twin for the Python model.
import json, base64, numpy as np, os, sys
PENS = [str(p) for p in range(50, 95, 5)]
DECKS = [1, 2, 4, 6, 8]; RULES = [(h, s) for h in (0, 1) for s in (0, 1)]; OS = range(7)
# quantizers: value -> uint16 and back (the JS uses the same constants)
QR = [(-0.25, 0.5)] * 1 + [(-0.01, 0.06)] + [(0.8, 1.6)] * 2 + [(-0.2, 1.4)] * 2   # e, ins, m2, m2n, c12, c12n (10 each)
def q_lin(v, lo, span): return np.clip(np.round((np.asarray(v) - lo) / span * 65535), 0, 65535).astype(np.uint16)
def dq_lin(q, lo, span): return lo + q.astype(float) / 65535 * span
def q_sqrt(v): return np.clip(np.round(np.sqrt(np.maximum(np.asarray(v), 0)) * 65535), 0, 65535).astype(np.uint16)
def dq_sqrt(q): return (q.astype(float) / 65535) ** 2
def pack(arr): return base64.b64encode(np.asarray(arr, '<u2').tobytes()).decode()

CALDIR = os.environ.get('CALDIR', 'cal7')
_full = {}; ROUNDS = {}
def L(d, h, s, o):
    j = json.load(open(f'{CALDIR}/c_{d}_{h}_{s}_{o}.json'))
    fb = f'{CALDIR}/c_{d}_{h}_{s}_{o}_b.json'
    if os.path.exists(fb) and os.path.getsize(fb) > 0:   # a second seed of the same table: pool the two
        k = json.load(open(fb))
        for p in PENS:
            A, B = j['pens'][p], k['pens'][p]; na, nb = np.array(A['n'], float), np.array(B['n'], float); nt = np.maximum(na + nb, 1)
            for key in A:
                if key == 'n': continue
                if key == 'surv': A[key] = (np.array(A[key], float) + np.array(B[key], float)).tolist()
                else: A[key] = ((na * np.array(A[key]) + nb * np.array(B[key])) / nt).tolist()
            A['n'] = (na + nb).tolist()
        for key in ('n', 'se'): j['bins'][key] = (np.array(j['bins'][key], float) + np.array(k['bins'][key], float)).tolist()
        j['rounds'] += k['rounds']
    ROUNDS[(d, h, s, o)] = j['rounds']
    if 'bins' in j: _full[(d, h, s, o)] = j['bins']
    return j['pens']
def smooth_ref(bins):
    # edge per hand by (cards dealt when the round starts, true count); thin cells borrow from neighbouring positions
    n = np.array(bins['n'], float); se = np.array(bins['se'], float); NB = n.shape[0]; e = np.zeros_like(n)
    for b in range(10):
        for i in range(NB):
            w = 0
            while True:
                lo, hi = max(0, i - w), min(NB, i + w + 1); nn = n[lo:hi, b].sum()
                if nn >= 5000 or (lo == 0 and hi == NB): break
                w += 1
            e[i, b] = se[lo:hi, b].sum() / nn if nn > 0 else 0.0
    return e
def fam7(d, o, pt, h, s_): 
    fn = f'fam7/q_{d}_{o}_{pt}_{h}{s_}.json'
    return json.load(open(fn)) if os.path.exists(fn) and os.path.getsize(fn) > 0 else None
CHK = []; PATCELLS = {}
CALR, CALQ, JR, JQ, CALD, JD = {}, {}, {}, {}, {}, {}
for d in DECKS:
    data = {(h, s, o): L(d, h, s, o) for h, s in RULES for o in OS}
    groups = [[o] for o in OS] if d <= 4 else [[0], [1, 2, 3, 4, 5, 6]]
    for h, s in RULES:
        for grp in groups:
            key = f'{d}_{h}_{s}_' + (str(grp[0]) if len(grp) == 1 else 'm')
            qs, js = [], {}
            for p in PENS:
                acc = {k: np.zeros(10) for k in ('e', 'ins', 'm2', 'm2n', 'c12', 'c12n')}; N = np.zeros(10)
                for o in grp:
                    P = data[(h, s, o)][p]; n = np.array(P['n'], float); N += n
                    for k in acc: acc[k] += n * np.array(P[k])
                row_q, row_v = [], []
                for (k, (lo, span)) in zip(('e', 'ins', 'm2', 'm2n', 'c12', 'c12n'), QR):
                    v = acc[k] / np.maximum(N, 1); qv = q_lin(v, lo, span)
                    row_q += list(qv); row_v += list(dq_lin(qv, lo, span))
                qs += row_q; js[p] = row_v
            CALR[key] = pack(qs); JR[key] = js
    # frequency families + cards per round (cards pooled over rules)
    # 1-2 decks: one set per rule combo (surrender changes cards per round enough to move frequencies there)
    for o, (hq, sq) in ([(o, r) for o in OS for r in RULES] if d <= 2 else [(o, (None, None)) for o in OS]):
        key = f'{d}_{hq}_{sq}_{o}' if d <= 2 else f'{d}_{o}'; qs, js = [], {}
        pats = ['1111111111'] + ['0' * (a + 1) + '1' * (9 - a) for a in range(5)] + ([] if o == 6 else ['1' * b + '2' * (10 - b) for b in range(4, 10)])
        import glob as _g
        DEV = os.environ.get('DEV')
        def _ld(pt):
            fn = f'fam12/q_{d}_{o}_{pt}.json' if d <= 2 else f'fam/q_{d}_{o}_{pt}.json'
            if os.path.exists(fn):
                P0 = json.load(open(fn))['pens']
                if d <= 2 and (hq, sq) != (1, 0):
                    P0 = json.load(open(f'fam12r/q_{d}_{o}_{pt}_{hq}{sq}.json'))['pens']
                if d <= 2:
                    F7 = fam7(d, o, pt, hq, sq)
                    if F7: P0 = {p: list(np.array(P0[p], float) + np.array(F7['pens'][p], float)) for p in PENS}
                return P0
            if not DEV: raise SystemExit('missing ' + fn)
            return {p: data[(1, 0, o)][p]['n'] for p in PENS}
        fams = {pt: _ld(pt) for pt in pats}
        for p in PENS:
            row_q, row_v = [], []
            for pt in pats:
                n = np.array(fams[pt][p], float); f = n / n.sum() if n.sum() > 0 else n; qv = q_sqrt(f)
                row_q += list(qv); row_v += list(dq_sqrt(qv))
            N = np.zeros(10); k0 = np.zeros(10); ku = np.zeros(10)
            for h, s in (RULES if d > 2 else [(hq, sq)]):
                P = data[(h, s, o)][p]; n = np.array(P['n'], float); N += n; k0 += n * np.array(P['k0']); ku += n * np.array(P['ku'])
            k0 = k0 / np.maximum(N, 1); ku = ku / np.maximum(N, 1)
            # empty buckets (single deck at odd counts): borrow neighbours so the k's are never 0
            for arr in (k0, ku):
                for b in range(10):
                    if arr[b] == 0:
                        nz = [arr[j] for j in (b - 1, b + 1) if 0 <= j < 10 and arr[j] > 0]
                        arr[b] = np.mean(nz) if nz else np.mean(arr[arr > 0])
            for arr, (lo, span) in ((k0, (0, 40)), (ku, (0, 5))):
                qv = q_lin(arr, lo, span); row_q += list(qv); row_v += list(dq_lin(qv, lo, span))
            qs += row_q; js[p] = row_v
        CALQ[key] = pack(qs); JQ[key] = js
        if d <= 2 and (hq, sq) == RULES[0]:
            g = str(o); Nc = 52 * d
            for h, s_ in RULES:
                # How a pattern (sitting out at low counts, two hands at high ones) shifts your edge at each count. With one or
                # two decks the same true count is worth a different amount early and late in the deck, and a pattern changes
                # where in the deck your hands fall. Two measurements of that, combined further down:
                #   E  — predicted: the edge by (depth, count) from the big calibration run, weighted by where this pattern's
                #        hands fell (a count of hands, which is precise). Little noise, but it misses whatever depth doesn't explain.
                #   Ed — direct: the pattern's own measured edge, pooled over its runs. No model error, more noise.
                eref = smooth_ref(_full[(d, h, s_, o)])
                recs = []
                for p in PENS:
                    ref = np.array(JR[f'{d}_{h}_{s_}_{g}'][p][0:10]); cut = int((int(p) / 100.0) * Nc + 1e-9)
                    for pt in pats:
                        F7 = fam7(d, o, pt, h, s_)
                        if F7 is None: raise SystemExit(f'missing fam7 {d} {o} {pt} {h}{s_}')
                        W = np.array(F7['binh'], float)[:cut] if 'binh' in F7 else np.zeros((cut, 10)); tot = W.sum(axis=0)   # a pattern that never plays (heads-up, leaving at the shuffle) has no tally
                        E = np.where(tot > 0, (W * eref[:cut]).sum(axis=0) / np.maximum(tot, 1), ref)
                        Hd = np.zeros(10); Sd = np.zeros(10)
                        olds = [f'fam12/q_{d}_{o}_{pt}.json' if (h, s_) == (1, 0) else f'fam12r/q_{d}_{o}_{pt}_{h}{s_}.json']
                        for src in [F7] + [json.load(open(f)) for f in olds if os.path.exists(f)]:
                            if 'edge' in src and p in src['edge']:
                                hh = np.array(src['hands'][p], float); Hd += hh; Sd += hh * np.array(src['edge'][p])
                        Ed = Sd / np.maximum(Hd, 1)
                        kind = 'flat' if pt == '1111111111' else 'two' if '2' in pt else 'sit'
                        recs.append(dict(p=p, pt=pt, E=E, tot=tot, Ed=Ed, Hd=Hd, ref=ref, kind=kind))
                PATCELLS[(d, h, s_, o)] = recs
# Combine the two per cell. Within a group (decks, kind of pattern, open-ended end counts or not) the gap Ed − E has a mean
# (mu) and a spread beyond what the direct run's own noise explains (tau²). The best estimate leans on the direct
# measurement by tau² / (tau² + its noise): all the way where the prediction is poor (single deck), half-way where both are good.
VAR1 = 1.32; MODE = os.environ.get('CALDMODE', 'hybrid'); GST = {}
def _grp(d, kind, b): return (d, kind, b in (0, 9))
if PATCELLS:
    acc = {}
    for (d, h, s_, o), recs in PATCELLS.items():
        for r in recs:
            for b in range(10):
                if r['Hd'][b] > 20000 and r['tot'][b] > 200:
                    acc.setdefault(_grp(d, r['kind'], b), []).append((r['Ed'][b] - r['E'][b], VAR1 / r['Hd'][b]))
    for k, v in acc.items():
        x = np.array([a for a, _ in v]); s2 = np.array([c for _, c in v]); w = 1 / s2
        mu = (w * x).sum() / w.sum(); tau2 = max(0.0, (w * ((x - mu) ** 2 - s2)).sum() / w.sum())
        GST[k] = (mu, tau2, len(x), np.sqrt(((x / np.sqrt(s2)) ** 2).mean()))
    print('pattern-edge groups (decks, kind, end counts): gap of direct over predicted, extra spread, cells, rms z')
    for k in sorted(GST): print(f'  {k}: mu {100 * GST[k][0]:+.4f}%  tau {100 * np.sqrt(GST[k][1]):.4f}%  n {GST[k][2]}  rms z {GST[k][3]:.2f}')
    for (d, h, s_, o), recs in PATCELLS.items():
        qd, jd = [], {}
        for r in recs:
            D = np.zeros(10)
            for b in range(10):
                if r['tot'][b] <= 200 and r['Hd'][b] <= 20000: continue
                mu, tau2 = GST.get(_grp(d, r['kind'], b), (0.0, 0.0))[:2]
                has_d = r['Hd'][b] > 2000; has_e = r['tot'][b] > 200
                if MODE == 'binned' or not has_d: est = r['E'][b] if has_e else r['ref'][b]
                elif MODE == 'direct' or not has_e: est = r['Ed'][b]
                else:
                    s2 = VAR1 / r['Hd'][b]; w = tau2 / (tau2 + s2) if tau2 + s2 > 0 else 0.0
                    est = r['E'][b] + mu + w * (r['Ed'][b] - r['E'][b] - mu)
                D[b] = est - r['ref'][b]
            qv = q_lin(D, -0.1, 0.2); qd += list(qv); jd.setdefault(r['p'], []).extend(list(dq_lin(qv, -0.1, 0.2)))
        CALD[f'{d}_{h}_{s_}_{o}'] = pack(qd); JD[f'{d}_{h}_{s_}_{o}'] = jd
js_out = 'const CALR = ' + json.dumps(CALR, separators=(',', ':')) + ';\nconst CALQ = ' + json.dumps(CALQ, separators=(',', ':')) + ';\nconst CALD = ' + json.dumps(CALD, separators=(',', ':')) + ';'
open(os.environ.get('OUT', 'caldata.js'), 'w').write(js_out + '\n')
json.dump({'CALR': JR, 'CALQ': JQ, 'CALD': JD}, open('caldata.json', 'w'))
print('js bytes', len(js_out)); print('cal rounds', sum(ROUNDS.values()) / 1e9, 'billion')
