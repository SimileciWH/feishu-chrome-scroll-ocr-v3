#!/usr/bin/env python3
import json,sys,re
from pathlib import Path
p=Path(sys.argv[1] if len(sys.argv)>1 else '/Volumes/data/workspace/discord/docs/projects/feishu-chrome-scroll-ocr-v3/artifacts/feishu-extract-final-v2.txt')
if not p.exists():
    print(json.dumps({"ok":False,"error":f"missing:{p}"},ensure_ascii=False));sys.exit(1)
t=p.read_text(encoding='utf-8',errors='ignore')
lines=t.splitlines()
cn=len(re.findall(r'[\u4e00-\u9fff]',t))
en=len(re.findall(r'[A-Za-z]',t))
trunc = lines and (not re.search(r'[。！？.!?]$' , lines[-1].strip()))
print(json.dumps({
  "ok":True,
  "file":str(p),
  "lines":len(lines),
  "chars":len(t),
  "cn_chars":cn,
  "en_chars":en,
  "tail":(lines[-1] if lines else ""),
  "truncated_suspect":bool(trunc)
},ensure_ascii=False,indent=2))
