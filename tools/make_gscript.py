"""Copy the app's suggest.js into google-sheets/RD-SK-sync.gs and regenerate the app's embedded copy (gscript.js).

Usage: python3 tools/make_gscript.py
"""
import json
import re

GS = "google-sheets/RD-SK-sync.gs"
SUGGEST = "android/app/src/main/assets/suggest.js"
EMBED = "android/app/src/main/assets/gscript.js"

src = open(GS, encoding="utf-8").read()
sug = open(SUGGEST, encoding="utf-8").read()
sug = "\n".join(l for l in sug.splitlines() if not l.startswith("if (typeof module"))
start, end = "// ==== suggest.js (copied from the app by tools/make_gscript.py; edit it there) ====", "// ==== end suggest.js ===="
src = re.sub(re.escape(start) + r".*?" + re.escape(end), lambda m: start + "\n" + sug.strip() + "\n" + end, src, flags=re.S)
open(GS, "w", encoding="utf-8").write(src)
open(EMBED, "w", encoding="utf-8").write("// Generated from google-sheets/RD-SK-sync.gs by tools/make_gscript.py.\nwindow.RD_GSCRIPT = "
                                         + json.dumps(src, ensure_ascii=False) + ";\n")
print("ok", len(src))
