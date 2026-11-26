#!/usr/bin/env python3
"""Sign a previously verified engineering artifact. Never builds code or publishes a release."""
import base64, hashlib, io, json, os, pathlib, re, shutil, subprocess, tempfile, urllib.error, urllib.request, zipfile

REPO='najeebhtamy3w-dev/makeup-house-ai-advisor'
BRANCH='work-v32-unified-scientific-core'
CERT='b51bf9b042277cf4fd0c36837c5a93d77cb673feb1c6ee9e57bd6026504d6386'
PACKAGE='com.makeuphouse.advisor'
MAX_ARCHIVE=512*1024*1024
class SigningError(Exception): pass

def require(ok, code):
    if not ok: raise SigningError(code)
def sha(data): return hashlib.sha256(data).hexdigest()
def normalize_cert(value):
    result=value.replace(':','').strip().lower()
    require(bool(re.fullmatch('[0-9a-f]{64}',result)), 'CERTIFICATE_FORMAT')
    return result

def validate_run(run,run_id,commit):
    require(run.get('id')==run_id and run.get('status')=='completed' and run.get('conclusion')=='success','ENGINEERING_RUN_NOT_SUCCESSFUL')
    require(run.get('head_sha')==commit and run.get('head_branch')==BRANCH,'ENGINEERING_SOURCE_MISMATCH')
    require(run.get('path')=='.github/workflows/v32-engineering.yml','ENGINEERING_WORKFLOW_MISMATCH')
    require(run.get('event') in ('push','workflow_dispatch'),'UNTRUSTED_BUILD_EVENT')
    require((run.get('repository') or {}).get('full_name')==REPO and (run.get('head_repository') or {}).get('full_name')==REPO,'BUILD_REPOSITORY_MISMATCH')

def select_artifact(payload,commit):
    found=[x for x in payload.get('artifacts',[]) if x.get('name')=='makeup-house-v32-engineering-'+commit and not x.get('expired')]
    require(len(found)==1,'ARTIFACT_MISSING_OR_AMBIGUOUS')
    item=found[0];require(0<item.get('size_in_bytes',0)<=MAX_ARCHIVE,'ARTIFACT_SIZE')
    require(bool(re.fullmatch(r'sha256:[0-9a-f]{64}',item.get('digest',''))),'ARTIFACT_DIGEST_REQUIRED')
    return item

def extract_unsigned(data,commit,run_id):
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        names=z.namelist();require(len(names)==len(set(names)),'DUPLICATE_ARCHIVE_ENTRY')
        require(all(not n.startswith(('/','\\')) and '\\' not in n and '..' not in pathlib.PurePosixPath(n).parts for n in names),'UNSAFE_ARCHIVE_PATH')
        require('DELIVERY_MANIFEST.json' in names,'MANIFEST_MISSING')
        require(z.getinfo('DELIVERY_MANIFEST.json').file_size<=2*1024*1024,'MANIFEST_SIZE')
        manifest=json.loads(z.read('DELIVERY_MANIFEST.json'))
        require(manifest.get('source_commit')==commit and str(manifest.get('ci_run'))==str(run_id),'ARTIFACT_SOURCE_MISMATCH')
        require(manifest.get('production_approved') is False and manifest.get('status')=='ENGINEERING_TEST_ONLY','ARTIFACT_CLASSIFICATION')
        apk=manifest.get('apks',{}).get('UNSIGNED_ENGINEERING',{})
        name=apk.get('file','');require(bool(re.fullmatch(r'MAKEUP_HOUSE_ADVISOR_[0-9A-Za-z._-]+_UNSIGNED_ENGINEERING\.apk',name)),'APK_NAME')
        require(name in names and 0<z.getinfo(name).file_size<=128*1024*1024,'APK_SIZE')
        content=z.read(name);require(len(content)==apk.get('bytes') and sha(content)==apk.get('sha256'),'APK_HASH_MISMATCH')
        return content,manifest

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs): return None

def api(path):
    request=urllib.request.Request('https://api.github.com/repos/'+REPO+path,headers={'Authorization':'Bearer '+os.environ['GITHUB_TOKEN'],'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'})
    with urllib.request.urlopen(request,timeout=60) as response:return json.load(response)

def download_artifact(artifact):
    request=urllib.request.Request('https://api.github.com/repos/'+REPO+'/actions/artifacts/'+str(artifact['id'])+'/zip',headers={'Authorization':'Bearer '+os.environ['GITHUB_TOKEN'],'Accept':'application/vnd.github+json'})
    try:
        response=urllib.request.build_opener(NoRedirect()).open(request,timeout=60)
    except urllib.error.HTTPError as error:
        require(error.code in (301,302,303,307,308),'ARTIFACT_DOWNLOAD_FAILED')
        url=error.headers.get('Location','');require(url.startswith('https://'),'ARTIFACT_REDIRECT_INVALID')
        # Do NOT forward GitHub credentials to signed object-storage URLs.
        response=urllib.request.urlopen(urllib.request.Request(url),timeout=90)
    with response:
        data=bytearray()
        while chunk:=response.read(1024*1024):
            data.extend(chunk);require(len(data)<=MAX_ARCHIVE,'ARTIFACT_DOWNLOAD_SIZE')
    require('sha256:'+sha(data)==artifact['digest'],'ARCHIVE_DIGEST_MISMATCH')
    return bytes(data)

