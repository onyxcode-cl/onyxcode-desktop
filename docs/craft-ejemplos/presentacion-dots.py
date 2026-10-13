import json,subprocess,time
import os
D=os.environ["DECKCRAFT_CLI"]  # ruta del binario (ver docs/GUIA-CRAFT.md)
c=[]
def a(i,**p): c.append(f"{i}={json.dumps(p,ensure_ascii=False)}" if p else i)
BG="07070C"; PANEL="12121B"; EDGE="25253A"; VI="8B5CF6"; VIL="C4B5FD"; WH="F5F5FA"; MU="A1A1B5"; GLOW="1F1640"; BLUEG="0F1A3A"
DOTS=["3B82F6","22C55E","F59E0B","EC4899","8B5CF6"]

def bgslide(glows=()):
    a("slide.new",layout="blank"); a("design.background",color="#"+BG)
    for g in glows: glow(*g)

def glow(x,y,d,col):
    a("shape.insert",preset="ellipse",rect=[x,y,d,d])
    a("shape.fill",gradient={"stops":[[0,"#"+col],[0.62,"#"+BG],[1,"#"+BG]],"kind":"radial"})
    a("shape.line",none=True)

def rect(x,y,w,h,col,preset="rect"):
    a("shape.insert",preset=preset,rect=[x,y,w,h]); a("shape.fill",color="#"+col); a("shape.line",none=True)

def ring(x,y,d,col,w=2):
    a("shape.insert",preset="ellipse",rect=[x,y,d,d]); a("shape.fill",none=True)
    a("shape.line",color="#"+col,width=w)

def dot(x,y,d,col):
    a("shape.insert",preset="ellipse",rect=[x,y,d,d]); a("shape.fill",color="#"+col); a("shape.line",none=True)

def dotrow(x,y,d,gap):
    for i,col in enumerate(DOTS): dot(x+i*(d+gap),y,d,col)

def txt(x,y,w,h,t,size=18,color=WH,bold=False,align="left",spacing=None,anchor=None):
    a("insert.textBox",rect=[x,y,w,h],text=t); a("format.size",size=size); a("format.color",color="#"+color)
    a("format.bold",on=bold); a("format.align",align=align)
    if spacing is not None: a("format.spacing",pt=spacing)
    if anchor: a("format.anchor",anchor=anchor)

def pill(x,y,w,h,t,size=16,line=VI,fill=None,color=WH):
    a("shape.insert",preset="roundRect",rect=[x,y,w,h],text=t)
    if fill: a("shape.fill",color="#"+fill)
    else: a("shape.fill",none=True)
    a("shape.line",color="#"+line,width=1.5)
    a("format.size",size=size); a("format.color",color="#"+color); a("format.bold",on=True)
    a("format.align",align="center"); a("format.anchor",anchor="middle")

def header(n,title,kicker):
    bgslide(glows=[(680,-250,500,GLOW)])
    txt(60,34,600,24,kicker.upper(),size=13,color=VI,bold=True,spacing=3)
    txt(60,62,840,64,title,size=40,bold=True,spacing=-1)
    dotrow(60,506,8,6)
    txt(820,500,80,24,f"{n:02d}",size=13,color=MU,align="right")

a("file.new")

# 1 PORTADA
bgslide(glows=[(380,-300,900,"4A2C96"),(-220,300,560,"14285E")])
dotrow(60,88,34,20)
txt(44,146,800,230,"dots",size=190,bold=True,spacing=-8)
txt(64,384,700,50,"Agentes siempre activos en ChatGPT",size=28,color=WH)
txt(64,430,700,30,"Presentados en el DevDay · 29 de septiembre de 2026",size=18,color=MU)
pill(64,476,270,36,"Impulsado por GPT-6 Astra",size=14)

