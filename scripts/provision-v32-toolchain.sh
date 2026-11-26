#!/usr/bin/env bash
# Explicit engineering provisioning; no model weights, signing keys or paid services.
set -euo pipefail
if [[ "${1:-}" != --install ]]; then
  echo 'Usage: scripts/provision-v32-toolchain.sh --install [absolute-toolchain-directory]'
  echo 'Installs verified JDK21/Gradle and Google Android SDK packages; downloads multiple GB.'
  exit 0
fi
TASK_TOOLCHAIN="${2:-$(cd "$(dirname "$0")/../.." && pwd)/toolchain}"
mkdir -p "$TASK_TOOLCHAIN"
export TASK_TOOLCHAIN
python3 - <<'PY'
from pathlib import Path
import os, subprocess, hashlib, tarfile, zipfile, urllib.parse, json
p=Path(os.environ['TASK_TOOLCHAIN']).resolve();p.mkdir(parents=True,exist_ok=True)
artifacts=[
 ('jdk21.tar.gz','https://api.adoptium.net/v3/binary/version/jdk-21.0.13.1%2B2/linux/x64/jdk/hotspot/normal/eclipse','bb8a93f9ae6e7a693b2b721e85dbeff26ae1a77447985a8d7afcdd9c7cf6222e'),
 ('gradle-8.14.3-bin.zip','https://services.gradle.org/distributions/gradle-8.14.3-bin.zip','bd71102213493060956ec229d946beee57158dbd89d0e62b91bca0fa2c5f3531'),
 ('android-cmdline.zip','https://dl.google.com/android/repository/commandlinetools-linux-13114758_latest.zip','7ec965280a073311c339e571cd5de778b9975026cfcbe79f2b1cdcb1e15317ee')]
for name,url,sha in artifacts:
 f=p/name
 if not f.exists():
  temp=p/(name+'.partial');subprocess.run(['curl','--fail','--location','--retry','3','--output',str(temp),url],check=True);temp.replace(f)
 actual=hashlib.file_digest(f.open('rb'),'sha256').hexdigest()
 if actual!=sha:raise SystemExit('INTEGRITY FAILURE: '+name+'; not extracting')
jdk=p/'jdk-21.0.13.1+2'
if not jdk.exists():
 with tarfile.open(p/'jdk21.tar.gz') as a:a.extractall(p,filter='data')
if not (p/'gradle-8.14.3').exists():
 with zipfile.ZipFile(p/'gradle-8.14.3-bin.zip') as a:
  if a.testzip():raise SystemExit('Gradle ZIP CRC failure')
  a.extractall(p)
sdk=p/'android-sdk';latest=sdk/'cmdline-tools/latest'
if not latest.exists():
 latest.mkdir(parents=True)
 with zipfile.ZipFile(p/'android-cmdline.zip') as a:
  if a.testzip():raise SystemExit('Android ZIP CRC failure')
  for info in a.infolist():
   parts=Path(info.filename).parts
   if not parts or parts[0]!='cmdline-tools':continue
   relative=Path(*parts[1:])
   if '..' in relative.parts:raise SystemExit('Unsafe archive path')
   target=latest/relative
   if info.is_dir():target.mkdir(parents=True,exist_ok=True)
   else:target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(a.read(info))
for directory in [latest/'bin',p/'gradle-8.14.3/bin']:
 for f in directory.iterdir():
  if f.is_file():f.chmod(f.stat().st_mode|0o111)
env=os.environ.copy();env['JAVA_HOME']=str(jdk);env['JAVA_TOOL_OPTIONS']='-Djavax.net.ssl.trustStore=/etc/ssl/certs/java/cacerts'
args=[str(latest/'bin/sdkmanager'),'--sdk_root='+str(sdk)]
proxy=urllib.parse.urlsplit(env.get('HTTPS_PROXY',''))
if proxy.hostname:args+=['--proxy=http','--proxy_host='+proxy.hostname,'--proxy_port='+str(proxy.port or 80)]
# Acceptance is explicitly scoped to the authorized Android development environment.
with (p/'sdk-licenses.log').open('w') as log:
 subprocess.run(args+['--licenses'],input='y\n'*100,text=True,env=env,stdout=log,stderr=subprocess.STDOUT,check=True)
with (p/'sdk-install.log').open('w') as log:
 subprocess.run(args+['platforms;android-36','build-tools;36.0.0','platform-tools','ndk;28.2.13676358','cmake;3.22.1'],env=env,stdout=log,stderr=subprocess.STDOUT,check=True)
(p/'provisioned-artifacts.json').write_text(json.dumps([{'archive':n,'source':u,'sha256':s} for n,u,s in artifacts],indent=2)+'\n')
print('Provisioning completed. JAVA_HOME='+str(jdk));print('ANDROID_HOME='+str(sdk))
PY
