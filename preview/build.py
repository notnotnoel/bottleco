import os
r=os.path.dirname(os.path.abspath(__file__)); w=os.path.join(r,'web')
rd=lambda p:open(os.path.join(w,p) if not os.path.isabs(p) else p).read()
sim=open(os.path.join(r,'dist','sim.js')).read()
app='\n'.join(rd(f) for f in ['a_core.js','b_floor.js','c_watch.js','d_chat.js','e_time.js','f_main.js'])
t=rd('index.tpl.html').replace('/*CSS*/',rd('style.css')).replace('/*SIM*/',sim).replace('/*APP*/',app)
open(os.path.join(r,'dist','bottleops-preview.html'),'w').write(t)
open(os.path.join(r,'dist','app.js'),'w').write(app)
print('html bytes',len(t))
