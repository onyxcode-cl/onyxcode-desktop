"""Hojas de contacto: une las imágenes de cada caso en una sola (entrada de un juez de IA o de una mirada humana)."""
import glob, os, sys
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]
os.makedirs(dst, exist_ok=True)
for case in sorted(os.listdir(src)):
    files = sorted(f for f in glob.glob(os.path.join(src, case, '**', '*.png'), recursive=True) if os.path.isfile(f))[:12]
    if not files: continue
    cols = 3 if len(files) > 4 else 2 if len(files) > 1 else 1
    w = 520 if cols == 3 else 640 if cols == 2 else 800
    ims = [Image.open(f).convert('RGB') for f in files]
    ims = [i.resize((w, max(1, int(i.height * w / i.width)))) for i in ims]
    h = max(i.height for i in ims); rows = (len(ims) + cols - 1) // cols
    S = Image.new('RGB', (cols * w + (cols + 1) * 8, rows * h + (rows + 1) * 8), (120, 120, 120))
    for k, i in enumerate(ims): S.paste(i, (8 + (k % cols) * (w + 8), 8 + (k // cols) * (h + 8)))
    S.save(os.path.join(dst, case + '.png'))
