// Synthetic local browser regression; never connects to production or invokes OCR.
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('C:/Users/eugen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const root=path.join(__dirname,'..'),browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  for(const [compact,factsShadow] of [[false,false],[true,false],[true,true]]){
   const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   // Inline repo assets so the fixture has no network or storage dependency.
   let html=fs.readFileSync(path.join(__dirname,'candidate-card-v3-fixture.html'),'utf8');
   html=html.replace("localStorage.setItem('crm.candidateCard.version.454','v3');",'window.CRMIntake.items=()=>[];window.CRMFeatureFlags={compactCaseView:'+compact+',factsShadow:'+factsShadow+'};');
   html=html.replace('<script src="../candidate-card-v3.js">', '<script src="../document-presence.js"></script><script src="../document-state.js"></script><script src="../candidate-field-registry.js"></script><script src="../service-record-readiness.js"></script><script src="../crm-case-assistant.js"></script><script src="../candidate-case-view.js"></script><script src="../candidate-card-v3.js">');
   html=html.replace('<script src="../candidate-card-v3.js">','<script src="../candidate-facts.js"></script><script src="../candidate-card-v3.js">');
   html=html.replace(/<link rel="stylesheet" href="\.\.\/([^"]+)">/g,(_,file)=>'<style>'+fs.readFileSync(path.join(root,file),'utf8')+'</style>');
   html=html.replace(/<script src="\.\.\/([^"]+)"><\/script>/g,(_,file)=>'<script>'+fs.readFileSync(path.join(root,file),'utf8').replace(/<\/script/gi,'<\\/script')+'</script>');
   await page.setContent(html);await page.waitForFunction(()=>document.querySelector('#qa-result').textContent==='V3 готова');
   await page.locator('#qa-tests').click();await page.waitForFunction(()=>/^(PASS|FAIL)/.test(document.querySelector('#qa-result').textContent));
   const result=await page.locator('#qa-result').textContent();if(!result.startsWith('PASS'))throw Error(result);
   if(await page.locator('.cc-facts-shadow').count()!==(factsShadow?1:0))throw Error('Shadow diagnostics visibility differs from feature flag');
   if(compact){
    await page.getByRole('tab',{name:'Сформувати справу',exact:true}).click();
    await page.locator('[data-full-package]').waitFor({state:'visible'});
    if(await page.locator('.wf-panel').getAttribute('open')!==null)throw Error('Stage panel should remain folded');
    if((await page.locator('.cc-case-summary').textContent()).includes('Не вдалося'))throw Error(await page.locator('.cc-case-summary').textContent());
    await page.getByRole('tab',{name:/Перевірити питання/}).click();
    const order=await page.evaluate(()=>document.querySelector('.cc-v3-header').compareDocumentPosition(document.querySelector('.cc-v3-intake-review'))&Node.DOCUMENT_POSITION_FOLLOWING);
    if(!order)throw Error('Questions precede identity header');
    await page.setViewportSize({width:390,height:844});
    // Fixture toolbar is test-only; measure the actual candidate screen.
    await page.addStyleTag({content:'#qa{display:none}'});
    if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Mobile horizontal overflow');
    for(const tab of await page.getByRole('tab').all())if(!await tab.isVisible())throw Error('Hidden primary action');
    await page.screenshot({path:path.join(root,'tmp/issue-71-compact-mobile.png'),fullPage:true});
   }
   if(errors.length)throw Error(errors.join('; '));console.log('PASS compact='+compact+', factsShadow='+factsShadow+': shared-save fixture, CAS, header order, browser errors; '+result);await page.close();
  }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
