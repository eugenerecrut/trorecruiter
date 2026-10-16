const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('C:/Users/eugen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 let html=fs.readFileSync(path.join(__dirname,'crm-case-assistant-fixture.html'),'utf8');
 html=html.replace(/<script src="\.\.\/([^"]+)"><\/script>/g,(_,name)=>'<script>'+fs.readFileSync(path.join(__dirname,'..',name),'utf8').replace(/<\/script/gi,'<\\/script')+'</script>');
 await page.setContent(html);await page.getByRole('button',{name:'Перевірити справу',exact:true}).click();
 await page.getByRole('heading',{name:'Перевірка особової справи'}).waitFor();
 await page.getByRole('button',{name:/Джерело:/}).click();
 if(await page.title()!=='Джерело відкрито')throw Error('Джерело не відкривається');
 await page.setViewportSize({width:390,height:844});
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Горизонтальне переповнення на мобільному');
 if(errors.length)throw Error(errors.join('; '));
 console.log('PASS report rendering, source button, mobile layout, no browser JS errors');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
