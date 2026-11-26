"""Signing boundaries and real ephemeral key checks; never uses or creates an owner key."""
import importlib.util, pathlib, tempfile, zipfile, io, json, unittest, copy, hashlib, os, shutil, subprocess, contextlib, sys
from unittest.mock import patch
ROOT=pathlib.Path(__file__).resolve().parents[1]
def load(name,path):
 spec=importlib.util.spec_from_file_location(name,ROOT/path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
ci=load('ci_owner_sign','scripts/ci-owner-sign.py')
pre=load('owner_preflight','scripts/owner-signing-preflight.py')
COMMIT='a'*40
APK_NAME='MAKEUP_HOUSE_ADVISOR_3.2.0_DEV2_UNSIGNED_ENGINEERING.apk'
def payload(content=b'synthetic-APK-not-installable',**changes):
 manifest={'source_commit':COMMIT,'ci_run':'123','production_approved':False,'status':'ENGINEERING_TEST_ONLY','apks':{'UNSIGNED_ENGINEERING':{'file':APK_NAME,'bytes':len(content),'sha256':hashlib.sha256(content).hexdigest()}}}
 manifest.update(changes);return manifest
def archive(manifest=None,content=b'synthetic-APK-not-installable',extra=None):
 out=io.BytesIO()
 with zipfile.ZipFile(out,'w') as z:
  z.writestr('DELIVERY_MANIFEST.json',json.dumps(manifest or payload(content)))
  z.writestr(APK_NAME,content)
  for name,value in (extra or {}).items():z.writestr(name,value)
 return out.getvalue()
class SigningBoundaries(unittest.TestCase):
 def valid_run(self):return {'id':123,'status':'completed','conclusion':'success','head_sha':COMMIT,'head_branch':ci.BRANCH,'path':'.github/workflows/v32-engineering.yml','event':'push','repository':{'full_name':ci.REPO},'head_repository':{'full_name':ci.REPO}}
 def test_successful_build_identity_and_content_are_bound(self):
  ci.validate_run(self.valid_run(),123,COMMIT);content,m=ci.extract_unsigned(archive(),COMMIT,123);self.assertEqual(content,b'synthetic-APK-not-installable');self.assertEqual(m['source_commit'],COMMIT)
 def test_foreign_repository_event_branch_workflow_or_unsuccessful_run_rejected(self):
  for key,value in [('event','pull_request'),('head_branch','main'),('head_sha','b'*40),('path','.github/workflows/other.yml'),('conclusion','failure'),('status','in_progress'),('head_repository',{'full_name':'other/fork'})]:
   run=self.valid_run();run[key]=value
   with self.subTest(key=key),self.assertRaises(ci.SigningError):ci.validate_run(run,123,COMMIT)
 def test_artifact_digest_and_unique_source_name_required(self):
  item={'name':'makeup-house-v32-engineering-'+COMMIT,'expired':False,'size_in_bytes':10,'digest':'sha256:'+'1'*64}
  self.assertEqual(ci.select_artifact({'artifacts':[item]},COMMIT),item)
  for items in [[],[item,item],[dict(item,digest='')],[dict(item,expired=True)]]:
   with self.assertRaises(ci.SigningError):ci.select_artifact({'artifacts':items},COMMIT)
 def test_apk_tamper_rejected_even_when_filename_matches(self):
  with self.assertRaisesRegex(ci.SigningError,'APK_HASH_MISMATCH'):ci.extract_unsigned(archive(payload(),content=b'changed'),COMMIT,123)
 def test_wrong_manifest_source_run_or_classification_rejected(self):
  for changes in [{'source_commit':'b'*40},{'ci_run':'124'},{'production_approved':True},{'status':'PRODUCTION'}]:
   with self.subTest(changes=changes),self.assertRaises(ci.SigningError):ci.extract_unsigned(archive(payload(**changes)),COMMIT,123)
 def test_archive_traversal_and_absolute_paths_never_extracted(self):
  for path in ['../owner.jks','/tmp/owner.jks','dir\\owner.jks']:
   with self.subTest(path=path),self.assertRaisesRegex(ci.SigningError,'UNSAFE_ARCHIVE_PATH'):ci.extract_unsigned(archive(extra={path:b'x'}),COMMIT,123)
 def test_debug_or_other_package_cannot_be_signed_as_owner_update(self):
  with patch.object(ci,'command',return_value="package: name='com.makeuphouse.advisor.engineering' versionCode='7' versionName='3.2.0-dev.2-test'\napplication-debuggable"):
   with self.assertRaisesRegex(ci.SigningError,'APK_IDENTITY_OR_DEBUG'):ci.apk_identity(pathlib.Path('/synthetic'),pathlib.Path('/synthetic.apk'))
 def test_certificate_normalization_does_not_accept_file_hash_by_name(self):
  colon=':'.join(ci.CERT[i:i+2] for i in range(0,64,2)).upper();self.assertEqual(ci.normalize_cert(colon),ci.CERT)
  with self.assertRaises(ci.SigningError):ci.normalize_cert('SHA256SUMS-3.0.0.txt')
 def test_secret_upload_preflight_rejects_unprotected_or_wildcard_environment(self):
  good={'protection_rules':[{'type':'required_reviewers','reviewers':[{'id':1}]}],'deployment_branch_policy':{'custom_branch_policies':True}}
  exact={'branch_policies':[{'name':pre.BRANCH,'type':'branch'}]}
  with patch.object(pre,'run',side_effect=[json.dumps(good).encode(),json.dumps(exact).encode()]):pre.ensure_environment()
  for branch in [{'branch_policies':[{'name':'*','type':'branch'}]},{'branch_policies':[{'name':pre.BRANCH,'type':'branch'},{'name':'main','type':'branch'}]}]:
   with patch.object(pre,'run',side_effect=[json.dumps(good).encode(),json.dumps(branch).encode()]),self.assertRaises(pre.PreflightError):pre.ensure_environment()
  with patch.object(pre,'run',return_value=json.dumps({'protection_rules':[],'deployment_branch_policy':{'custom_branch_policies':True}}).encode()),self.assertRaises(pre.PreflightError):pre.ensure_environment()
 @unittest.skipUnless(shutil.which('keytool'),'JDK keytool unavailable; not a signing pass')
 def test_real_temporary_key_is_not_accepted_as_owner_certificate(self):
  with tempfile.TemporaryDirectory() as directory:
   path=pathlib.Path(directory)/'TEST_ONLY.jks';password='temporary-test-only-894233'
   env=dict(os.environ,MH_TEST_PASSWORD=password,ANDROID_KEYSTORE_PASSWORD=password)
   result=subprocess.run(['keytool','-genkeypair','-keystore',str(path),'-storetype','JKS','-alias','test-only','-keyalg','RSA','-keysize','2048','-validity','1','-dname','CN=TEMPORARY_ENGINEERING_TEST_ONLY','-storepass:env','MH_TEST_PASSWORD','-keypass:env','MH_TEST_PASSWORD','-noprompt'],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
   self.assertEqual(result.returncode,0,'ephemeral fixture generation failed')
   with patch.dict(os.environ,{'ANDROID_KEYSTORE_PASSWORD':password}):actual=ci.key_certificate(path,'test-only')
   self.assertEqual(len(actual),64);self.assertNotEqual(actual,ci.CERT)
   with self.assertRaisesRegex(ci.SigningError,'OWNER_KEY_CERTIFICATE_MISMATCH'):ci.require(actual==ci.CERT,'OWNER_KEY_CERTIFICATE_MISMATCH')
   inspected=pre.inspect_key(path,password,'test-only');self.assertEqual(inspected['aliases'][0]['certificate_sha256'],actual);self.assertFalse(inspected['aliases'][0]['matches_historical_owner_certificate'])
   report=pathlib.Path(directory)/'public.json'
   with patch.object(sys,'argv',['owner-signing-preflight.py',str(path),'--report',str(report)]),patch.object(pre.getpass,'getpass',return_value=password),patch.object(pre,'ensure_environment') as no_upload,contextlib.redirect_stdout(io.StringIO()) as output:
    pre.main()
   no_upload.assert_not_called();public=json.loads(report.read_text());self.assertFalse(public['secrets_uploaded']);self.assertNotIn(password,report.read_text());self.assertIn(actual,output.getvalue());self.assertNotIn(password,output.getvalue())
if __name__=='__main__':unittest.main()
