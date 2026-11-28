#!/usr/bin/env bash
# Public GitHub-hosted runner only. No production signing, model weights or remote inference.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO_ROOT="$PWD"
OUTPUT="$REPO_ROOT/artifacts/v3.2-ci"
mkdir -p "$OUTPUT/logs"
trap 'printf "%s\n" "${BASH_COMMAND}" > "$OUTPUT/logs/last-command.txt"' ERR
exec > >(tee -a "$OUTPUT/logs/pipeline.log") 2>&1
[[ "${GITHUB_REF:-}" == refs/heads/work-v32-generative-orchestrator || "${GITHUB_REF:-}" == refs/heads/work-v32-unified-scientific-core ]] || { echo 'Dedicated engineering branch required'; exit 1; }
# Reject production signing overrides. The cached Debug key belongs only to isolated testing.
[[ -z "${MH_KEYSTORE_PROPERTIES:-}" && ! -f android/keystore.properties ]] || { echo 'Unexpected signing configuration'; exit 1; }
# Select a preinstalled cached Node22/24 with node:sqlite support; do not silently use Node20.
TASK_NODE_BIN="$(python3 - <<'NODE'
from pathlib import Path
import os,re,subprocess
root=Path(os.environ.get('RUNNER_TOOL_CACHE','/opt/hostedtoolcache'))/'node'
candidates=[]
for p in root.glob('*/x64/bin/node'):
 parts=p.parents[2].name.split('.')
 try: v=tuple(map(int,parts))
 except ValueError: continue
 if v[0] in (22,24) and v>=(22,13,0):candidates.append((v,p))
if not candidates:raise SystemExit('No compatible cached Node22/24 found')
print(max(candidates)[1].parent)
NODE
)"
export PATH="$TASK_NODE_BIN:$PATH"
node -e "if(Number(process.versions.node.split('.')[0])<22)throw Error('NODE_VERSION');require('node:sqlite')"
export JAVA_HOME="${JAVA_HOME_21_X64:?Runner JDK21 missing}"
export PATH="$JAVA_HOME/bin:$PATH"
export ANDROID_HOME="${ANDROID_HOME:-${ANDROID_SDK_ROOT:?Android SDK missing}}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
# A public certificate pin can be committed after the first verified bootstrap.
# A cache miss with a pin is an error, never permission to rotate engineering identity.
TASK_DEBUG_KEYSTORE="$HOME/.android/debug.keystore"
TASK_DEBUG_PIN="$REPO_ROOT/android/engineering-debug-certificate.sha256"
TASK_DEBUG_PREFLIGHT_FILE="$OUTPUT/logs/debug-identity-preflight.json"
export TASK_DEBUG_KEYSTORE TASK_DEBUG_PIN TASK_DEBUG_PREFLIGHT_FILE
# Gradle's implicit debug-keystore location can differ from the cached path. Create
# the isolated engineering identity explicitly, then pass this exact file to Gradle.
python3 - <<'DEBUG_IDENTITY'
from pathlib import Path
import hashlib,json,os,re,subprocess
key=Path(os.environ['TASK_DEBUG_KEYSTORE']);pin=Path(os.environ['TASK_DEBUG_PIN'])
expected=pin.read_text().strip().lower() if pin.is_file() else None
if expected is not None:
 if not re.fullmatch(r'[0-9a-f]{64}',expected):raise SystemExit('INVALID_ENGINEERING_DEBUG_CERTIFICATE_PIN')
 if not key.is_file():raise SystemExit('ENGINEERING_DEBUG_KEY_MISSING: pinned identity must be restored, not regenerated')
