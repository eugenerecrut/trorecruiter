const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const root=path.join(__dirname,'..');
// Qwen proposed this pure helper; verified below and against original source hashes.
function canonicalHash(text) {
 const normalizedText=text.replace(/\r\n/g,'\n');
 const hash=createHash('sha256');
 hash.update(normalizedText,'utf8');
 return hash.digest('hex');
}
const originals={
 'fix-documents-button.yml':'b168d788eb24b1167e7c3ea2f9020ba67e28e1ecf0d41a0128e4bb33df7329ff',
 'add-delete-case-buttons.yml':'5274a97ac07ec5a7d9e57f2839463b930cad68f161cbe6a9c76fac09a5856c14',
 'fix-document-route-once.yml':'1ef19961ef86d9132abf83b56087818bbef9ee73e26be3ba6975a7cc518a3853'
};
test('obsolete one-off patches are retained intact outside executable workflows',()=>{
 for(const [file,hash] of Object.entries(originals)){
  assert.equal(fs.existsSync(path.join(root,'.github/workflows',file)),false,file);
  assert.equal(canonicalHash(fs.readFileSync(path.join(root,'docs/maintenance/retired-one-offs',file),'utf8')),hash,file);
 }
});
test('archive hash normalizes checkout line endings without trimming content',()=>{
 assert.equal(canonicalHash('one\r\ntwo\r\n'),canonicalHash('one\ntwo\n'));
 assert.notEqual(canonicalHash('one \n'),canonicalHash('one\n'));
 assert.notEqual(canonicalHash('one\n'),canonicalHash('one'));
});
test('regression deployment and scanner workflows remain available',()=>{
 for(const file of ['test-document-ai-sync.yml','static.yml','build-scanner-agent.yml'])assert(fs.existsSync(path.join(root,'.github/workflows',file)),file);
});
