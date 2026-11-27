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
# Reject signing overrides. Debug's automatically generated key belongs only to isolated testing.
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
node --version; npm --version; java -version
npm ci
npm test 2>&1 | tee "$OUTPUT/logs/tests.log"
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
(cd android && bash ./gradlew --no-daemon --max-workers=2 --console=plain :app:assembleRelease :app:assembleDebug) 2>&1 | tee "$OUTPUT/logs/android-build.log"
export OUTPUT REPO_ROOT
python3 - <<'PY'
from pathlib import Path
import os,subprocess,json,hashlib,zipfile,shutil,datetime
repo=Path(os.environ['REPO_ROOT']);out=Path(os.environ['OUTPUT']);sdk=Path(os.environ['ANDROID_HOME']);bt=sdk/'build-tools/36.0.0'
def run(args):
 r=subprocess.run([str(a) for a in args],text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
 return {'exit_code':r.returncode,'output':r.stdout}
results={}
for kind,relative,identity,version,debug in [
 ('UNSIGNED_ENGINEERING','release/app-release-unsigned.apk','com.makeuphouse.advisor','3.2.0-dev.5',False),
 ('DEBUG_ISOLATED_TEST_ONLY','debug/app-debug.apk','com.makeuphouse.advisor.engineering','3.2.0-dev.5-test',True)]:
 f=repo/'android/app/build/outputs/apk'/relative
 assert f.is_file(),str(f)
 a=run([bt/'aapt','dump','badging',f]);assert a['exit_code']==0
 assert f"name='{identity}'" in a['output'] and "versionCode='10'" in a['output'] and f"versionName='{version}'" in a['output']
 assert ('application-debuggable' in a['output'])==debug
 alignment=run([bt/'zipalign','-c','-P','16','4',f]);assert alignment['exit_code']==0
 signature=run([bt/'apksigner','verify','--verbose','--print-certs',f]);assert (signature['exit_code']==0)==debug
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
 dest=out/f'MAKEUP_HOUSE_ADVISOR_3.2.0_DEV5_{kind}.apk';shutil.copy2(f,dest)
 results[kind]={'file':dest.name,'bytes':dest.stat().st_size,'sha256':hashlib.file_digest(dest.open('rb'),'sha256').hexdigest(),'aapt':a,'signature':signature,'zip_alignment':alignment,'elf_headers':readelf,'all_elf_headers':all_elf_headers,'embedded_assets':embedded}
sha=subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip()
manifest={'git_sha':sha,'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'acceptance':'ENGINEERING_ONLY_NOT_PRODUCTION_APPROVED','physical_samsung':'NOT TESTED','permanent_signing':'DEFERRED_BY_OWNER','actual_artifacts':results}
(out/'DELIVERY_MANIFEST.json').write_text(json.dumps(manifest,indent=2)+'\n')
(out/'SHA256SUMS.txt').write_text(''.join(f"{r['sha256']}  {r['file']}\n" for r in results.values()))
commit=os.environ.get('GITHUB_SHA') or subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip()
subprocess.run(['git','archive','--format=zip','--output='+str(out/'MAKEUP_HOUSE_V32_SOURCE.zip'),commit],cwd=repo,check=True)
source=out/'MAKEUP_HOUSE_V32_SOURCE.zip'
manifest={'source_commit':commit,'status':'ENGINEERING_TEST_ONLY','production_approved':False,'model_reasoning_after_template_fix':'PARTIAL: Host real inference evidence retained; intelligence and Samsung acceptance not passed','physical_samsung':'NOT TESTED','permanent_signing':'DEFERRED BY OWNER','apks':results,'source_zip':{'file':source.name,'sha256':hashlib.file_digest(source.open('rb'),'sha256').hexdigest()},'ci_run':os.environ.get('GITHUB_RUN_ID')}
(out/'DELIVERY_MANIFEST.json').write_text(json.dumps(manifest,indent=2)+'\n')
with (out/'SHA256SUMS.txt').open('a') as checks:checks.write(manifest['source_zip']['sha256']+'  '+source.name+'\n')
(out/'FINAL_REPORT_AR.md').write_text(f'''# تسليم هندسي V3.2 — Unified Core

المصدر: `{commit}`. هذا Engineering Preview، وليس إصدارًا مقبولًا إنتاجيًا.

**PASS:** اختبارات البرمجيات وTypecheck وبناء Android وفحوص APK نجحت في هذا التشغيل؛ الأعداد والتفاصيل في السجلات.

**IMPLEMENTED:** نواة المستشار الرئيسية الموحدة، الربط بمحرك Native، تشخيص خام للمدير، سياق محدود، إظهار المسار الاحتياطي وأسباب الفشل، أدوات معرفة ومنتجات ومخزون وصور ومسودات مع تأكيد الحفظ. OCR عربي/إنجليزي محلي إن كان ضمن هذا Commit؛ راجع OCR_CHECKPOINT وبصمات الأصول في APK. OCR ليس VLM.

**PARTIAL/FAIL:** وُلّد نص فعلي على Host ومن الواجهة الرئيسية باستخدام Adapter حقيقي، لكن اختبار Qwen2B أظهر فشل فهم وتكرارًا/استيضاحًا غير مناسب. نجاح البرمجيات والبناء لا يثبت جودة الحوار أو الاستدلال العلمي. راجع ACCEPTANCE_MATRIX ونتائج النموذج الخام في المصدر. لم يُعتمد بديل للنموذج.

**NOT TESTED:** تشغيل هذا APK على Samsung، الأداء والذاكرة والبطارية والحرارة، العمل في وضع الطيران، قبول OCR على Android، المراجعة العلمية واللغوية المؤهلة. لا توجد شهادة تكافؤ مع ChatGPT.

**DEFERRED BY OWNER:** التوقيع الإنتاجي مؤجل وفق قرار المالك، وليس عائقًا للتطوير. APK غير الموقع لا يثبت مباشرة. Debug يحمل `com.makeuphouse.advisor.engineering` للتجربة المنفصلة؛ لا يحدّث التطبيق الدائم. مفتاح Debug المؤقت قد لا يطابق نسخة اختبار سابقة. عند تعارض التوقيع لا تحذف التطبيق أو البيانات؛ استخدم المفتاح الصحيح. لا يتضمن التسليم أوزان النموذج.

يحافظ التطبيق الدائم عند توقيعه بالمفتاح الصحيح على هويته ومسار الأوزان والبيانات؛ لم يُختبر التحديث الفعلي على الهاتف. راجع DELIVERY_MANIFEST.json وSHA256SUMS.txt للتحقق من الملفات والتوقيع.
''')
print(json.dumps({k:{'file':v['file'],'sha256':v['sha256']} for k,v in results.items()},indent=2))
PY
