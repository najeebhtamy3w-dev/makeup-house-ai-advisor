#!/usr/bin/env python3
"""Reproducible synthetic vision fixtures, never production product facts."""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
import hashlib,json
out=Path(__file__).resolve().parents[1]/'docs/v3.2/vision-probe'
out.mkdir(parents=True,exist_ok=True)
f='/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
rows=[]
for name,color,brand,words,shape in [('A','#365eab','TEST ALPHA','WATER, GLYCERIN','bottle'),('B','#b55b2d','TEST BETA','WATER, PANTHENOL','jar')]:
 im=Image.new('RGB',(480,640),'#f2f2ef');d=ImageDraw.Draw(im)
 d.text((20,15),'SYNTHETIC TEST ONLY',font=ImageFont.truetype(f,26),fill='black')
 if shape=='bottle':
  d.rounded_rectangle((95,95,385,550),radius=40,fill='white',outline='#222222',width=5);d.rectangle((160,55,320,120),fill='#444444')
 else:
  d.rounded_rectangle((50,230,430,550),radius=45,fill='white',outline='#222222',width=5);d.rectangle((45,205,435,265),fill='#444444')
 d.rectangle((65 if shape=='jar' else 100,280,415 if shape=='jar' else 380,485),fill=color)
 d.text((82 if shape=='jar' else 108,300),brand,font=ImageFont.truetype(f,30),fill='white')
 d.text((82 if shape=='jar' else 108,360),'INGREDIENTS',font=ImageFont.truetype(f,22),fill='white')
 for y,word in enumerate(words.split(', ')):d.text((82 if shape=='jar' else 108,400+y*30),word,font=ImageFont.truetype(f,22),fill='white')
 p=out/f'fixture-{name}.png';im.save(p)
 rows.append({'file':p.name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'synthetic':True,'expected_visible_words':['SYNTHETIC TEST ONLY',brand]+words.split(', '),'expected_shape':shape,'expected_color':color})
(out/'fixtures.json').write_text(json.dumps(rows,indent=2)+'\n')