def command(args,allow_failure=False,binary=False):
    result=subprocess.run([str(x) for x in args],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    if result.returncode and not allow_failure:raise SigningError('TOOL_FAILED:'+pathlib.Path(str(args[0])).name)
    return result if binary else result.stdout.decode('utf-8','replace')

def apk_identity(bt,path):
    text=command([bt/'aapt','dump','badging',path]);match=re.search(r"^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'",text,re.M)
    require(bool(match),'APK_IDENTITY_UNREADABLE');package,code,name=match.groups()
    require(package==PACKAGE and 'application-debuggable' not in text,'APK_IDENTITY_OR_DEBUG')
    require(bool(re.fullmatch(r'3\.2\.0(?:[-.][A-Za-z0-9._-]+)?',name)),'APK_VERSION_NAME')
    return {'application_id':package,'version_code':int(code),'version_name':name}

def check_native_alignment(sdk,path):
    ndk=sdk/'ndk/28.2.13676358/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-readelf'
    if not ndk.is_file():
        ndk=pathlib.Path(shutil.which('readelf') or '')
    require(ndk.is_file(),'ELF_READER_REQUIRED')
    with zipfile.ZipFile(path) as z, tempfile.TemporaryDirectory() as temp:
        require(z.testzip() is None,'APK_ZIP_INTEGRITY')
        libs=[n for n in z.namelist() if n.startswith('lib/') and n.endswith('.so')]
        require('lib/arm64-v8a/libmh_local_ai.so' in libs and all(n.startswith('lib/arm64-v8a/') for n in libs),'APK_ARM64_LIBRARIES')
        for name in libs:
            target=pathlib.Path(temp)/'probe.so';target.write_bytes(z.read(name))
            text=command([ndk,'-lW',target]);loads=[x for x in text.splitlines() if x.strip().startswith('LOAD')]
            require(bool(loads) and all(int(x.split()[-1],16)>=16384 for x in loads),'APK_ELF_ALIGNMENT')

def key_certificate(key,alias):
    cert=command(['keytool','-exportcert','-keystore',key,'-alias',alias,'-storepass:env','ANDROID_KEYSTORE_PASSWORD'],binary=True).stdout
    require(bool(cert),'KEY_CERTIFICATE_MISSING');return sha(cert)

def main():
    require(os.environ.get('GITHUB_EVENT_NAME') in ('workflow_dispatch','push'),'OWNER_REQUEST_EVENT_REQUIRED')
    if os.environ.get('GITHUB_EVENT_NAME')=='push':
        request=json.loads(pathlib.Path('.github/owner-signing-request.json').read_text())
        require(set(request)=={'engineering_run_id','expected_source_sha','installed_certificate_sha256','installed_version_code'},'SIGNING_REQUEST_FIELDS')
        for field,variable in [('engineering_run_id','ENGINEERING_RUN_ID'),('expected_source_sha','EXPECTED_SOURCE_SHA'),('installed_certificate_sha256','INSTALLED_CERTIFICATE_SHA256'),('installed_version_code','INSTALLED_VERSION_CODE')]:
            require(isinstance(request[field],(str,int)) and not isinstance(request[field],bool),'SIGNING_REQUEST_VALUE')
            os.environ[variable]=str(request[field])
    require(os.environ.get('GITHUB_REF')=='refs/heads/'+BRANCH and os.environ.get('GITHUB_REPOSITORY')==REPO,'TRUSTED_BRANCH_REQUIRED')
    require(os.environ.get('OWNER_SIGNING_ENABLED')=='true','OWNER_ENVIRONMENT_NOT_ENABLED')
    for name in ('GITHUB_TOKEN','ANDROID_KEYSTORE_BASE64','ANDROID_KEYSTORE_PASSWORD','ANDROID_KEY_ALIAS','ANDROID_KEY_PASSWORD'):
        require(bool(os.environ.get(name)), 'REQUIRED_SECRET_MISSING:'+name)
    commit=os.environ.get('EXPECTED_SOURCE_SHA','');require(bool(re.fullmatch('[0-9a-f]{40}',commit)),'SOURCE_SHA_INVALID')
    require(os.environ.get('ENGINEERING_RUN_ID','').isdigit(),'RUN_ID_INVALID');run_id=int(os.environ['ENGINEERING_RUN_ID'])
    require(normalize_cert(os.environ.get('INSTALLED_CERTIFICATE_SHA256',''))==CERT,'INSTALLED_REFERENCE_CERTIFICATE_MISMATCH')
    require(os.environ.get('INSTALLED_VERSION_CODE','').isdigit() and 0<int(os.environ['INSTALLED_VERSION_CODE'])<2100000000,'INSTALLED_VERSION_CODE_REQUIRED')
    run=api('/actions/runs/'+str(run_id));validate_run(run,run_id,commit)
    artifact=select_artifact(api('/actions/runs/'+str(run_id)+'/artifacts?per_page=100'),commit)
    content,manifest=extract_unsigned(download_artifact(artifact),commit,run_id)
    sdk=pathlib.Path(os.environ['ANDROID_HOME']);bt=sdk/'build-tools/36.0.0'
    for name in ('apksigner','aapt','zipalign'):require((bt/name).is_file(),'CACHED_BUILD_TOOLS_REQUIRED')
    output=pathlib.Path('artifacts/v3.2-owner-signed');require(not output.exists(),'OUTPUT_ALREADY_EXISTS');output.mkdir(parents=True)
    # The private file is outside the artifact directory. Context cleanup runs on all normal failures.
    os.umask(0o077)
    with tempfile.TemporaryDirectory(prefix='mh-owner-sign-',dir=os.environ['RUNNER_TEMP']) as temp:
        temp=pathlib.Path(temp);key=temp/'owner.jks'
        try:key_bytes=base64.b64decode(os.environ['ANDROID_KEYSTORE_BASE64'],validate=True)
        except Exception:raise SigningError('KEYSTORE_BASE64_INVALID')
        require(512<=len(key_bytes)<=1024*1024,'KEYSTORE_SIZE_INVALID');key.write_bytes(key_bytes);key.chmod(0o600);del key_bytes
        alias=os.environ['ANDROID_KEY_ALIAS'];require(0<len(alias)<=200 and not any(ord(c)<32 for c in alias),'KEY_ALIAS_INVALID')
        actual=key_certificate(key,alias);require(actual==CERT,'OWNER_KEY_CERTIFICATE_MISMATCH')
        unsigned=temp/'unsigned.apk';unsigned.write_bytes(content)
        identity=apk_identity(bt,unsigned);require(identity['version_code']>int(os.environ['INSTALLED_VERSION_CODE']),'VERSION_CODE_NOT_NEWER')
        require(command([bt/'apksigner','verify',unsigned],allow_failure=True,binary=True).returncode!=0,'EXPECTED_UNSIGNED_APK')
        check_native_alignment(sdk,unsigned)
        aligned=temp/'aligned.apk';command([bt/'zipalign','-P','16','-f','4',unsigned,aligned])
        signed=temp/'signed.apk';command([bt/'apksigner','sign','--ks',key,'--ks-key-alias',alias,'--ks-pass','env:ANDROID_KEYSTORE_PASSWORD','--key-pass','env:ANDROID_KEY_PASSWORD','--out',signed,aligned])
        verified=command([bt/'apksigner','verify','--verbose','--print-certs',signed]);certs=re.findall(r'^Signer #\d+ certificate SHA-256 digest: ([0-9a-fA-F]+)$',verified,re.M)
        require(certs==[CERT],'SIGNED_CERTIFICATE_MISMATCH');require(apk_identity(bt,signed)==identity,'SIGNED_IDENTITY_CHANGED')
        command([bt/'zipalign','-c','-P','16','4',signed]);check_native_alignment(sdk,signed)
        final=output/('MAKEUP_HOUSE_ADVISOR_'+identity['version_name']+'_OWNER_SIGNED_ENGINEERING.apk');shutil.copyfile(signed,final)
    report={'classification':'OWNER_SIGNED_ENGINEERING_CANDIDATE','production_approved':False,'source_commit':commit,'signing_workflow_commit':os.environ.get('GITHUB_SHA'),'engineering_run':run_id,'engineering_artifact':artifact['id'],'identity':identity,'signing_certificate_sha256':CERT,'installed_reference':'OWNER_REPORTED_PUBLIC_CERTIFICATE_AND_VERSION; PHONE APK NOT EXTRACTED BY THIS WORKFLOW','physical_update_test':'NOT TESTED','data_model_preservation':'NO DATA OR WEIGHTS INCLUDED/DELETED; ACTUAL DEVICE UPDATE/MIGRATION NOT TESTED','file':final.name,'sha256':sha(final.read_bytes()),'bytes':final.stat().st_size}
    (output/'SIGNED_RELEASE_MANIFEST.json').write_text(json.dumps(report,indent=2)+'\n')
    (output/'SHA256SUMS.txt').write_text(report['sha256']+'  '+final.name+'\n')
    (output/'SIGNATURE_VERIFICATION.txt').write_text(verified)
    print('PASS: exact owner certificate, application identity, version progression, ARM64 alignment and final signature verified. Engineering candidate only; Samsung acceptance remains required.')
if __name__=='__main__':
    try:main()
    except SigningError as error:raise SystemExit(str(error))
    except (OSError,ValueError,KeyError,zipfile.BadZipFile):raise SystemExit('SIGNING_PRECHECK_FAILED: required input, tool, artifact or network unavailable; no key output produced')
