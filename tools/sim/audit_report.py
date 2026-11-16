#!/usr/bin/env python3
# Reads the strategy audits (aud/a_<decks>_<h17>_<sur>*.json), pools seeds, and reports
#  1. basic strategy: every cell where another legal play beats the chart's play
#  2. count plays: the measured gain of the "above" play over the "below" play around each index
import json,glob,sys,math,re,collections
NIL=9999
DEFS=[("16v10",10,16,0,0,0,1),("16v9",9,16,4,4,0,0),("16vA",11,16,NIL,3,0,0),("15v10",10,15,4,4,0,0),("15vA",11,15,NIL,5,0,0),
("TTv4",4,200,6,6,-1,0),("TTv5",5,200,5,5,-1,0),("TTv6",6,200,4,4,-1,0),("10v10",10,10,4,4,-1,0),("10vA",11,10,4,3,-1,0),("11vA",11,11,1,NIL,-1,0),
("12v2",2,12,3,3,-1,0),("12v3",3,12,2,2,-1,0),("12v4",4,12,0,0,-1,-1),("13v2",2,13,0,0,-1,0),("9v2",2,9,1,1,-1,0),("9v7",7,9,3,3,-1,0),("8v6",6,8,2,2,-1,0),
("A8v4",4,108,3,3,-1,0),("A8v5",5,108,1,1,-1,0),("A8v6",6,108,1,0,-1,-1),("A6v2",2,106,1,1,-1,0),("A7v2",2,107,1,0,-1,-1),
("s16v8",8,16,4,4,1,0),("s16v9",9,16,-1,-1,1,0),("s15v9",9,15,2,2,1,0),("s15v10",10,15,0,0,1,-1),("s15vA",11,15,2,-1,1,0)]
def pool(a,b):  # [n,mean,se] pairs
    n=a[0]+b[0]
    if n==0: return [0,0,0]
    return [n,(a[0]*a[1]+b[0]*b[1])/n,math.sqrt((a[0]*a[2])**2+(b[0]*b[2])**2)/n]
def load():
    cfg=collections.OrderedDict()
    for f in sorted(glob.glob('aud/a_*.json')):
        m=re.match(r'aud/a_(\d)_(\d)_(\d)',f); k=tuple(map(int,m.groups()))
        d=json.load(open(f))
        if k not in cfg: cfg[k]={'rounds':0,'cells':{},'devs':{}}
        c=cfg[k]; c['rounds']+=d['rounds']
        for x in d['cells']:
            ck=(x['kind'],x['hand'],x['up']); o=c['cells'].setdefault(ck,{'bs':x['bs'],'a':{}})
            for a in 'HSDPR':
                if a in x:
                    v=x[a]; p=[v[0],v[2],v[3]]; o['a'][a]=pool(o['a'][a],p) if a in o['a'] else p
        for i,t in d['devs'].items():
            o=c['devs'].setdefault(int(i),{})
            for b,v in t.items(): o[b]=pool(o[b],v) if b in o else v
    return cfg
KN={0:'hard',1:'soft',2:'pair'}
def hname(k,h): return (f"hard {h}" if k==0 else f"A,{h-11 if h>11 else h}" if k==1 else f"{'A' if h==11 else h},{'A' if h==11 else h}")
def main():
    cfg=load(); out={'bs':[],'devs':[]}
    for (d,h,s),c in cfg.items():
        name=f"{d}D {'H17' if h else 'S17'} {'LS' if s else 'noLS'}"
        print(f"\n===== {name}  ({c['rounds']/1e6:.0f}M rounds) =====")
        ncell=0;close=[]
        for (k,hd,up),o in sorted(c['cells'].items()):
            ncell+=1
            for a,v in o['a'].items():
                if a==o['bs'] or v[0]<1000: continue
                z=v[1]/v[2] if v[2]>0 else 0
                if z>=3: print(f"  BASIC: {hname(k,hd)} v {up}: chart {o['bs']}, but {a} is better by {v[1]*100:+.2f}% ±{v[2]*100:.2f} (z {z:.1f}, n {v[0]})"); out['bs'].append((name,hname(k,hd),up,o['bs'],a,v))
                elif z>-2: close.append(f"{hname(k,hd)}v{up} {o['bs']}/{a} {v[1]*100:+.2f}±{v[2]*100:.2f}")
        print(f"  basic strategy: {ncell} cells checked; too close to separate ({len(close)}): "+"; ".join(close[:40]))
        for i,t in sorted(c['devs'].items()):
            nm,up,key,s17,h17,ls,edge=DEFS[i]; idx=h17 if h else s17
            def g(b): return t.get(str(b),[0,0,0])
            row=" ".join(f"{b}:{g(b)[1]*100:+.1f}±{g(b)[2]*100:.1f}" for b in range(-4,7))
            verdict=''
            if idx==NIL: verdict='(no chart index)'
            else:
                if edge and idx==0:
                    lo=g('0neg') if edge<0 else pool(g('0neg'),g('0zero')); hi=pool(g('0zero'),g('0pos')) if edge<0 else g('0pos')
                    lab=f"0{'+' if edge>0 else '−'}"
                else: lo=g(idx-1); hi=g(idx); lab=f"{idx:+d}"
                zl=lo[1]/lo[2] if lo[2] else 0; zh=hi[1]/hi[2] if hi[2] else 0
                bad=[]
                if zh<=-3: bad.append(f"at the index the play loses {hi[1]*100:+.2f}%±{hi[2]*100:.2f}")
                if zl>=3: bad.append(f"one below the index the play already gains {lo[1]*100:+.2f}%±{lo[2]*100:.2f}")
                verdict=f"chart {lab}: below {lo[1]*100:+.2f}±{lo[2]*100:.2f}, at {hi[1]*100:+.2f}±{hi[2]*100:.2f} -> "+("DISAGREES: "+"; ".join(bad) if bad else "agrees")
                if bad: out['devs'].append((name,nm,lab,bad))
            extra=f" | 0neg {g('0neg')[1]*100:+.2f}±{g('0neg')[2]*100:.2f} 0zero {g('0zero')[1]*100:+.2f}±{g('0zero')[2]*100:.2f} 0pos {g('0pos')[1]*100:+.2f}±{g('0pos')[2]*100:.2f}" if (idx in(0,NIL) or abs(idx)<=1) else ''
            print(f"  {nm:7s} {verdict}\n           {row}{extra}")
    print("\n\n##### SUMMARY #####"); print("basic-strategy disagreements:",len(out['bs']));
    for x in out['bs']: print("  ",x[0],x[1],'v',x[2],'chart',x[3],'sim',x[4],f"{x[5][1]*100:+.2f}±{x[5][2]*100:.2f}")
    print("count-play disagreements:",len(out['devs']))
    for x in out['devs']: print("  ",*x)
main()
