import json, math, sys, os
# Rebuilds assets/track.json from Overpass exports (trunk.json, rr.json) in SRC.
# Overpass queries used (bbox around Yogyakarta):
#   way["highway"~"^(trunk|trunk_link|primary)$"](-7.88,110.30,-7.72,110.46);out geom tags;  -> trunk.json
#   way["railway"="rail"](-7.90,110.28,-7.70,110.48);out geom tags;  -> rail.json (optional)
#   way["highway"~"trunk|primary|secondary"]["name"~"Ring Road|Lingkar",i](-7.90,110.28,-7.70,110.48);out geom tags;  -> rr.json
SRC = sys.argv[1] if len(sys.argv) > 1 else '.'
d=json.load(open(SRC+'/trunk.json'))['elements']+json.load(open(SRC+'/rr.json'))['elements']
ring_keys={'Padjajaran':'Ring Road Utara','Majapahit':'Ring Road Timur','Ahmad Yani':'Ring Road Timur',
 'Wirjono':'Ring Road Selatan','Prodjodikoro':'Ring Road Selatan','Brawijaya':'Ring Road Barat','Siliwangi':'Ring Road Barat',
 'Ring Road Barat':'Ring Road Barat','Ring Road Selatan':'Ring Road Selatan','Jombor':'Ring Road Barat'}
def ringsec(e):
    n=e['tags'].get('name') or ''
    hw=e['tags'].get('highway','')
    if hw not in('trunk',): return None
    for k,v in ring_keys.items():
        if k in n: return v
    return None
LAT0,LON0=-7.7924,110.3748
R=6371000
def P(g): return ((g['lon']-LON0)*math.cos(math.radians(LAT0))*math.pi/180*R, -(g['lat']-LAT0)*math.pi/180*R)  # x east, z south
ring=[];other=[]
for e in d:
    pts=[P(g) for g in e['geometry']]
    sec=ringsec(e)
    nm=(e['tags'].get('name') or '').replace('Jalan ','Jl. ')
    if sec: ring.append((pts,nm,sec))
    else: other.append((pts,nm,e['tags'].get('highway')))
# densify ring
dense=[]
for pts,nm,sec in ring:
    for (x1,z1),(x2,z2) in zip(pts,pts[1:]):
        L=math.hypot(x2-x1,z2-z1); n=max(1,int(L/8))
        for i in range(n): t=i/n; dense.append((x1+(x2-x1)*t,z1+(z2-z1)*t,nm,sec))
    dense.append((pts[-1][0],pts[-1][1],nm,sec))
# cluster grid 45m
G=45;cells={}
for x,z,nm,sec in dense:
    k=(round(x/G),round(z/G)); cells.setdefault(k,[]).append((x,z))
cl=[(sum(p[0] for p in v)/len(v),sum(p[1] for p in v)/len(v)) for v in cells.values()]
# NN chain
start=min(range(len(cl)),key=lambda i:cl[i][1])  # northmost
order=[start];used={start}
cur=cl[start]
while len(order)<len(cl):
    best=None;bd=1e18
    for i,p in enumerate(cl):
        if i in used: continue
        dd=(p[0]-cur[0])**2+(p[1]-cur[1])**2
        if dd<bd: bd=dd;best=i
    if bd>1500**2: print('big jump',math.sqrt(bd)); 
    order.append(best);used.add(best);cur=cl[best]
path=[cl[i] for i in order]
def dist(a,b): return math.hypot(a[0]-b[0],a[1]-b[1])
n=len(path);improved=True;passes=0
while improved and passes<60:
    improved=False;passes+=1
    for i in range(n-1):
        a,b=path[i],path[i+1]
        for j in range(i+2,n if i>0 else n-1):
            c,dd=path[j],path[(j+1)%n]
            if dist(a,c)+dist(b,dd) < dist(a,b)+dist(c,dd)-1e-6:
                path[i+1:j+1]=path[i+1:j+1][::-1];improved=True;b=path[i+1]
print('2opt passes',passes,'tour',sum(dist(path[i],path[(i+1)%n]) for i in range(n)),'maxedge',max(dist(path[i],path[(i+1)%n]) for i in range(n)))
# remove outlier zigzags: drop points making very sharp angle
def resample(path,step):
    pts=path+[path[0]]
    out=[];acc=0
    seg=[math.hypot(b[0]-a[0],b[1]-a[1]) for a,b in zip(pts,pts[1:])]
    L=sum(seg);n=int(L/step);step=L/n
    i=0;pos=0;
    for k in range(n):
        t=k*step
        while pos+seg[i]<t: pos+=seg[i];i+=1
        f=(t-pos)/seg[i] if seg[i]>0 else 0
        a,b=pts[i],pts[i+1]
        out.append((a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f))
    return out,L
