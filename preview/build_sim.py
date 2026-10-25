import sys,os
src=os.path.join(os.path.dirname(os.path.abspath(__file__)),'src')
parts=['sim_data.js','sim_kpi.js','sim_rca.js','sim_report.js','sim_tri.js','sim_qa1.js','sim_qa2.js','sim_end.js']
out=["(function(root){'use strict';\n"]
for p in parts:
    f=os.path.join(src,p)
    if os.path.exists(f): out.append(open(f).read()+"\n")
out.append("})(typeof window!=='undefined'?window:globalThis);\n")
os.makedirs(os.path.join(os.path.dirname(src),'dist'),exist_ok=True)
open(os.path.join(os.path.dirname(src),'dist','sim.js'),'w').write(''.join(out))
print('sim.js bytes',sum(len(x) for x in out))