existed=key.is_file()
if key.is_symlink():raise SystemExit('ENGINEERING_DEBUG_KEY_PATH_INVALID')
key.parent.mkdir(parents=True,exist_ok=True)
if not existed:
 # Standard Android DEBUG credentials only; never the owner's production identity.
 subprocess.run([os.environ['JAVA_HOME']+'/bin/keytool','-genkeypair','-keystore',str(key),'-storetype','JKS','-alias','androiddebugkey','-storepass','android','-keypass','android','-keyalg','RSA','-keysize','2048','-validity','10000','-dname','CN=Android Debug,O=Android,C=US','-noprompt'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
key.chmod(0o600)
cert=subprocess.check_output([os.environ['JAVA_HOME']+'/bin/keytool','-exportcert','-alias','androiddebugkey','-storepass','android','-keystore',str(key)],stderr=subprocess.DEVNULL)
actual=hashlib.sha256(cert).hexdigest()
if expected is not None and actual!=expected:raise SystemExit('ENGINEERING_DEBUG_CERTIFICATE_PIN_MISMATCH')
state={'certificate_sha256':actual,'expected_certificate_pin':expected,'key_preexisted':existed,'generated_new_engineering_key':not existed,'path_source':'explicit TASK_DEBUG_KEYSTORE used by Gradle signingConfigs.debug','production_key_used':False}
Path(os.environ['TASK_DEBUG_PREFLIGHT_FILE']).write_text(json.dumps(state,indent=2)+'\n')
print('Engineering debug certificate verified before Gradle: '+actual)
DEBUG_IDENTITY
node --version; npm --version; java -version
npm ci
npm test 2>&1 | tee "$OUTPUT/logs/tests.log"
bash scripts/test-resumable-download.sh 2>&1 | tee "$OUTPUT/logs/resumable-download-tests.log"
bash scripts/test-offline-import.sh 2>&1 | tee "$OUTPUT/logs/offline-import-tests.log"
python3 -m unittest discover -s tests -p 'test_*.py' -v 2>&1 | tee "$OUTPUT/logs/ocr-integrity-tests.log"
npm run typecheck 2>&1 | tee "$OUTPUT/logs/typecheck.log"
npm run android:sync 2>&1 | tee "$OUTPUT/logs/android-sync.log"
python3 scripts/prepare-ocr-assets.py 2>&1 | tee "$OUTPUT/logs/ocr-assets.log"
"$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" 'platforms;android-36' 'build-tools;36.0.0' 'ndk;28.2.13676358' 'cmake;3.22.1' 2>&1 | tee "$OUTPUT/logs/sdk-packages.log"
export CMAKE_BUILD_PARALLEL_LEVEL=2
TASK_TEMP="${RUNNER_TEMP:?Runner temp missing}/makeuphouse-v32"
mkdir -p "$TASK_TEMP"
curl --fail --location --retry 3 --output "$TASK_TEMP/llama.tar.gz" https://codeload.github.com/ggml-org/llama.cpp/tar.gz/b1b770d90d94cad9e9ea5b993bdbc383a522fb28
printf '%s  %s\n' ae8556670b17c25931cd39eb7c95617650eaf6091bbcff206750583ddde1acb4 "$TASK_TEMP/llama.tar.gz" | sha256sum -c -
mkdir -p "$TASK_TEMP/llama"
tar -xzf "$TASK_TEMP/llama.tar.gz" -C "$TASK_TEMP/llama" --strip-components=1
export MH_LLAMA_SOURCE_DIR="$TASK_TEMP/llama"
# Invoke the repository wrapper: it pins Gradle8.14.3. No insecure TLS/proxy workarounds.
(cd android && bash ./gradlew --no-daemon --max-workers=2 --console=plain :app:assembleDebug) 2>&1 | tee "$OUTPUT/logs/android-build.log"
export OUTPUT REPO_ROOT
# Preserve the actual assembled Debug APK if a later package/signature assertion fails.
# Only a fully checked artifact is copied to the normal delivery filename below.
python3 - <<'UNVERIFIED_APK'
from pathlib import Path
import hashlib,json,os,shutil
root=Path(os.environ['REPO_ROOT']);out=Path(os.environ['OUTPUT'])/'unverified';out.mkdir(exist_ok=True)
source=root/'android/app/build/outputs/apk/debug/app-debug.apk'
if source.is_file():
 target=out/'UNVERIFIED_NOT_FOR_INSTALLATION_app-debug.apk';shutil.copy2(source,target)
 state={'status':'UNVERIFIED_NOT_FOR_INSTALLATION','reason':'Gradle assembled this file; independent APK checks have not yet completed','source_commit':os.environ.get('GITHUB_SHA'),'bytes':target.stat().st_size,'sha256':hashlib.file_digest(target.open('rb'),'sha256').hexdigest()}
 (out/'UNVERIFIED_APK.json').write_text(json.dumps(state,indent=2)+'\n')
UNVERIFIED_APK
python3 - <<'PY'
from pathlib import Path
import os,subprocess,json,hashlib,zipfile,shutil,datetime,re
repo=Path(os.environ['REPO_ROOT']);out=Path(os.environ['OUTPUT']);sdk=Path(os.environ['ANDROID_HOME']);bt=sdk/'build-tools/36.0.0'
def run(args):
 r=subprocess.run([str(a) for a in args],text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
 return {'exit_code':r.returncode,'output':r.stdout}
# Version metadata comes from the actual source used by Gradle, never a stale CI literal.
gradle=(repo/'android/app/build.gradle').read_text()
version_name=re.search(r'^\s*versionName\s+"([^"\r\n]+)"',gradle,re.M).group(1)
version_code=int(re.search(r'^\s*versionCode\s+(\d+)\s*$',gradle,re.M).group(1))
assert json.loads((repo/'package.json').read_text())['version']==version_name,'Package/Android version disagreement'
version_match=re.fullmatch(r'([0-9]+\.[0-9]+\.[0-9]+)-dev\.([0-9]+)',version_name)
assert version_match,'Engineering source version required'
artifact_version=version_match.group(1)+'_DEV'+version_match.group(2)
# Inspect public DER certificate only. The private keystore is never copied into OUTPUT.
key=Path(os.environ['TASK_DEBUG_KEYSTORE']);assert key.is_file(),'ENGINEERING_DEBUG_KEY_MISSING'
key.chmod(0o600)
cert=subprocess.check_output([os.environ['JAVA_HOME']+'/bin/keytool','-exportcert','-alias','androiddebugkey','-storepass','android','-keystore',str(key)],stderr=subprocess.DEVNULL)
key_certificate=hashlib.sha256(cert).hexdigest()
preflight=json.loads(Path(os.environ['TASK_DEBUG_PREFLIGHT_FILE']).read_text())
assert key_certificate==preflight['certificate_sha256'],'ENGINEERING_DEBUG_KEY_CHANGED_DURING_BUILD'
pin_path=Path(os.environ['TASK_DEBUG_PIN']);expected_pin=pin_path.read_text().strip().lower() if pin_path.is_file() else None
if expected_pin:
 assert re.fullmatch(r'[0-9a-f]{64}',expected_pin),'INVALID_ENGINEERING_DEBUG_CERTIFICATE_PIN'
 assert key_certificate==expected_pin,'ENGINEERING_DEBUG_CERTIFICATE_PIN_MISMATCH'
cache_hit=os.environ.get('MH_DEBUG_KEY_CACHE_HIT')=='true'
dev7_certificate='da9d4d6b4bdafec013c5b2963204b31dbfff7b016df648e13d03dd77c1272261'
signing={'certificate_sha256':key_certificate,'preflight':preflight,'cache_restored':cache_hit,'expected_certificate_pin':expected_pin,'dev7_certificate_sha256':dev7_certificate,'certificate_matches_dev7':key_certificate==dev7_certificate,'dev7_private_key_recovered':key_certificate==dev7_certificate,'identity_state':'PINNED_CACHE_RESTORED' if cache_hit and expected_pin else 'CACHE_RESTORED_UNPINNED' if cache_hit else 'BOOTSTRAP_UNPINNED','update_compatibility':'NOT_PROVEN: certificate match alone does not prove data/model migration','two_independent_runs_verified':False,'cache_limit':'Cache can expire or be evicted. Preserve a secure external backup before claiming permanent key retention; a committed public pin makes subsequent cache loss fail closed.'}
(out/'ENGINEERING_DEBUG_CERTIFICATE.sha256').write_text(key_certificate+'\n')
(out/'DEBUG_SIGNING_STATUS.json').write_text(json.dumps(signing,indent=2)+'\n')
if os.environ.get('GITHUB_OUTPUT'):
 with open(os.environ['GITHUB_OUTPUT'],'a') as step_output:step_output.write('certificate_sha256='+key_certificate+'\n')
results={}
for kind,relative,identity,version,debug in [
 ('DEBUG_ISOLATED_TEST_ONLY','debug/app-debug.apk','com.makeuphouse.advisor.engineering',version_name+'-test',True)]:
 f=repo/'android/app/build/outputs/apk'/relative
 assert f.is_file(),str(f)
 a=run([bt/'aapt','dump','badging',f]);assert a['exit_code']==0
 assert f"name='{identity}'" in a['output'] and f"versionCode='{version_code}'" in a['output'] and f"versionName='{version}'" in a['output']
 assert ('application-debuggable' in a['output'])==debug
 alignment=run([bt/'zipalign','-c','-P','16','4',f]);assert alignment['exit_code']==0
 signature=run([bt/'apksigner','verify','--verbose','--print-certs',f]);assert (signature['exit_code']==0)==debug
 if debug:
  cert_match=re.search(r'certificate SHA-256 digest: ([0-9a-f]{64})',signature['output'])
  assert cert_match and cert_match.group(1)==key_certificate,'APK_ENGINEERING_CERTIFICATE_MISMATCH'
 with zipfile.ZipFile(f) as z:
  assert z.testzip() is None
  libs=[n for n in z.namelist() if n.startswith('lib/') and n.endswith('.so')]
  assert 'lib/arm64-v8a/libmh_local_ai.so' in libs and all(n.startswith('lib/arm64-v8a/') for n in libs)
  elf=out/'logs'/f'{kind}.so';elf.write_bytes(z.read('lib/arm64-v8a/libmh_local_ai.so'))
  all_elf_headers={}
  for lib in libs:
   probe=out/'logs'/'alignment-probe.so';probe.write_bytes(z.read(lib))
   checked=run([sdk/'ndk/28.2.13676358/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-readelf','-lW',probe]);assert checked['exit_code']==0
   segments=[line for line in checked['output'].splitlines() if line.strip().startswith('LOAD')]
   assert segments and all(int(line.split()[-1],16)>=16384 for line in segments),lib
   all_elf_headers[lib]=checked['output'];probe.unlink()
  assert 'assets/ocr/tessdata/eng.traineddata' in z.namelist() and 'assets/ocr/tessdata/ara.traineddata' in z.namelist()
  assert 'assets/ocr/engine-LICENSE.txt' in z.namelist() and 'assets/ocr/models-LICENSE.txt' in z.namelist()
  embedded={}
  for asset in (repo/'android/app/src/main/assets').rglob('*'):
   if asset.is_file():
    name='assets/'+str(asset.relative_to(repo/'android/app/src/main/assets'))
    assert z.read(name)==asset.read_bytes(),name
    embedded[name]=hashlib.sha256(z.read(name)).hexdigest()
 readelf=run([sdk/'ndk/28.2.13676358/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-readelf','-lW',elf]);assert readelf['exit_code']==0
 loads=[s for s in readelf['output'].splitlines() if s.strip().startswith('LOAD')];assert loads and all(int(s.split()[-1],16)>=16384 for s in loads)
 elf.unlink()
 dest=out/f'MAKEUP_HOUSE_ADVISOR_{artifact_version}_{kind}.apk';shutil.copy2(f,dest)
 results[kind]={'file':dest.name,'bytes':dest.stat().st_size,'sha256':hashlib.file_digest(dest.open('rb'),'sha256').hexdigest(),'aapt':a,'signature':signature,'zip_alignment':alignment,'elf_headers':readelf,'all_elf_headers':all_elf_headers,'embedded_assets':embedded}
sha=subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip()
manifest={'git_sha':sha,'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'acceptance':'ENGINEERING_ONLY_NOT_PRODUCTION_APPROVED','physical_samsung':'NOT TESTED','permanent_signing':'DEFERRED_BY_OWNER','actual_artifacts':results}
(out/'DELIVERY_MANIFEST.json').write_text(json.dumps(manifest,indent=2)+'\n')
(out/'SHA256SUMS.txt').write_text(''.join(f"{r['sha256']}  {r['file']}\n" for r in results.values()))
commit=os.environ.get('GITHUB_SHA') or subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip()
subprocess.run(['git','archive','--format=zip','--output='+str(out/'MAKEUP_HOUSE_V32_SOURCE.zip'),commit],cwd=repo,check=True)
source=out/'MAKEUP_HOUSE_V32_SOURCE.zip'
manifest={'source_commit':commit,'status':'ENGINEERING_TEST_ONLY','production_approved':False,'model_reasoning_after_template_fix':'PARTIAL: Host real inference evidence retained; intelligence and Samsung acceptance not passed','physical_samsung':'NOT TESTED','permanent_signing':'DEFERRED BY OWNER','apks':results,'source_zip':{'file':source.name,'sha256':hashlib.file_digest(source.open('rb'),'sha256').hexdigest()},'ci_run':os.environ.get('GITHUB_RUN_ID'),'version_name':version_name,'version_code':version_code,'engineering_debug_signing':signing}
(out/'DELIVERY_MANIFEST.json').write_text(json.dumps(manifest,indent=2)+'\n')
with (out/'SHA256SUMS.txt').open('a') as checks:checks.write(manifest['source_zip']['sha256']+'  '+source.name+'\n')
(out/'FINAL_REPORT_AR.md').write_text(f'''# تسليم هندسي V3.2 — Unified Core

المصدر: `{commit}`. هذا Engineering Preview، وليس إصدارًا مقبولًا إنتاجيًا.

**PASS:** اختبارات البرمجيات وTypecheck وبناء Android وفحوص APK نجحت في هذا التشغيل؛ الأعداد والتفاصيل في السجلات.

**IMPLEMENTED:** نواة المستشار الرئيسية الموحدة، الربط بمحرك Native، تشخيص خام للمدير، سياق محدود، إظهار المسار الاحتياطي وأسباب الفشل، أدوات معرفة ومنتجات ومخزون وصور ومسودات مع تأكيد الحفظ. OCR عربي/إنجليزي محلي إن كان ضمن هذا Commit؛ راجع OCR_CHECKPOINT وبصمات الأصول في APK. OCR ليس VLM.

**PARTIAL/FAIL:** وُلّد نص فعلي على Host ومن الواجهة الرئيسية باستخدام Adapter حقيقي، لكن اختبار Qwen2B أظهر فشل فهم وتكرارًا/استيضاحًا غير مناسب. نجاح البرمجيات والبناء لا يثبت جودة الحوار أو الاستدلال العلمي. راجع ACCEPTANCE_MATRIX ونتائج النموذج الخام في المصدر. لم يُعتمد بديل للنموذج.

**NOT TESTED:** تشغيل هذا APK على Samsung، الأداء والذاكرة والبطارية والحرارة، العمل في وضع الطيران، قبول OCR على Android، المراجعة العلمية واللغوية المؤهلة. لا توجد شهادة تكافؤ مع ChatGPT.

**DEFERRED BY OWNER:** التوقيع الإنتاجي مؤجل وفق قرار المالك، وليس عائقًا للتطوير. APK غير الموقع لا يثبت مباشرة. Debug يحمل `com.makeuphouse.advisor.engineering` للتجربة المنفصلة؛ لا يحدّث التطبيق الدائم. مفتاح Debug محفوظ في مخبأ هندسي منفصل عند نجاح البناء؛ راجع DEBUG_SIGNING_STATUS.json لمطابقة الشهادة. لا يثبت المخبأ وحده استمرارية التوقيع، وقد لا يطابق dev.7 أو نسخة اختبار سابقة. يجب تثبيت البصمة العامة في المصدر بعد أول تهيئة ناجحة، والاحتفاظ بنسخة آمنة خارج المخبأ قبل ادعاء الدوام. عند تعارض التوقيع لا تحذف التطبيق أو البيانات؛ استخدم المفتاح الصحيح. لا يتضمن التسليم أوزان النموذج.

يحافظ التطبيق الدائم عند توقيعه بالمفتاح الصحيح على هويته ومسار الأوزان والبيانات؛ لم يُختبر التحديث الفعلي على الهاتف. راجع DELIVERY_MANIFEST.json وSHA256SUMS.txt للتحقق من الملفات والتوقيع.
''')
print(json.dumps({k:{'file':v['file'],'sha256':v['sha256']} for k,v in results.items()},indent=2))
PY
# Verified delivery succeeded: remove only the redundant, explicitly unverified copy.
rm -f "$OUTPUT/unverified/UNVERIFIED_NOT_FOR_INSTALLATION_app-debug.apk" "$OUTPUT/unverified/UNVERIFIED_APK.json"
