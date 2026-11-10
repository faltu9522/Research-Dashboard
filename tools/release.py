"""Publish a built APK: copy it to apk/ and docs/ (the download page), write docs/version.json for the app's
"Check for updates", and update the download button's version label.

Usage (after ./gradlew assembleRelease): python3 tools/release.py
"""
import json
import os
import re
import shutil

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
gradle = open("android/app/build.gradle", encoding="utf-8").read()
code = int(re.search(r"versionCode (\d+)", gradle).group(1))
name = re.search(r"versionName '([^']+)'", gradle).group(1)
html = open("android/app/src/main/assets/index.html", encoding="utf-8").read()
m = re.search(r'const CHANGELOG=\[\s*\["([^"]+)","([^"]+)",(\[.*?\])\],', html, re.S)
assert m and m.group(1) == name, "the newest CHANGELOG entry must match versionName " + name
notes = json.loads(m.group(3))

apk = "android/app/build/outputs/apk/release/app-release.apk"
shutil.copy(apk, "apk/RD-SK.apk")
shutil.copy(apk, "docs/RD-SK.apk")
site = "https://faltu9522.github.io/Research-Dashboard/"
json.dump({"version": name, "versionCode": code, "date": m.group(2), "notes": notes, "page": site, "apk": site + "RD-SK.apk"},
          open("docs/version.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
page = open("docs/index.html", encoding="utf-8").read()
page = re.sub(r"Download the app \(APK, version [^)]+\)", "Download the app (APK, version %s)" % name, page)
open("docs/index.html", "w", encoding="utf-8").write(page)
print("released", name, "build", code)
