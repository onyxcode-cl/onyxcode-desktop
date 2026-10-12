import json,subprocess,sys,time
import os
W=os.environ["WORDCRAFT_CLI"]  # ruta del binario craft (ver docs/GUIA-CRAFT.md)
c=[]
def a(i,**p): c.append(f"{i}={json.dumps(p,ensure_ascii=False)}")
def para(t,style=None):
    if style: a(style)
    a("text.insert",text=t); a("text.newParagraph")
def bul(items):
    a("para.bullets")
    for t in items: a("text.insert",text=t); a("text.newParagraph")
    a("para.bullets",off=True)
a("design.themeFonts",heading="Arial",body="Arial")  # Arial: existe en todos los equipos (la fuente del tema no, y se sustituye por una serif)
a("para.heading1"); a("para.alignCenter"); a("text.insert",text="Impacto de la inteligencia artificial en las pequeñas empresas de Chile"); a("text.newParagraph")
a("para.style",style="Normal"); a("para.alignLeft")
a("format.color",color="666666"); a("text.insert",text="Informe ejecutivo · Oportunidades, riesgos y primeros pasos"); a("text.newParagraph"); a("format.color",color="auto")
S=[("1. Contexto","En Chile, más del 98 % de las empresas son micro, pequeñas o medianas y generan cerca de la mitad del empleo. La inteligencia artificial dejó de ser un lujo de grandes compañías: hoy herramientas de bajo costo permiten automatizar tareas que antes exigían contratar personal."),
("2. Oportunidades","Las ventajas más inmediatas para un negocio pequeño son:"),
("3. Riesgos y desafíos","Adoptar IA sin un plan trae costos ocultos. Los riesgos principales son:"),
("4. Comparativo de usos","La siguiente tabla resume los usos más comunes y su impacto esperado:")]
a("para.heading2"); a("text.insert",text=S[0][0]); a("text.newParagraph"); a("para.style",style="Normal"); para(S[0][1])
a("para.heading2"); a("text.insert",text=S[1][0]); a("text.newParagraph"); a("para.style",style="Normal"); para(S[1][1])
bul(["Atención al cliente 24/7 con asistentes automáticos","Redacción de correos, cotizaciones y publicaciones en minutos","Análisis de ventas e inventario para decidir mejor","Menos tareas repetitivas: más tiempo para vender"])
a("para.heading2"); a("text.insert",text=S[2][0]); a("text.newParagraph"); a("para.style",style="Normal"); para(S[2][1])
bul(["Dependencia de proveedores extranjeros","Privacidad de datos de clientes (Ley 19.628)","Errores de la IA que nadie revisa","Brecha de capacitación del equipo"])
a("para.heading2"); a("text.insert",text=S[3][0]); a("text.newParagraph"); a("para.style",style="Normal"); a("text.insert",text=S[3][1]); a("text.newParagraph")
rows=[["Uso","Costo mensual","Ahorro de tiempo","Dificultad"],["Chatbot de atención","$15.000–40.000","10 h/semana","Baja"],["Redacción de contenidos","$0–20.000","6 h/semana","Muy baja"],["Análisis de ventas","$20.000–60.000","4 h/semana","Media"],["Facturación","$10.000–30.000","5 h/semana","Media"]]
a("insert.table",rows=5,cols=4)
for ri,r in enumerate(rows):
    for ci,t in enumerate(r):
        if ri==0: a("table.shading",color="1F4E79"); a("format.bold",value=True); a("format.color",color="FFFFFF")
        elif ri%2==0: a("table.shading",color="EAF1F8")
        a("text.insert",text=t)
        if ri==0: a("format.bold",value=False); a("format.color",color="auto")
        if not(ri==4 and ci==3): a("text.tab")
a("caret.docEnd")
a("para.heading2"); a("text.insert",text="Conclusión"); a("text.newParagraph"); a("para.style",style="Normal")
a("text.insert",text="La IA es una palanca real para las pymes chilenas si se adopta con foco: empezar por una tarea, medir el ahorro y capacitar al equipo. Quien espera, pierde competitividad frente a quienes ya la usan.")
args=[W,"run","--author","Lazunox","--save","informe-directo.docx"]
for x in c: args+=["--cmd",x]
t=time.time(); r=subprocess.run(args,capture_output=True,text=True); print(round(time.time()-t,2),"s",r.returncode); print(r.stdout[-600:],r.stderr[-800:])