def smooth(p,sigma_pts):
    n=len(p);W=int(sigma_pts*3)
    w=[math.exp(-(k*k)/(2*sigma_pts**2)) for k in range(-W,W+1)];sw=sum(w)
    return [(sum(w[k+W]*p[(i+k)%n][0] for k in range(-W,W+1))/sw,sum(w[k+W]*p[(i+k)%n][1] for k in range(-W,W+1))/sw) for i in range(n)]
def minradius(p):
    n=len(p);mr=1e9;at=0
    for i in range(n):
        a,b,c=p[i-2],p[i],p[(i+2)%n]
        ab=math.hypot(b[0]-a[0],b[1]-a[1]);bc=math.hypot(c[0]-b[0],c[1]-b[1]);ac=math.hypot(c[0]-a[0],c[1]-a[1])
        cr=abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))
        r=ab*bc*ac/(2*cr) if cr>1e-9 else 1e9
        if r<mr: mr=r;at=i
    return mr,at
p,L=resample(path,10)
# progressive smoothing until min radius ok
for it in range(40):
    p=smooth(p,3)
    p,L=resample(p,10)
    mr,at=minradius(p)
    if mr>75: break
print('iters',it,'L',L,'minR',mr,'n',len(p))
p,L=resample(p,4)
# ensure clockwise when viewed north-up: map coords (x,-z). signed area
A=sum(p[i][0]*(-p[(i+1)%len(p)][1])-p[(i+1)%len(p)][0]*(-p[i][1]) for i in range(len(p)))/2
if A>0: p=p[::-1]  # CCW -> reverse to clockwise
# rotate start to Kentungan-ish (north, x near 0)
north=[i for i in range(len(p)) if p[i][1]<-3000]
s0=min(north,key=lambda i:abs(p[i][0]-0))
p=p[s0:]+p[:s0]
# section labels via nearest dense point
grid={}
for x,z,nm,sec in dense: grid.setdefault((int(x//100),int(z//100)),[]).append((x,z,nm,sec))
def nearest(x,z):
    best=None;bd=1e18
    for dx in(-2,-1,0,1,2):
        for dz in(-2,-1,0,1,2):
            for q in grid.get((int(x//100)+dx,int(z//100)+dz),[]):
                dd=(q[0]-x)**2+(q[1]-z)**2
                if dd<bd: bd=dd;best=q
    return best
# fallback grid: any named road (the ring shares Jl. Laksda Adisucipto near Janti)
ogrid={}
for pts,nm,hw in other:
    if not nm: continue
    for (x1,z1),(x2,z2) in zip(pts,pts[1:]):
        L=math.hypot(x2-x1,z2-z1); n=max(1,int(L/10))
        for i in range(n+1):
            t=i/n; x=x1+(x2-x1)*t; z=z1+(z2-z1)*t
            ogrid.setdefault((int(x//100),int(z//100)),[]).append((x,z,nm))
def nearest_other(x,z):
    best=None;bd=60**2
    for dx in(-1,0,1):
        for dz in(-1,0,1):
            for q in ogrid.get((int(x//100)+dx,int(z//100)+dz),[]):
                dd=(q[0]-x)**2+(q[1]-z)**2
                if dd<bd: bd=dd;best=q
    return best
names=[];secs=[]
for x,z in p:
    q=nearest(x,z)
    if q and (q[0]-x)**2+(q[1]-z)**2<80**2:
        names.append(q[2]); secs.append(q[3])
    else:
        o=nearest_other(x,z)
        names.append(o[2] if o else (names[-1] if names else '')); secs.append(secs[-1] if secs else '')
# leading samples may lack a section; borrow from the end of the loop
for i in range(len(secs)):
    if secs[i]: break
    secs[i]=secs[-1]
# normalise spelling variants, then majority-filter so labels don't flicker
names=[n.replace('Prodjodikoro','Projodikoro') for n in names]
from collections import Counter as _C
N=len(names);Wn=40
names=[_C(names[(i+k)%N] for k in range(-Wn,Wn+1)).most_common(1)[0][0] for i in range(N)]
secs=[_C(secs[(i+k)%N] for k in range(-Wn,Wn+1)).most_common(1)[0][0] for i in range(N)]
# drop runs shorter than ~600 m by absorbing them into the previous run
runs=[]
for i,(nm,sc) in enumerate(zip(names,secs)):
    if runs and runs[-1][1]==nm and runs[-1][2]==sc: runs[-1][3]+=1
    else: runs.append([i,nm,sc,1])
merged=[]
for r in runs:
    if merged and r[3]<150: merged[-1][3]+=r[3]; continue
    if merged and merged[-1][1]==r[1] and merged[-1][2]==r[2]: merged[-1][3]+=r[3]; continue
    merged.append(r)
names=[];secs=[]
for r in merged: names+= [r[1]]*r[3]; secs+=[r[2]]*r[3]
# compress labels into ranges
labels=[]
for i,(nm,sec) in enumerate(zip(names,secs)):
    if not labels or labels[-1][1]!=nm: labels.append([i,nm,sec])
labels=[l for l in labels]
# junctions: other named roads coming within 40m of path
pg={}
for i,(x,z) in enumerate(p): pg.setdefault((int(x//60),int(z//60)),[]).append(i)
junc=[]
for pts,nm,hw in other:
    if not nm: continue
    for (x,z) in pts:
        hit=None
        for dx in(-1,0,1):
            for dz in(-1,0,1):
                for i in pg.get((int(x//60)+dx,int(z//60)+dz),[]):
                    if (p[i][0]-x)**2+(p[i][1]-z)**2<35**2: hit=i
        if hit is not None: junc.append((hit,nm))
junc.sort()
jj=[]
for i,nm in junc:
    if any(nm==n2 and min(abs(i-i2),len(p)-abs(i-i2))<150 for i2,n2 in jj): continue
    jj.append((i,nm))
print('junctions',len(jj),[n for _,n in jj])
# grade separations: long bridge/tunnel ways on the ring itself (short ones are river bridges)
pidx={}
for i,(x,z) in enumerate(p): pidx.setdefault((int(x//50),int(z//50)),[]).append(i)
def near_idx(x,z):
    best=(1e18,None)
    for dx in(-1,0,1):
        for dz in(-1,0,1):
            for i in pidx.get((int(x//50)+dx,int(z//50)+dz),[]):
                dd=(p[i][0]-x)**2+(p[i][1]-z)**2
                if dd<best[0]: best=(dd,i)
    return best[1]
spans=[]
for e in d:
    tg=e['tags']
    if not ringsec(e): continue
    kind='flyover' if tg.get('bridge') else 'underpass' if tg.get('tunnel') else None
    if not kind: continue
    g=[P(q) for q in e['geometry']]
    L=sum(math.hypot(b[0]-a[0],b[1]-a[1]) for a,b in zip(g,g[1:]))
    if L<140: continue
    ids=[near_idx(x,z) for x,z in g]
    if None in ids: continue
    a,b=min(ids),max(ids)
    if b-a>len(p)/2: continue
    spans.append([a,b,kind])
spans.sort()
features=[]
for a,b,k in spans:
    if features and a<=features[-1][1]+40:
        f=features[-1]; f[1]=max(f[1],b)
        if k=='flyover': f[2]='flyover'  # where OSM has both (Jombor), keep the flyover
    else: features.append([a,b,k])
known={'Jl. Kaliurang':'Underpass Kentungan','Jl. Majapahit':'Flyover Janti','Fly Over Janti':'Flyover Janti','Jl. Magelang':'Flyover Jombor'}
for f in features:
    m=(f[0]+f[1])/2
    ji,jn=min(jj,key=lambda j:min(abs(j[0]-m),len(p)-abs(j[0]-m)))
    f.append(known.get(jn,'Flyover' if f[2]=='flyover' else 'Underpass') if abs(ji-m)<120 else ('Rail overpass' if f[2]=='flyover' else 'Underpass'))
def simp(pts,tol=6):
    if len(pts)<3: return pts
    out=[pts[0]]
    for q in pts[1:-1]:
        if math.hypot(q[0]-out[-1][0],q[1]-out[-1][1])>tol*3: out.append(q)
    out.append(pts[-1]);return out
oth=[{'n':nm,'h':hw,'p':[[round(x,1),round(z,1)] for x,z in simp(pts)]} for pts,nm,hw in other]
rails=[]
_rp=os.path.join(SRC,'rail.json')
if os.path.exists(_rp):
    for e in json.load(open(_rp))['elements']:
        if e['tags'].get('service') in ('yard','crossover'): continue
        rails.append([[round(x,1),round(z,1)] for x,z in simp([P(q) for q in e['geometry']],2)])
json.dump({'origin':[LAT0,LON0],'step':4,'length':round(len(p)*4,1),
  'pts':[[round(x,2),round(z,2)] for x,z in p],
  'labels':labels,'junctions':jj,'features':features,'rails':rails,'roads':oth},open(__import__('os').path.join(__import__('os').path.dirname(__file__),'..','assets','track.json'),'w'),separators=(',',':'))
