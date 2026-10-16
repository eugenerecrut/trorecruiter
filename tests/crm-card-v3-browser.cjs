const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('C:/Users/eugen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});try{
 const page=await browser.newPage();let html=fs.readFileSync(path.join(__dirname,'candidate-card-v3-fixture.html'),'utf8');
 html=html.replace(/<script src="\.\.\/([^"]+)"><\/script>/g,(_,name)=>'<script>'+fs.readFileSync(path.join(__dirname,'..',name),'utf8').replace(/<\/script/gi,'<\\/script')+'</script>').replace(/<link rel="stylesheet" href="\.\.\/([^"]+)">/g,(_,name)=>'<style>'+fs.readFileSync(path.join(__dirname,'..',name),'utf8')+'</style>');
 await page.route('http://crm.test/**',r=>r.fulfill({body:html,contentType:'text/html'}));await page.goto('http://crm.test/');await page.getByText('V3 готова',{exact:true}).waitFor();await page.getByRole('button',{name:'Перевірити сценарії'}).click();await page.waitForFunction(()=>/PASS|FAIL/.test(document.getElementById('qa-result').textContent));const result=await page.locator('#qa-result').textContent();console.log(result);if(!result.startsWith('PASS'))throw Error(result);
 }finally{await browser.close()}})().catch(e=>{console.error(e.message);process.exit(1)});
