"""Copy the app's suggest.js and emailparse.js into google-sheets/RD-SK-sync.gs and regenerate the app's embedded copy (gscript.js).

Usage: python3 tools/make_gscript.py
"""
import json
import os
import re

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

GS = "google-sheets/RD-SK-sync.gs"
SUGGEST = "android/app/src/main/assets/suggest.js"
EMBED = "android/app/src/main/assets/gscript.js"

src = open(GS, encoding="utf-8").read()
for name in ("suggest.js", "emailparse.js", "watchlist.js", "insights.js"):
    code = open("android/app/src/main/assets/" + name, encoding="utf-8").read()
    code = "\n".join(l for l in code.splitlines() if not l.startswith(("if (typeof module", "if (typeof window")))
    start, end = "// ==== %s (copied from the app by tools/make_gscript.py; edit it there) ====" % name, "// ==== end %s ====" % name
    assert start in src, name
    src = re.sub(re.escape(start) + r".*?" + re.escape(end), lambda m: start + "\n" + code.strip() + "\n" + end, src, flags=re.S)
open(GS, "w", encoding="utf-8").write(src)
open(EMBED, "w", encoding="utf-8").write("// Generated from google-sheets/RD-SK-sync.gs by tools/make_gscript.py.\nwindow.RD_GSCRIPT = "
                                         + json.dumps(src, ensure_ascii=False) + ";\n")
print("ok", len(src))
