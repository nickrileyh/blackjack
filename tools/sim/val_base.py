# Checks the calculator against full simulations: random games and spreads, each played out by the simulator (truth)
# and worked out by the app's own calFor/compute.  usage: val_base.py gen N seed | sim rounds | cmp app.cjs [other.cjs]
# (app.cjs: src/app.jsx bundled for node, e.g. an entry file `export { calFor, compute, COUNTS } from "./app.jsx"`
# through esbuild --bundle --platform=node --format=cjs --jsx=automatic). VB=name keeps a second set of games apart.
import json, random, subprocess, sys, os, concurrent.futures as cf
import numpy as np
def rand_config(rng):
    d = rng.choice([1, 2, 4, 6, 6, 6, 8, 8])
    h = rng.choice([0, 1]); s = rng.choice([0, 1]); ins = 1 if rng.random() < 0.85 else 0
    o = rng.randint(0, 6)
    if d == 1: o = min(o, 4)
    pen = round(rng.uniform(0.5, 0.9), 2)
    unit = rng.choice([5, 10, 15, 25])
    sit = rng.choice([None, -3, -2, -2, -1, -1, 0])  # sit out at counts <= sit
    if o == 0 and sit == 0: sit = -1
    top = rng.choice([4, 6, 8, 10, 12, 16, 20])
    two = rng.choice([None, None, 2, 3, 4, 5])
    bets = []
    for b in range(-3, 7):
        if sit is not None and b <= sit: bets.append(0); continue
        lvl = 1 if b <= 1 else min(top, 1 + (top - 1) * (b - 1) / 5 * rng.uniform(0.7, 1.3))
        bets.append(unit * max(1, round(lvl)))
    bets = [int(x) for x in np.maximum.accumulate(bets)]
    spots = [2 if (two is not None and b >= two) else 1 for b in range(-3, 7)]
    if o + 2 > 7: spots = [1] * 10
    return dict(d=d, h=h, s=s, ins=ins, o=o, pen=pen, bets=bets, spots=spots)

SIM = os.environ.get('SIM', './table_sim'); HERE = os.path.dirname(os.path.abspath(__file__))
def sim(job):
    i, c, rounds = job
    args = [SIM, 'val', str(c['d']), str(c['h']), str(c['s']), str(c['ins']), str(c['o']), str(c['pen']), str(rounds), str(880000 + i),
            ','.join(str(x) for x in c['bets']), ','.join(str(x) for x in c['spots'])]
    return i, json.loads(subprocess.run(args, capture_output=True, text=True, cwd=HERE, env={**os.environ, 'A7V2': os.environ.get('A7V2', '0,-1')}).stdout)
if sys.argv[1] == 'gen':
    rng = random.Random(int(sys.argv[3])); cs = []
    for i in range(int(sys.argv[2])):
        c = rand_config(rng); c['ins'] = 1; cs.append(c)
    open(os.environ.get('VB', 'vb') + '_cfgs.jsonl', 'w').write('\n'.join(json.dumps(c) for c in cs) + '\n')
elif sys.argv[1] == 'sim':
    cs = [json.loads(l) for l in open(os.environ.get('VB', 'vb') + '_cfgs.jsonl')]; done = {}
    if os.path.exists(os.environ.get('VB', 'vb') + '_truth.jsonl'):
        for l in open(os.environ.get('VB', 'vb') + '_truth.jsonl'):
            r = json.loads(l); done[r['i']] = r
    jobs = [(i, c, int(sys.argv[2])) for i, c in enumerate(cs) if i not in done]
    with cf.ThreadPoolExecutor(int(os.environ.get('P', '2'))) as ex, open(os.environ.get('VB', 'vb') + '_truth.jsonl', 'a') as f:
        for i, r in ex.map(sim, jobs):
            f.write(json.dumps({'i': i, 'cfg': cs[i], 'sim': r}) + '\n'); f.flush()
else:
    rows = sorted((json.loads(l) for l in open(os.environ.get('VB', 'vb') + '_truth.jsonl')), key=lambda r: r['i'])
    inp = '\n'.join(json.dumps({'cfg': r['cfg']}) for r in rows)
    for app in sys.argv[2:]:
        js = "const A=require(process.env.APP_CJS);const L=require('fs').readFileSync(0,'utf8').trim().split('\\n');for(const l of L){const cfg=JSON.parse(l).cfg;const R={decks:cfg.d,h17:!!cfg.h,surrender:!!cfg.s,insurance:!!cfg.ins,pen:cfg.pen*100};const cal=A.calFor(R,cfg.o+1);const bets={},sm={};A.COUNTS.forEach((k,i)=>{bets[k]=cfg.bets[i];if(cfg.spots[i]===2)sm[k]=2;});const r=A.compute({bankroll:10000,handsPerHour:100,bets,cal,spotsMap:sm});console.log(JSON.stringify({ev:r.evHand,sd:Math.sqrt(r.varHand)}));}"
        out = subprocess.run(['node', '-e', js], input=inp, capture_output=True, text=True, env={**os.environ, 'APP_CJS': os.path.abspath(app)})
        if out.returncode: print(out.stderr[-600:]); continue
        M = [json.loads(l) for l in out.stdout.strip().split('\n')]
        print(f'\n== {app}: {len(rows)} games')
        for name, sel in (('all', lambda c: True), ('6-8 decks', lambda c: c['d'] >= 6), ('4 decks', lambda c: c['d'] == 4), ('2 decks', lambda c: c['d'] == 2), ('1 deck', lambda c: c['d'] == 1)):
            ix = [k for k, r in enumerate(rows) if sel(r['cfg'])]
            if not ix: continue
            ev = np.array([rows[k]['sim']['ev'] for k in ix]); se = np.array([rows[k]['sim']['se'] for k in ix]); sd = np.array([rows[k]['sim']['sd'] for k in ix])
            mev = np.array([M[k]['ev'] for k in ix]); msd = np.array([M[k]['sd'] for k in ix])
            # win-rate gap in units of the game's own scale: (model - sim) / sim sd per round, and as a share of the win rate
            rel = (mev - ev) / np.abs(ev); z = (mev - ev) / se
            w = 1 / (se / np.abs(ev)) ** 2
            print(f'  {name:9s} n={len(ix):3d}  win rate: median |gap| {100 * np.median(np.abs(rel)):.2f}%  weighted mean gap {100 * (rel * w).sum() / w.sum():+.2f}%  rms z {np.sqrt((z ** 2).mean()):.2f} (1 = sim noise only)   swing: median |gap| {100 * np.median(np.abs(msd / sd - 1)):.2f}%  mean {100 * (msd / sd - 1).mean():+.2f}%')
