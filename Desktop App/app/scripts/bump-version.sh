#!/bin/bash
# Bumps the patch number in tauri.conf.json, package.json (+lock) and Cargo.toml together, and adds a CHANGELOG line.
# Usage: scripts/bump-version.sh "what changed"   (run once per rebuild of the signed app, then commit, then build-signed.sh)
set -euo pipefail
cd "$(dirname "$0")/.."
MSG="${1:?usage: bump-version.sh \"what changed\"}"
python3 - "$MSG" <<'PY'
import json,re,sys,datetime,subprocess
cur=json.load(open("package.json"))["version"]; M,m,p=map(int,cur.split(".")); new=f"{M}.{m}.{p+1}"
import json as _j
LOCKCUR=_j.load(open("package-lock.json"))["version"]
def rep(path,a,b):
    s=open(path).read(); assert a in s,(path,a); open(path,"w").write(s.replace(a,b,1))
rep("package.json",f'"version": "{cur}"',f'"version": "{new}"')
lock=open("package-lock.json").read()
head,tail=lock[:600],lock[600:]  # only the root package entries at the top, never a dependency
open("package-lock.json","w").write(head.replace('"version": "'+LOCKCUR+'"','"version": "'+new+'"')+tail)
cl=open("src-tauri/Cargo.lock").read()
cl2=re.sub(r'(name = "practice-notes"\nversion = ")[^"]+',lambda m:m.group(1)+new,cl,1); open("src-tauri/Cargo.lock","w").write(cl2)
rep("src-tauri/tauri.conf.json",f'"version": "{cur}"',f'"version": "{new}"')
rep("src-tauri/Cargo.toml",f'version = "{cur}"',f'version = "{new}"')
base=subprocess.run(["git","rev-parse","--short","HEAD"],capture_output=True,text=True).stdout.strip()
open("../CHANGELOG.md","a").write(f"v{new} | {datetime.date.today()} | built on {base} | {sys.argv[1]}\n")
print("bumped",cur,"->",new)
PY