# 2 QUÉ ES
header(2,"Un compañero que nunca se desconecta","Qué es")
txt(52,150,480,180,"4.000+",size=128,bold=True,color=VI,spacing=-4)
txt(64,344,380,70,"aplicaciones conectadas con las que cada dot puede trabajar",size=20,color=MU)
rect(510,150,1,300,EDGE)
for i,(t,b) in enumerate([("Computador propio","Cada dot tiene su propia máquina en la nube para ejecutar tareas completas."),("Navegador propio","Navega, busca y completa pasos en la web por ti, sin que abras nada.")]):
    y=160+i*170
    dot(546,y+12,16,DOTS[i])
    txt(578,y,340,40,t,size=26,bold=True)
    txt(578,y+44,340,100,b,size=19,color=MU)
    if i==0: rect(546,y+150,354,1,EDGE)

# 3 CÓMO FUNCIONA
header(3,"Sigue trabajando entre conversaciones","Cómo funciona")
rect(60,250,840,2,EDGE)
items=[(DOTS[2],"Siempre activo","No espera a que le escribas: avanza en segundo plano."),(DOTS[3],"Con tus apps","Usa más de 4.000 aplicaciones conectadas."),(DOTS[4],"Con memoria","Retoma donde lo dejaste, con el contexto de tu trabajo.")]
for i,(col,t,b) in enumerate(items):
    x=60+i*300
    ring(x-9,241,38,col,2)
    dot(x,250,20,col)
    txt(x,206,240,30,f"0{i+1}",size=15,color=col,bold=True,spacing=2)
    txt(x,290,260,40,t,size=26,bold=True)
    txt(x,336,250,90,b,size=18,color=MU)
pill(60,432,840,56,"No cuenta contra tus límites de uso de ChatGPT",size=18,fill="1A1332")

