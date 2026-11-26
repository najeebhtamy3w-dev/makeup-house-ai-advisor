#!/usr/bin/env python3
"""Owner computer only: inspect public certificates; optionally set approved environment secrets.
No private key/password is printed or exported to a report. No upload occurs by default.
"""
import argparse, base64, getpass, hashlib, json, os, pathlib, re, shutil, subprocess
CERT='b51bf9b042277cf4fd0c36837c5a93d77cb673feb1c6ee9e57bd6026504d6386'
REPO='najeebhtamy3w-dev/makeup-house-ai-advisor'
BRANCH='work-v32-unified-scientific-core'
class PreflightError(Exception):pass

def run(args,env=None,input=None):
    result=subprocess.run([str(x) for x in args],env=env,input=input,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    if result.returncode:raise PreflightError('فشل '+pathlib.Path(str(args[0])).name+'؛ تحقق محليًا من الملف/كلمة المرور/الصلاحية. لم تُطبع الأسرار.')
    return result.stdout

def reference_apk(path,tools):
    output=run([tools/'apksigner','verify','--verbose','--print-certs',path]).decode('utf-8','replace')
    certificates=re.findall(r'^Signer #\d+ certificate SHA-256 digest: ([0-9a-fA-F]{64})$',output,re.M)
    if len(certificates)!=1:raise PreflightError('عدد شهادات APK غير متوقع؛ يلزم تحقيق منفصل في signing history.')
    badging=run([tools/'aapt','dump','badging',path]).decode('utf-8','replace')
    found=re.search(r"^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'",badging,re.M)
    if not found:raise PreflightError('تعذر استخراج هوية APK.')
    return {'filename':path.name,'apk_file_sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'application_id':found[1],'version_code':int(found[2]),'version_name':found[3],'signing_certificate_sha256':certificates[0].lower(),'source_of_installed_identity':'Owner must confirm this APK was extracted from the currently installed app; filename alone is not proof'}

def ensure_environment():
    info=json.loads(run(['gh','api','repos/'+REPO+'/environments/owner-signing']))
    reviewers=[r for r in info.get('protection_rules',[]) if r.get('type')=='required_reviewers' and r.get('reviewers')]
    branch_policy=info.get('deployment_branch_policy') or {}
    if not reviewers or not branch_policy.get('custom_branch_policies'):raise PreflightError('اضبط owner-signing مع Required reviewers وSelected branches قبل نقل الأسرار.')
    branches=json.loads(run(['gh','api','repos/'+REPO+'/environments/owner-signing/deployment-branch-policies']))
    allowed=branches.get('branch_policies',[])
    if len(allowed)!=1 or allowed[0].get('name')!=BRANCH or allowed[0].get('type','branch')!='branch':raise PreflightError('يجب السماح بالفرع المخصص المحدد فقط في بيئة التوقيع؛ احذف سياسات الفروع/الوسوم الأخرى من هذه البيئة وحدها.')


def keytool(args,password):
    env=dict(os.environ,MH_PREFLIGHT_PASSWORD=password)
    result=subprocess.run(['keytool','-J-Duser.language=en','-J-Duser.country=US',*map(str,args),'-storepass:env','MH_PREFLIGHT_PASSWORD'],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    if result.returncode:raise PreflightError('KEYTOOL_FAILED: تحقق من كلمة المرور والمسار وAlias محليًا؛ لم تُطبع الأسرار.')
    return result.stdout

def inspect_key(path,password,alias=None):
    listing=keytool(['-list','-v','-keystore',path],password).decode('utf-8','replace')
    entries=[]
    for item in listing.split('Alias name: ')[1:]:
        name=item.splitlines()[0].strip()
        if 'Entry type: PrivateKeyEntry' not in item:continue
        if alias is not None and name!=alias:continue
        der=keytool(['-exportcert','-keystore',path,'-alias',name],password)
        digest=hashlib.sha256(der).hexdigest()
        entries.append({'alias':name,'certificate_sha256':digest,'matches_historical_owner_certificate':digest==CERT})
    if not entries:raise PreflightError('لم يُعثر على PrivateKeyEntry/Alias المطلوب؛ الشهادة العامة وحدها لا تكفي للتوقيع.')
    return {'file':path.name,'bytes':path.stat().st_size,'file_sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'aliases':entries}

def main():
    parser=argparse.ArgumentParser(description='مقارنة ملفات JKS والشهادات محليًا دون إظهار الأسرار. لا رفع افتراضي.')
    parser.add_argument('keystores',nargs='+',type=pathlib.Path)
    parser.add_argument('--alias',help='Optional known private-key alias; otherwise inspect private-key aliases')
    parser.add_argument('--reference-apk',type=pathlib.Path)
    parser.add_argument('--build-tools',type=pathlib.Path,help='Android SDK build-tools directory containing apksigner/aapt')
    parser.add_argument('--report',type=pathlib.Path,default=pathlib.Path('OWNER_PUBLIC_SIGNING_PREFLIGHT.json'))
    parser.add_argument('--set-github-secrets',action='store_true',help='EXPLICIT upload to approved GitHub owner-signing environment; requires one JKS and verified reference APK')
    args=parser.parse_args()
    if not shutil.which('keytool'):raise PreflightError('يلزم Java JDK وkeytool على الكمبيوتر؛ لا تثبيت تلقائي.')
    if args.report.exists():raise PreflightError('ملف التقرير موجود؛ اختر --report جديدًا حتى لا يُستبدل.')
    records=[];credentials=[]
    for path in args.keystores:
        if not path.is_file() or not 512<=path.stat().st_size<=1024*1024:raise PreflightError('ملف JKS غير صالح أو حجمه خارج الحد.')
        password=getpass.getpass('كلمة مرور المخزن '+path.name+' (لن تظهر): ')
        record=inspect_key(path,password,args.alias);records.append(record);credentials.append(password)
    reference=None
    if args.reference_apk:
        if not args.build_tools:raise PreflightError('استخدم --build-tools للتحقق من APK باستخدام apksigner وaapt.')
        reference=reference_apk(args.reference_apk,args.build_tools)
    report={'historical_owner_certificate_sha256':CERT,'jks_files':records,'same_jks_bytes':len({r['file_sha256'] for r in records})==1 if len(records)>1 else None,'reference_apk':reference,'physical_installed_apk_match':'NOT VERIFIED BY THIS SCRIPT; owner extraction evidence required','private_key_or_password_in_report':False,'secrets_uploaded':False}
    if args.set_github_secrets:
        if len(records)!=1 or not reference:raise PreflightError('رفع الأسرار يحتاج ملف JKS واحدًا وAPK مرجعيًا متحققًا. قارن النسختين أولًا دون خيار الرفع.')
        matching=[k for k in records[0]['aliases'] if k['matches_historical_owner_certificate']]
        if len(matching)!=1 or reference['signing_certificate_sha256']!=CERT or reference['application_id']!='com.makeuphouse.advisor':raise PreflightError('الشهادة أو هوية التطبيق غير مطابقة؛ يمنع إعداد التوقيع باعتباره تحديثًا.')
        ensure_environment()
        answer=input('أكد أن APK المرجعي مستخرج من التطبيق المثبت الآن، وأنك راجعت Workflow. اكتب CONFIRM: ')
        if answer!='CONFIRM':raise PreflightError('لم يُؤكد نقل الأسرار؛ لا رفع.')
        key_password=getpass.getpass('كلمة مرور المفتاح الخاص (Enter إذا كانت كلمة مرور المخزن نفسها): ') or credentials[0]
        secret_values={'ANDROID_KEYSTORE_BASE64':base64.b64encode(args.keystores[0].read_bytes()),'ANDROID_KEYSTORE_PASSWORD':credentials[0].encode(),'ANDROID_KEY_ALIAS':matching[0]['alias'].encode(),'ANDROID_KEY_PASSWORD':key_password.encode()}
        for name,value in secret_values.items():run(['gh','secret','set',name,'--repo',REPO,'--env','owner-signing'],input=value)
        report['secrets_uploaded']=True
    args.report.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print('حُفظ التقرير العام: '+str(args.report))
    for record in records:
        print(record['file']+' — JKS file SHA-256: '+record['file_sha256'])
        for key in record['aliases']:print('Alias: '+key['alias']+' — certificate SHA-256: '+key['certificate_sha256']+' — historical match: '+str(key['matches_historical_owner_certificate']))
    print('هذا لا يثبت اختبار تحديث Samsung أو ترحيل بياناته. لا تشارك المفتاح أو كلمة المرور في المحادثة.')
if __name__=='__main__':
    try:main()
    except PreflightError as error:raise SystemExit(str(error))
