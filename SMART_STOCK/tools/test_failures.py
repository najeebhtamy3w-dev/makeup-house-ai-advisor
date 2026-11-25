import glob, sys, xml.etree.ElementTree as ET
for f in sorted(glob.glob('app/build/test-results/testDebugUnitTest/*.xml')):
    r=ET.parse(f).getroot()
    print(r.get('name'), 'tests', r.get('tests'), 'fail', r.get('failures'), 'err', r.get('errors'))
    for tc in r.findall('testcase'):
        for fl in list(tc.findall('failure'))+list(tc.findall('error')):
            print('  FAIL', tc.get('name')); print('   ', '\n    '.join(fl.text.splitlines()[:int(sys.argv[1]) if len(sys.argv)>1 else 8]))
    so=r.find('system-out')
    if so is not None and so.text and so.text.strip(): print('  OUT:', so.text.strip()[:800])