# 4 DÓNDE VIVE
header(4,"Habla con tu dot donde ya trabajas","Dónde vive")
chans=[(DOTS[0],"ChatGPT","Tu dot principal, dentro de la app."),(DOTS[2],"Slack","Pídele cosas en el canal de tu equipo."),(DOTS[1],"Teams","Microsoft Teams, desde el primer día."),(DOTS[3],"Mensajes","Por texto, llegan pronto.")]
for i,(col,t,b) in enumerate(chans):
    x=60+(i%2)*440; y=146+(i//2)*150
    rect(x,y,400,1,EDGE)
    ring(x,y+24,72,col,2)
    dot(x+22,y+46,28,col)
    txt(x+102,y+22,300,40,t,size=28,bold=True)
    txt(x+102,y+66,300,60,b,size=19,color=MU)
txt(60,448,840,34,"Cada usuario parte con un dot principal al que puede ponerle nombre y personalizar.",size=18,color=MU)

# 5 PASOS
header(5,"Empezar toma cuatro pasos","Cómo se usa")
steps=[("01","Crea tu dot principal"),("02","Ponle nombre y personalízalo"),("03","Asígnale tareas"),("04","Revisa lo que entrega")]
rect(60,286,840,2,EDGE)
for i,(n,t) in enumerate(steps):
    x=60+i*220
    txt(x-4,160,200,100,n,size=72,bold=True,color=DOTS[i],spacing=-2)
    dot(x,279,16,DOTS[i])
    txt(x,326,200,30,f"Paso {i+1}",size=14,color=MU,bold=True,spacing=1)
    txt(x,352,200,100,t,size=24,bold=True)

# 6 ASTRA
header(6,"GPT-6 Astra, el modelo detrás","El cerebro")
txt(60,150,400,30,"LANZADO A INICIOS DE SEPTIEMBRE",size=13,color=MU,bold=True,spacing=2)
txt(60,184,410,190,"Un modelo pensado para trabajar de forma autónoma y por mucho tiempo.",size=32,bold=True,spacing=-0.5)
txt(60,392,400,60,"Disponible en ChatGPT, Codex y la API de OpenAI.",size=18,color=MU)
rect(500,150,1,300,EDGE)
a("shape.insert",preset="roundRect",rect=[530,150,370,320]); a("shape.fill",gradient={"stops":[[0,"#"+VI],[1,"#"+DOTS[0]]],"angle":45}); a("shape.line",none=True)
a("shape.insert",preset="roundRect",rect=[532,152,366,316]); a("shape.fill",color="#150E28"); a("shape.line",none=True)
txt(566,180,310,30,"PRIMERA VEZ",size=13,color=VIL,bold=True,spacing=2)
txt(566,214,310,170,"Primer modelo de OpenAI en nivel «Crítico» de ciberseguridad",size=26,bold=True)
txt(566,396,310,60,"Según su Marco de Preparación. Por eso viene con más salvaguardas.",size=17,color="D8D0F5")

# 7 DISPONIBILIDAD
header(7,"Quién lo puede usar hoy","Disponibilidad")
rows=[("ChatGPT Pro y Business Premium","Lanzamiento inicial","Fuera del EEE, Suiza y Reino Unido"),("Enterprise, Edu y Healthcare","Beta","Debe activarla un administrador"),("Cantidad por usuario","Un dot","Incluido en la suscripción"),("Más adelante","Varios agentes","Más velocidad y más carga de trabajo")]
for i,(t,b,s) in enumerate(rows):
    y=146+i*84
    rect(60,y,840,1,EDGE)
    dot(60,y+30,14,DOTS[i])
    txt(90,y+20,350,44,t,size=21,bold=True)
    txt(460,y+20,200,50,b,size=20,color=VIL,bold=True)
    txt(680,y+20,220,56,s,size=16,color=MU)
rect(60,146+4*84,840,1,EDGE)

# 8 SEGURIDAD
header(8,"Con límites claros y revisión humana","Seguridad")
sec=[(DOTS[0],"Rechaza usos dañinos","Entrenado para negarse en biología y ciberseguridad."),(DOTS[1],"Investigación en solo lectura","En segundo plano solo lee tus apps conectadas."),(DOTS[2],"Puede equivocarse","OpenAI lo advierte explícitamente."),(DOTS[3],"Tú tienes la última palabra","Revisa siempre el trabajo de consecuencias importantes.")]
for i,(col,t,b) in enumerate(sec):
    x=60+(i%2)*440; y=150+(i//2)*170
    rect(x,y,5,130,col)
    txt(x+28,y+4,395,40,t,size=24,bold=True)
    txt(x+28,y+52,380,80,b,size=19,color=MU)

# 9 CIFRAS
header(9,"Las cifras que importan","En números")
txt(56,150,460,170,"4.000+",size=120,bold=True,color=VI,spacing=-4)
txt(64,326,420,40,"apps conectadas con tu dot",size=22,color=WH)
rect(520,150,1,300,EDGE)
nums=[("1","dot por usuario al inicio",DOTS[1]),("3","canales hoy, más pronto",DOTS[2]),("0","uso descontado de tus límites",DOTS[3])]
for i,(big,lab,col) in enumerate(nums):
    y=146+i*108
    txt(556,y,140,100,big,size=76,bold=True,color=col,spacing=-2)
    txt(716,y+26,200,70,lab,size=19,color=MU)
    if i<2: rect(556,y+100,344,1,EDGE)

# 10 CIERRE
bgslide(glows=[(120,-40,720,"2E1D66"),(-200,380,420,BLUEG)])
dotrow(364,116,32,22)
txt(60,184,840,100,"De chatear a delegar",size=62,bold=True,align="center",spacing=-2)
txt(120,298,720,60,"El próximo salto de la IA no es responder mejor, sino hacer el trabajo contigo.",size=22,color=MU,align="center")
txt(60,468,840,30,"Fuentes: CNBC, 9to5Google, MarkTechPost, DataCamp (29 sept 2026)",size=14,color=MU,align="center")
a("slide.delete",index=0)

args=[D,"run","--save","dots-premium-v2.pptx"]
for x in c: args+=["--cmd",x]
t=time.time(); r=subprocess.run(args,capture_output=True,text=True); print(round(time.time()-t,2),"s",r.returncode,r.stdout[-300:],r.stderr[-600:])
