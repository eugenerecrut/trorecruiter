// Camera/photos -> reviewed pages -> PDF File -> the existing CRM uploader.
// Photos stay in browser memory until the user explicitly uploads the PDF.
(function () {
  'use strict';
  const MAX_PAGES = 30;
  const MAX_SOURCES = 45 * 1024 * 1024;
  const MAX_FILE = 20 * 1024 * 1024;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;'}[c]));
  let session = null;

  function imageFromBlob(blob) {
    return new Promise((resolve, reject) => {
      const image = new Image(), url = URL.createObjectURL(blob);
      image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Фото не вдалося відкрити. Збережіть його як JPG або PNG та спробуйте ще раз.')); };
      image.src = url;
    });
  }
  function jpeg(canvas, quality = 0.9) {
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Не вдалося підготувати сторінку.')), 'image/jpeg', quality));
  }
  function newCanvas(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d', {alpha: false});
    if (!ctx) throw new Error('Браузер не підтримує обробку фото.');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height);
    return {canvas, ctx};
  }
  async function normalizePhoto(file) {
    if (file.size > 25 * 1024 * 1024) throw new Error('Окреме фото більше за 25 МБ. Виберіть менше фото.');
    if (file.type && !file.type.startsWith('image/')) throw new Error('Для сканування виберіть фото. Готовий PDF завантажується через «Додати документи».');
    const image = await imageFromBlob(file);
    const scale = Math.min(1, 2400 / Math.max(image.naturalWidth, image.naturalHeight));
    const {canvas, ctx} = newCanvas(Math.max(1, Math.round(image.naturalWidth * scale)), Math.max(1, Math.round(image.naturalHeight * scale)));
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const source = await jpeg(canvas);
    canvas.width = canvas.height = 0;
    return source;
  }

  // A small PDF writer for RGB JPEG pages. Byte offsets use encoded lengths.
  async function buildPDF(pages) {
    const encoder = new TextEncoder(), chunks = [], offsets = [0];
    let length = 0;
    const append = value => {
      const bytes = typeof value === 'string' ? encoder.encode(value) : value;
      chunks.push(bytes); length += bytes.length;
    };
    const object = (id, body) => { offsets[id] = length; append(id + ' 0 obj\n'); append(body); append('\nendobj\n'); };
    append('%PDF-1.4\n'); append(new Uint8Array([37,226,227,207,211,10]));
    object(1, '<< /Type /Catalog /Pages 2 0 R >>');
    object(2, '<< /Type /Pages /Count ' + pages.length + ' /Kids [' + pages.map((_, i) => (3 + i * 3) + ' 0 R').join(' ') + '] >>');
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i], id = 3 + i * 3, landscape = page.width > page.height;
      const pw = landscape ? 841.89 : 595.28, ph = landscape ? 595.28 : 841.89;
      const scale = Math.min((pw - 24) / page.width, (ph - 24) / page.height);
      const w = page.width * scale, h = page.height * scale;
      const content = 'q\n' + [w, 0, 0, h, (pw - w) / 2, (ph - h) / 2].map(x => x.toFixed(3)).join(' ') + ' cm\n/Photo Do\nQ\n';
      object(id, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + pw + ' ' + ph + '] /Resources << /XObject << /Photo ' + (id + 1) + ' 0 R >> >> /Contents ' + (id + 2) + ' 0 R >>');
      const bytes = new Uint8Array(await page.image.arrayBuffer());
      offsets[id + 1] = length;
      append((id + 1) + ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + page.width + ' /Height ' + page.height + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + bytes.length + ' >>\nstream\n');
      append(bytes); append('\nendstream\nendobj\n');
      object(id + 2, '<< /Length ' + encoder.encode(content).length + ' >>\nstream\n' + content + 'endstream');
    }
    const xref = length, count = 3 + pages.length * 3;
    append('xref\n0 ' + count + '\n0000000000 65535 f \n');
    for (let id = 1; id < count; id++) append(String(offsets[id]).padStart(10, '0') + ' 00000 n \n');
    append('trailer\n<< /Size ' + count + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
    return new Blob(chunks, {type: 'application/pdf'});
  }

  const CORNERS = ['tl', 'tr', 'br', 'bl'];
  const fullCorners = () => [{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}];
  const copyCorners = points => points.map(p => ({...p}));
  const yieldUI = () => new Promise(resolve => setTimeout(resolve, 0));
  const cross = (a,b,c) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  const area = points => Math.abs(points.reduce((sum,p,i) => {const q=points[(i+1)%points.length];return sum+p.x*q.y-p.y*q.x;},0))/2;
  function validCorners(points) {
    return area(points) >= 100 && points.every((p,i) => cross(p,points[(i+1)%4],points[(i+2)%4]) > 1 && Math.hypot(p.x-points[(i+1)%4].x,p.y-points[(i+1)%4].y) >= 3);
  }
  function hull(points) {
    points.sort((a,b)=>a.x-b.x||a.y-b.y);
    const lower=[],upper=[];
    for (const p of points) {while(lower.length>1&&cross(lower.at(-2),lower.at(-1),p)<=0)lower.pop();lower.push(p);}
    for (let i=points.length-1;i>=0;i--) {const p=points[i];while(upper.length>1&&cross(upper.at(-2),upper.at(-1),p)<=0)upper.pop();upper.push(p);}
    lower.pop();upper.pop();return lower.concat(upper);
  }
  // Detect a bright sheet against its background on a small image. Uncertain
  // shapes fall back to the whole photo; original pixels are always retained.
  function detectCorners(canvas, {minArea=.035,maxSide=420} = {}) {
    const scale=Math.min(1,maxSide/Math.max(canvas.width,canvas.height));
    const sample=newCanvas(Math.max(1,Math.round(canvas.width*scale)),Math.max(1,Math.round(canvas.height*scale)));
    const w=sample.canvas.width,h=sample.canvas.height,n=w*h;
    sample.ctx.drawImage(canvas,0,0,w,h);
    const rgba=sample.ctx.getImageData(0,0,w,h).data,gray=new Uint8Array(n),hist=new Uint32Array(256);
    for(let i=0;i<n;i++){gray[i]=Math.round(.299*rgba[i*4]+.587*rgba[i*4+1]+.114*rgba[i*4+2]);hist[gray[i]]++;}
    sample.canvas.width=sample.canvas.height=0;
    let total=0;for(let i=0;i<256;i++)total+=i*hist[i];
    let count=0,sum=0,variance=0,threshold=160;
    for(let i=0;i<255;i++){count+=hist[i];sum+=i*hist[i];if(!count||count===n)continue;const v=count*(n-count)*Math.pow(sum/count-(total-sum)/(n-count),2);if(v>variance){variance=v;threshold=i;}}
    let best=null;
    for(const cut of new Set([Math.max(65,threshold),Math.max(100,Math.min(220,threshold+25)),180,215])) {
      const seen=new Uint8Array(n),queue=new Int32Array(n);
      for(let start=0;start<n;start++) {
        if(seen[start]||gray[start]<=cut)continue;
        let head=0,tail=1;queue[0]=start;seen[start]=1;const boundary=[];
        let edges=0,brightness=0;
        while(head<tail){const id=queue[head++],x=id%w,y=Math.floor(id/w);brightness+=gray[id];let border=false;
          if(!x||!y||x===w-1||y===h-1)edges++;
          for(const next of [x>0?id-1:-1,x<w-1?id+1:-1,y>0?id-w:-1,y<h-1?id+w:-1]) {
            if(next<0||gray[next]<=cut){border=true;continue;}if(!seen[next]){seen[next]=1;queue[tail++]=next;}
          }
          if(border)boundary.push({x,y});
        }
        if(tail<n*minArea*.8||tail>n*.94||edges>2*(w+h)*.12)continue;
        let outline=hull(boundary);if(outline.length<4)continue;
        const hullArea=area(outline);
        while(outline.length>4){let remove=0,min=Infinity;for(let i=0;i<outline.length;i++){const v=Math.abs(cross(outline[(i+outline.length-1)%outline.length],outline[i],outline[(i+1)%outline.length]));if(v<min){min=v;remove=i;}}outline.splice(remove,1);}
        const quadArea=area(outline);
        if(quadArea<n*minArea||quadArea/hullArea<.87||tail/quadArea<.65)continue;
        // Require a brightness difference outside the sheet to avoid text islands.
        let outside=0,outCount=0;
        for(let i=0;i<n;i+=7){const x=i%w,y=Math.floor(i/w),p={x,y};if(outline.some((a,k)=>cross(a,outline[(k+1)%4],p)<0)){outside+=gray[i];outCount++;}}
        if(!outCount||brightness/tail-outside/outCount<18)continue;
        const first=outline.reduce((idx,p,i)=>p.x+p.y<outline[idx].x+outline[idx].y?i:idx,0);
        outline=outline.slice(first).concat(outline.slice(0,first));
        const points=outline.map(p=>({x:p.x/(w-1)*100,y:p.y/(h-1)*100}));
        if(!validCorners(points))continue;
        const score=quadArea/n*(quadArea/hullArea);
        if(!best||score>best.score)best={points,score};
      }
    }
    return best?.points || null;
  }
  // Project the unit square into the selected quadrilateral. This corrects
  // perspective rather than merely clipping a rectangular bounding box.
  async function preparePage(e,maxSide=2400) {
    if(!validCorners(e.corners))throw new Error('Кути мають утворювати чотирикутник без перетину.');
    const p=e.corners.map(q=>({x:q.x/100*(e.canvas.width-1),y:q.y/100*(e.canvas.height-1)}));
    const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
    let width=Math.max(distance(p[0],p[1]),distance(p[3],p[2])),height=Math.max(distance(p[0],p[3]),distance(p[1],p[2]));
    const scale=Math.min(1,maxSide/Math.max(width,height));width=Math.max(2,Math.round(width*scale));height=Math.max(2,Math.round(height*scale));
    const dx1=p[1].x-p[2].x,dx2=p[3].x-p[2].x,dx3=p[0].x-p[1].x+p[2].x-p[3].x;
    const dy1=p[1].y-p[2].y,dy2=p[3].y-p[2].y,dy3=p[0].y-p[1].y+p[2].y-p[3].y;
    const det=dx1*dy2-dx2*dy1;
    if(Math.abs(det)<.001)throw new Error('Вибрана область надто вузька. Поправте кути.');
    const g=(dx3*dy2-dx2*dy3)/det,h=(dx1*dy3-dx3*dy1)/det;
    const a=p[1].x-p[0].x+g*p[1].x,b=p[3].x-p[0].x+h*p[3].x;
    const d=p[1].y-p[0].y+g*p[1].y,f=p[3].y-p[0].y+h*p[3].y;
    const input=e.canvas.getContext('2d').getImageData(0,0,e.canvas.width,e.canvas.height).data;
    const result=newCanvas(width,height),data=result.ctx.createImageData(width,height),out=data.data,sw=e.canvas.width,sh=e.canvas.height;
    for(let y=0;y<height;y++) {
      const v=y/(height-1);
      for(let x=0;x<width;x++) {
        const u=x/(width-1),z=g*u+h*v+1;
        const sx=Math.max(0,Math.min(sw-1,(a*u+b*v+p[0].x)/z)),sy=Math.max(0,Math.min(sh-1,(d*u+f*v+p[0].y)/z));
        const ix=Math.floor(sx),iy=Math.floor(sy),fx=sx-ix,fy=sy-iy;
        const i=(iy*sw+ix)*4,j=(iy*sw+Math.min(sw-1,ix+1))*4,k=(Math.min(sh-1,iy+1)*sw+ix)*4,l=(Math.min(sh-1,iy+1)*sw+Math.min(sw-1,ix+1))*4,t=(y*width+x)*4;
        for(let c=0;c<3;c++)out[t+c]=(input[i+c]*(1-fx)+input[j+c]*fx)*(1-fy)+(input[k+c]*(1-fx)+input[l+c]*fx)*fy;
        out[t+3]=255;
      }
      if(y%80===0)await yieldUI();
    }
    if(e.filter!=='original') {
      const hist=new Uint32Array(256),gray=new Uint8Array(width*height);
      for(let i=0;i<gray.length;i++){gray[i]=Math.round(.299*out[i*4]+.587*out[i*4+1]+.114*out[i*4+2]);hist[gray[i]]++;}
      const percentile=fraction=>{let count=0;for(let i=0;i<256;i++){count+=hist[i];if(count>=gray.length*fraction)return i;}return 255;};
      let low=percentile(.01),high=percentile(.99);
      if(high-low<35){low=0;high=255;} // A blank or faint sheet must stay light.
      const range=high-low;
      // Local threshold retains text in shaded areas; colour mode keeps stamps.
      let integral;
      if(e.filter==='bw') {
        integral=new Float64Array((width+1)*(height+1));
        for(let y=0;y<height;y++){let row=0;for(let x=0;x<width;x++){row+=gray[y*width+x];integral[(y+1)*(width+1)+x+1]=integral[y*(width+1)+x+1]+row;}if(y%120===0)await yieldUI();}
      }
      const radius=Math.max(8,Math.round(Math.min(width,height)/45));
      for(let y=0;y<height;y++) {
        for(let x=0;x<width;x++) {
          const id=y*width+x,t=id*4;
          if(integral){const x0=Math.max(0,x-radius),x1=Math.min(width,x+radius+1),y0=Math.max(0,y-radius),y1=Math.min(height,y+radius+1),stride=width+1;
            const mean=(integral[y1*stride+x1]-integral[y0*stride+x1]-integral[y1*stride+x0]+integral[y0*stride+x0])/((x1-x0)*(y1-y0));
            const value=gray[id]<mean-12?0:255;out[t]=out[t+1]=out[t+2]=value;
          }else for(let c=0;c<3;c++)out[t+c]=Math.pow(Math.max(0,Math.min(1,(out[t+c]-low)/range)),.9)*255;
        }
        if(y%120===0)await yieldUI();
      }
    }
    result.ctx.putImageData(data,0,0);return result.canvas;
  }
  const LIVE_INTERVAL = 450;
  const LIVE_STABLE_MS = 1400;
  const PDF_MAX_SIDE = 2000;
  const PDF_JPEG_QUALITY = 0.76;

  function liveMessage(s,text) {
    const node=s.dialog.querySelector('[data-live-status]');
    if(node.textContent!==text)node.textContent=text;
  }
  function resetLive(s) {
    clearTimeout(s.liveTimer);s.liveTimer=null;s.liveCorners=null;s.liveAnchor=null;s.liveSince=0;
    s.liveWidth=0;s.liveHeight=0;s.liveFrameTime=-1;
    if(s.liveSample){s.liveSample.canvas.width=s.liveSample.canvas.height=0;s.liveSample=null;}
    const overlay=s.dialog.querySelector('[data-live-outline]');overlay.setAttribute('hidden','');
    s.dialog.querySelector('[data-live-progress]').value=0;
    s.dialog.querySelector('.scan-camera-frame').hidden=false;
  }
  // Use the same four corners as the full-resolution crop. Sampling only the
  // document interior keeps the table/background out of the sharpness estimate.
  function clearEnough(canvas,points) {
    const w=canvas.width,h=canvas.height,rgba=canvas.getContext('2d').getImageData(0,0,w,h).data;
    const gray=new Uint8Array(w*h);
    for(let i=0;i<gray.length;i++)gray[i]=Math.round(.299*rgba[i*4]+.587*rgba[i*4+1]+.114*rgba[i*4+2]);
    const centre=points.reduce((a,p)=>({x:a.x+p.x/4,y:a.y+p.y/4}),{x:0,y:0});
    const inner=points.map(p=>({x:(centre.x+(p.x-centre.x)*.85)*(w-1)/100,y:(centre.y+(p.y-centre.y)*.85)*(h-1)/100}));
    let count=0,sum=0,squares=0,light=0;
    for(let y=2;y<h-2;y+=2)for(let x=2;x<w-2;x+=2){
      if(inner.some((p,i)=>cross(p,inner[(i+1)%4],{x,y})<0))continue;
      const id=y*w+x,value=gray[id-1]+gray[id+1]+gray[id-w]+gray[id+w]-4*gray[id];
      count++;sum+=value;squares+=value*value;light+=gray[id];
    }
    return count>100&&light/count>70&&squares/count-Math.pow(sum/count,2)>=35;
  }
  async function automaticCapture(s) {
    if(session!==s||s.busy||!s.stream||s.editor)return;
    s.busy=true;update(s);liveMessage(s,'Знімаю…');
    try{await capture(s);}
    catch(error){stopCamera(s);status(s,error.message||'Не вдалося зняти сторінку. Відкрийте камеру знову.',true);}
    finally{s.busy=false;if(session===s)update(s);}
  }
  function startLiveDetection(s) {
    const token=s.cameraToken;
    const tick=()=>{
      s.liveTimer=null;
      if(session!==s||token!==s.cameraToken||!s.stream||s.busy||document.hidden)return;
      const video=s.dialog.querySelector('[data-scan-video]'),started=performance.now();
      let takePhoto=false;
      try {
        if(video.readyState>=2&&!video.paused&&video.videoWidth&&video.videoHeight&&video.currentTime!==s.liveFrameTime) {
          s.liveFrameTime=video.currentTime;
          const ratio=video.videoWidth/video.videoHeight;
          // The wrapper and SVG have the video's exact ratio: no letterboxing
          // offset between the visible document and its detected outline.
          s.dialog.querySelector('.scan-live').style.width='min(100%, calc(58dvh * '+ratio+'))';
          if(s.liveWidth!==video.videoWidth||s.liveHeight!==video.videoHeight){
            s.liveCorners=null;s.liveAnchor=null;s.liveSince=0;s.liveWidth=video.videoWidth;s.liveHeight=video.videoHeight;
          }
          const scale=Math.min(1,360/Math.max(video.videoWidth,video.videoHeight));
          if(!s.liveSample)s.liveSample=newCanvas(Math.round(video.videoWidth*scale),Math.round(video.videoHeight*scale));
          const sample=s.liveSample;
          sample.canvas.width=Math.round(video.videoWidth*scale);sample.canvas.height=Math.round(video.videoHeight*scale);
          sample.ctx.drawImage(video,0,0,sample.canvas.width,sample.canvas.height);
          const points=detectCorners(sample.canvas,{minArea:.035,maxSide:360});
          const outline=s.dialog.querySelector('[data-live-outline]'),guide=s.dialog.querySelector('.scan-camera-frame'),progress=s.dialog.querySelector('[data-live-progress]');
          let guideHeight=.82,guideWidth=guideHeight/ratio*210/297;
          if(guideWidth>.88){guideWidth=.88;guideHeight=guideWidth*ratio*297/210;}
          guide.style.width=guideWidth*100+'%';guide.style.height=guideHeight*100+'%';
          if(points) {
            outline.removeAttribute('hidden');guide.hidden=true;
            s.dialog.querySelector('[data-live-polygon]').setAttribute('points',points.map(p=>p.x+','+p.y).join(' '));
            s.dialog.querySelector('[data-live-mask]').setAttribute('d','M0 0H100V100H0Z M'+points.map(p=>p.x+' '+p.y).join('L')+'Z');
            const now=performance.now(),old=s.liveCorners;
            const anchor=s.liveAnchor;
            const steady=old&&anchor&&points.every((p,i)=>Math.hypot(p.x-old[i].x,p.y-old[i].y)<1.3&&Math.hypot(p.x-anchor[i].x,p.y-anchor[i].y)<1.3);
            const inside=points.every(p=>p.x>1&&p.x<99&&p.y>1&&p.y<99);
            const shortSide=Math.min(...points.map((p,i)=>{const q=points[(i+1)%4];return Math.hypot((p.x-q.x)*sample.canvas.width/100,(p.y-q.y)*sample.canvas.height/100);}));
            const sharp=shortSide>=60&&clearEnough(sample.canvas,points);
            const auto=s.dialog.querySelector('[data-auto-capture]').checked;
            if(!steady||!inside||!sharp||!auto){s.liveSince=now;s.liveAnchor=copyCorners(points);}
            if(!s.liveSince)s.liveSince=now;
            const held=now-s.liveSince;progress.value=auto&&sharp&&inside?Math.min(1,held/LIVE_STABLE_MS):0;
            outline.dataset.ready=String(auto&&steady&&inside&&sharp);
            liveMessage(s,!inside?'Умістіть усі кути документа в кадрі.':shortSide<60?'Наблизьте телефон до документа.':!sharp?'Наведіть різкість, додайте світла або зніміть вручну.':!auto?'Краї знайдено. Натисніть «Зняти».':'Краї знайдено. Тримайте телефон нерухомо — автозйомка…');
            s.liveCorners=copyCorners(points);
            takePhoto=!!(auto&&steady&&inside&&sharp&&held>=LIVE_STABLE_MS);
          }else {
            outline.setAttribute('hidden','');guide.hidden=false;progress.value=0;s.liveCorners=null;s.liveAnchor=null;s.liveSince=0;
            liveMessage(s,'Шукаю краї. Покладіть документ на темніший фон, умістіть усі кути в кадрі.');
          }
        }else {
          s.liveSince=0;s.liveCorners=null;s.liveAnchor=null;
          s.dialog.querySelector('[data-live-progress]').value=0;
          s.dialog.querySelector('[data-live-outline]').setAttribute('hidden','');
          s.dialog.querySelector('.scan-camera-frame').hidden=false;
          liveMessage(s,'Очікую зображення камери…');
        }
      }catch(error){resetLive(s);liveMessage(s,'Пошук країв недоступний. Можна натиснути «Зняти» та поправити кути вручну.');return;}
      if(takePhoto){void automaticCapture(s);return;}
      if(session===s&&token===s.cameraToken&&s.stream)s.liveTimer=setTimeout(tick,Math.max(LIVE_INTERVAL,(performance.now()-started)*3));
    };
    clearTimeout(s.liveTimer);s.liveTimer=setTimeout(tick,100);
  }

  function stopCamera(s) {
    resetLive(s);
    s.cameraToken=(s.cameraToken||0)+1;s.cameraPending=false;
    s.stream?.getTracks().forEach(track=>track.stop());s.stream=null;
    const video=s.dialog.querySelector('[data-scan-video]');video.pause();video.srcObject=null;
    s.dialog.querySelector('[data-scan-live]').hidden=true;
  }
  async function startCamera(s) {
    if(!navigator.mediaDevices?.getUserMedia||!window.isSecureContext){status(s,'Камера браузера недоступна. Скористайтеся «Камера телефона» або галереєю.',true);return;}
    stopCamera(s);const token=s.cameraToken;s.cameraPending=true;
    s.dialog.querySelector('[data-scan-live]').hidden=false;update(s);
    liveMessage(s,'Очікую дозвіл камери…');
    s.dialog.querySelector('[data-scan-live]').scrollIntoView({block:'start',behavior:'smooth'});
    status(s,'Дозвольте доступ до камери. Мікрофон не потрібний.');
    try {
      const stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:2400},height:{ideal:3200}}});
      if(session!==s||token!==s.cameraToken||document.hidden){stream.getTracks().forEach(track=>track.stop());return;}
      s.stream=stream;s.cameraPending=false;
      stream.getVideoTracks().forEach(track=>{track.onended=()=>{if(session===s&&s.stream===stream){stopCamera(s);update(s);status(s,'Камеру вимкнено. Відкрийте її знову або виберіть фото.');}};});
      const video=s.dialog.querySelector('[data-scan-video]');video.srcObject=stream;
      video.onloadeddata=()=>{if(session===s&&s.stream){update(s);liveMessage(s,'Шукаю краї документа…');}};
      await video.play();update(s);startLiveDetection(s);
    }catch(error){if(session!==s||token!==s.cameraToken)return;stopCamera(s);update(s);status(s,'Не вдалося відкрити камеру. Перевірте дозвіл або скористайтеся «Камера телефона» / галереєю.',true);}
  }
  async function capture(s) {
    const video=s.dialog.querySelector('[data-scan-video]');
    if(!video.videoWidth||video.readyState<2)throw new Error('Камера ще готується. Зачекайте та спробуйте знову.');
    const scale=Math.min(1,2400/Math.max(video.videoWidth,video.videoHeight));
    const shot=newCanvas(Math.round(video.videoWidth*scale),Math.round(video.videoHeight*scale));
    shot.ctx.drawImage(video,0,0,shot.canvas.width,shot.canvas.height);
    // Re-detect on the captured frame so the saved crop matches that exact shot.
    const shotCorners=detectCorners(shot.canvas);
    stopCamera(s);
    try{const source=await jpeg(shot.canvas);if(s.pages.reduce((sum,page)=>sum+page.source.size,source.size)>MAX_SOURCES)throw new Error('Забагато фото. Збережіть документ частинами.');await editSource(s,source);if(shotCorners){s.editor.corners=copyCorners(shotCorners);drawCrop(s);}}
    finally{shot.canvas.width=shot.canvas.height=0;}
  }
  function invalidatePreview(s) {s.dialog.querySelector('[data-scan-result]').hidden=true;}
  async function showPrepared(s) {
    status(s,'Вирівнювання та покращення сторінки…');
    const result=await preparePage(s.editor,1000),target=s.dialog.querySelector('[data-scan-result-canvas]');
    target.width=result.width;target.height=result.height;target.getContext('2d').drawImage(result,0,0);
    result.width=result.height=0;s.dialog.querySelector('[data-scan-result]').hidden=false;
    status(s,'Це вигляд сторінки у PDF. Перевірте дрібний текст, печатки та краї.');
    s.dialog.querySelector('[data-scan-result]').scrollIntoView({block:'nearest',behavior:'smooth'});
  }
  function autoCrop(s) {
    const detected=detectCorners(s.editor.canvas);s.editor.corners=detected||fullCorners();drawCrop(s);invalidatePreview(s);
    status(s,detected?'Краї знайдено. Перевірте зелені кути, за потреби перетягніть їх.':'Краї не вдалося впевнено визначити. Перетягніть чотири зелені кути до кутів документа.');
  }

  function status(s, text, error = false) {
    const node = s.dialog.querySelector('[data-scan-status]');
    node.textContent = text; node.dataset.error = String(error);
  }
  function dirty(s) { return !!(s.pages.length || s.editor || s.queue.length); }
  function release(s) {
    stopCamera(s);
    s.urls.forEach(url => URL.revokeObjectURL(url)); s.urls = [];
    if (s.editor?.canvas) s.editor.canvas.width = s.editor.canvas.height = 0;
    s.dialog.close(); s.dialog.remove(); s.pages = []; s.queue = []; s.editor = null;
    if (session === s) session = null;
  }
  function requestClose(s) {
    if (s.busy) return;
    stopCamera(s); update(s);
    if (!dirty(s)) return release(s);
    const discard = s.dialog.querySelector('[data-scan-discard]');
    discard.hidden = false; discard.querySelector('button').focus();
  }
  function update(s) {
    const live = !!(s.stream || s.cameraPending);
    s.dialog.querySelectorAll('[data-scan-action]').forEach(button => { button.disabled = s.busy; });
    s.dialog.querySelector('[data-scan-action="finish"]').disabled = s.busy || live || !!s.editor || !!s.queue.length || !s.pages.length;
    s.dialog.querySelector('[data-scan-action="camera"]').disabled = s.busy || live || !!s.editor || s.pages.length >= MAX_PAGES;
    s.dialog.querySelector('[data-scan-action="gallery"]').disabled = s.busy || live || !!s.editor || s.pages.length >= MAX_PAGES;
    s.dialog.querySelectorAll('[data-scan-action="up"]').forEach(button => {button.disabled = s.busy || Number(button.dataset.index) === 0;});
    s.dialog.querySelectorAll('[data-scan-action="down"]').forEach(button => {button.disabled = s.busy || Number(button.dataset.index) === s.pages.length - 1;});
    s.dialog.querySelector('[data-scan-action="native-camera"]').disabled = s.busy || !!s.editor || s.pages.length >= MAX_PAGES;
    s.dialog.querySelector('[data-scan-action="capture"]').disabled = s.busy || !s.stream || s.dialog.querySelector('[data-scan-video]').readyState < 2;
    s.dialog.querySelectorAll('[data-scan-filter],[data-point],[data-corner]').forEach(input => {input.disabled=s.busy;});
    s.dialog.querySelector('[data-scan-editor]').hidden = !s.editor;
    s.dialog.querySelector('[data-scan-action="save-page"]').textContent = s.editor?.index >= 0 ? 'Зберегти сторінку' : 'Додати сторінку';
    s.dialog.querySelector('[data-scan-count]').textContent = s.pages.length ? 'Сторінок у PDF: ' + s.pages.length : 'Ще немає сторінок';
    const bytes=s.pages.reduce((sum,page)=>sum+page.image.size+1000,1000);
    s.dialog.querySelector('[data-scan-size]').textContent=s.pages.length?'Орієнтовний розмір PDF: '+(bytes<1024*1024?Math.ceil(bytes/1024)+' КБ':(bytes/1024/1024).toFixed(1)+' МБ'):'';
  }
  function renderPages(s) {
    s.urls.forEach(url => URL.revokeObjectURL(url)); s.urls = [];
    const root = s.dialog.querySelector('[data-scan-pages]');
    root.innerHTML = s.pages.map((page, index) => {
      const url = URL.createObjectURL(page.image); s.urls.push(url);
      return '<section class="scan-page"><strong>Сторінка ' + (index + 1) + '</strong><img loading="lazy" decoding="async" src="' + url + '" alt="Перегляд сторінки ' + (index + 1) + '"><div class="scan-tools"><button type="button" data-scan-action="edit" data-index="' + index + '">Редагувати</button><button type="button" data-scan-action="remove" data-index="' + index + '">Видалити</button></div><div class="scan-tools"><button type="button" data-scan-action="up" data-index="' + index + '" aria-label="Перемістити сторінку ' + (index + 1) + ' вище" ' + (index === 0 ? 'disabled' : '') + '>↑ Вище</button><button type="button" data-scan-action="down" data-index="' + index + '" aria-label="Перемістити сторінку ' + (index + 1) + ' нижче" ' + (index === s.pages.length - 1 ? 'disabled' : '') + '>↓ Нижче</button></div></section>';
    }).join('');
    update(s);
    root.querySelector('[data-scan-action="up"][data-index="0"]')?.setAttribute('disabled', '');
    root.querySelector('[data-scan-action="down"][data-index="' + (s.pages.length - 1) + '"]')?.setAttribute('disabled', '');
  }
  function drawCrop(s) {
    const points=s.editor.corners;
    s.dialog.querySelector('[data-scan-polygon]').setAttribute('points',points.map(p=>p.x+','+p.y).join(' '));
    s.dialog.querySelector('[data-scan-mask]').setAttribute('d','M0 0H100V100H0Z M'+points.map(p=>p.x+' '+p.y).join('L')+'Z');
    CORNERS.forEach((name,i)=>{const handle=s.dialog.querySelector('[data-corner="'+name+'"]');handle.style.left=points[i].x+'%';handle.style.top=points[i].y+'%';});
    s.dialog.querySelectorAll('[data-point]').forEach(input=>{input.value=Number(points[Number(input.dataset.point)][input.dataset.axis].toFixed(1));});
  }
  function moveCorner(s,index,x,y) {
    const points=copyCorners(s.editor.corners);
    points[index]={x:Math.max(0,Math.min(100,x)),y:Math.max(0,Math.min(100,y))};
    if(validCorners(points)){s.editor.corners=points;invalidatePreview(s);}
    drawCrop(s);
  }
  function drawEditor(s) {
    const e = s.editor, swapped = e.rotation % 180 !== 0;
    if (e.canvas) e.canvas.width = e.canvas.height = 0;
    const {canvas, ctx} = newCanvas(swapped ? e.photo.naturalHeight : e.photo.naturalWidth, swapped ? e.photo.naturalWidth : e.photo.naturalHeight);
    ctx.translate(canvas.width / 2, canvas.height / 2); ctx.rotate(e.rotation * Math.PI / 180);
    ctx.drawImage(e.photo, -e.photo.naturalWidth / 2, -e.photo.naturalHeight / 2);
    e.canvas = canvas;
    const preview = s.dialog.querySelector('[data-scan-canvas]'), scale = Math.min(1, 1000 / Math.max(canvas.width, canvas.height));
    preview.width = Math.round(canvas.width * scale); preview.height = Math.round(canvas.height * scale);
    preview.getContext('2d').drawImage(canvas, 0, 0, preview.width, preview.height);
    drawCrop(s); update(s);
  }
  async function editSource(s, source, index = -1) {
    const old = index >= 0 ? s.pages[index] : null;
    s.editor = {source, index, photo: await imageFromBlob(source), rotation: old?.rotation || 0, corners: copyCorners(old?.corners || fullCorners()), filter:old?.filter || 'colour'};
    drawEditor(s); invalidatePreview(s);
    s.dialog.querySelector('[data-scan-filter]').value=s.editor.filter;
    if (!old) autoCrop(s);
    else status(s,'Поправте кути або змініть режим зображення.');
    s.dialog.querySelector('[data-scan-editor]').scrollIntoView({block:'start', behavior:'smooth'});
    if(s.queue.length) s.dialog.querySelector('[data-scan-status]').textContent+=' Далі ще фото: '+s.queue.length+'.';
  }
  async function nextPhoto(s) {
    if (!s.queue.length) return;
    const source = s.queue.shift();
    await editSource(s, source);
  }
  async function importPhotos(s, files) {
    if (!files.length || s.busy || s.editor) return;
    stopCamera(s); s.busy = true; update(s);
    try {
      if (s.pages.length + files.length > MAX_PAGES) throw new Error('В одному документі може бути до ' + MAX_PAGES + ' сторінок.');
      let sourceSize = s.pages.reduce((sum, page) => sum + page.source.size, 0);
      const prepared = [];
      for (let i = 0; i < files.length; i++) {
        status(s, 'Підготовка фото ' + (i + 1) + ' із ' + files.length + '…');
        const source = await normalizePhoto(files[i]); sourceSize += source.size;
        if (sourceSize > MAX_SOURCES) throw new Error('Забагато фото для пам’яті телефона. Збережіть документ частинами.');
        prepared.push(source);
      }
      s.queue = prepared; await nextPhoto(s);
    } catch (error) { status(s, error.message, true); }
    finally { s.busy = false; update(s); }
  }
  async function savePage(s) {
    const e = s.editor; if (!e) return;
    status(s,'Готую вирівняну сторінку…');
    const canvas=await preparePage(e,PDF_MAX_SIDE),width=canvas.width,height=canvas.height;
    let image;try{image=await jpeg(canvas,PDF_JPEG_QUALITY);}finally{canvas.width=canvas.height=0;}
    const page = {source:e.source, rotation:e.rotation, corners:copyCorners(e.corners), filter:e.filter, image, width, height};
    if (e.index >= 0) s.pages[e.index] = page; else s.pages.push(page);
    e.canvas.width = e.canvas.height = 0; s.editor = null;
    renderPages(s); status(s, 'Сторінку додано. Можна зняти наступну або сформувати PDF.');
    await nextPhoto(s);
  }
  async function finish(s) {
    status(s, 'Формування PDF…');
    const pdf = await buildPDF(s.pages);
    if (pdf.size > s.maxSize) throw new Error('PDF більше за ' + (s.recommendation ? '11' : '20') + ' МБ. Видаліть зайві сторінки або збережіть документ частинами.');
    const name = s.dialog.querySelector('[name="scanName"]').value.replace(/\.pdf$/i, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().slice(0, 100) || 'Документ';
    const file = new File([pdf], name + '.pdf', {type:'application/pdf', lastModified:Date.now()});
    await s.onComplete(file);
    release(s);
  }
  function open({title = 'Документ', onComplete, recommendation = false} = {}) {
    if (session || typeof onComplete !== 'function') return;
    const dialog = document.createElement('dialog'); dialog.className = 'scan-dialog';
    dialog.setAttribute('aria-labelledby', 'scanTitle');
    const s = {dialog, onComplete, recommendation, maxSize:recommendation ? 11000000 : MAX_FILE, pages:[], queue:[], urls:[], editor:null, busy:false, stream:null, cameraPending:false, cameraToken:0}; session = s;
    dialog.innerHTML = `<div class="scan-heading"><div><h2 id="scanTitle">Сканування документа</h2><p>${escape(title)} · зніміть сторінки, перевірте краї та сформуйте один PDF.</p></div><button type="button" data-scan-action="close" aria-label="Закрити сканер">✕</button></div>
      <div class="scan-tools"><button type="button" data-scan-action="camera">📷 Сканувати камерою</button><button type="button" data-scan-action="gallery">▧ Фото з галереї</button></div>
      <button type="button" data-scan-action="native-camera">Камера телефона</button>
      <input type="file" data-scan-camera accept="image/*" capture="environment" hidden><input type="file" data-scan-gallery accept="image/*" multiple hidden>
      <section data-scan-live hidden><div class="scan-live"><video data-scan-video autoplay muted playsinline></video><div class="scan-camera-frame" aria-hidden="true"><span>A4</span></div><svg data-live-outline class="scan-live-outline" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" hidden><path data-live-mask fill-rule="evenodd"></path><polygon data-live-polygon vector-effect="non-scaling-stroke"></polygon></svg></div><label class="scan-auto"><input type="checkbox" data-auto-capture checked> Автозйомка після визначення країв</label><p data-live-status class="scan-live-status" role="status" aria-live="polite">Шукаю краї документа…</p><progress data-live-progress max="1" value="0" aria-label="Готовність автозйомки"></progress><p class="muted" style="font-size:12px">A4 — орієнтир для аркуша. Знайдений контур підлаштовується під фактичний розмір документа. Після автознімка перевірте сторінку.</p><div class="scan-tools"><button type="button" data-scan-action="stop-camera">Закрити камеру</button><button type="button" class="primary" data-scan-action="capture" disabled>Зняти</button></div></section>
      <p class="muted" style="font-size:12px">Покладіть документ на темнішу рівну поверхню. Уникайте тіней та відблисків. Фото обробляється на вашому пристрої.</p>
      <div data-scan-discard class="scan-discard" hidden><strong>Вийти та втратити незбережені сторінки?</strong><div class="scan-tools"><button type="button" data-scan-action="keep">Продовжити сканування</button><button type="button" data-scan-action="discard">Вийти без збереження</button></div></div>
      <section data-scan-editor hidden><h3>1. Перевірте чотири кути</h3><div class="scan-tools"><button type="button" data-scan-action="rotate">↻ Повернути 90°</button><button type="button" data-scan-action="auto">Знайти краї</button><button type="button" data-scan-action="reset">Усе фото</button></div>
      <div class="scan-preview"><canvas data-scan-canvas aria-label="Фото документа"></canvas><svg class="scan-crop-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path data-scan-mask fill-rule="evenodd"></path><polygon data-scan-polygon vector-effect="non-scaling-stroke"></polygon></svg>
      ${CORNERS.map((corner,i)=>'<button type="button" class="scan-handle" data-corner="'+corner+'" aria-label="'+['Верхній лівий','Верхній правий','Нижній правий','Нижній лівий'][i]+' кут обрізання"></button>').join('')}</div>
      <p class="muted" style="font-size:12px">Перетягніть зелені кути до країв документа. На комп’ютері також працюють стрілки клавіатури.</p>
      <details><summary>Точні координати кутів</summary><div class="scan-crop-fields">${CORNERS.map((corner,i)=>'<fieldset><legend>'+['Верхній лівий','Верхній правий','Нижній правий','Нижній лівий'][i]+'</legend>'+['x','y'].map(axis=>'<label>'+axis.toUpperCase()+', % <input data-point="'+i+'" data-axis="'+axis+'" type="number" min="0" max="100" step="0.1" inputmode="decimal"></label>').join('')+'</fieldset>').join('')}</div></details>
      <h3>2. Перевірте читабельність</h3><label class="scan-filter">Зображення<select data-scan-filter><option value="colour">Покращений колір</option><option value="original">Оригінал</option><option value="bw">Чорно-білий текст</option></select></label>
      <div class="scan-tools"><button type="button" data-scan-action="preview">Переглянути вирівняну сторінку</button></div><section data-scan-result hidden><strong>Так сторінка виглядатиме у PDF</strong><canvas data-scan-result-canvas aria-label="Вирівняна сторінка"></canvas></section>
      <div class="scan-tools"><button type="button" data-scan-action="skip">Не додавати це фото</button><button type="button" class="primary" data-scan-action="save-page">Додати сторінку</button></div></section>
      <h3 data-scan-count>Ще немає сторінок</h3><div class="scan-pages" data-scan-pages></div><div class="scan-status" role="status" aria-live="polite" data-scan-status></div>
      <div class="scan-footer"><div data-scan-size class="muted"></div><small class="muted">PDF зі стисненням · перевірте дрібний текст перед завантаженням.</small><label>Назва PDF<input name="scanName" value="${escape(title)}"></label><div class="scan-tools"><button type="button" class="primary" data-scan-action="finish" disabled>Сформувати PDF і продовжити</button></div><small class="muted" data-scan-upload-hint>PDF буде передано у вікно завантаження. Там перевірте тип документа та натисніть «Завантажити».</small></div>`;
    dialog.addEventListener('cancel', event => {event.preventDefault(); requestClose(s);});
    dialog.querySelector('[data-scan-camera]').addEventListener('change', event => importPhotos(s, [...event.target.files]));
    dialog.querySelector('[data-scan-gallery]').addEventListener('change', event => importPhotos(s, [...event.target.files]));
    dialog.querySelectorAll('[data-point]').forEach(input=>input.addEventListener('change',()=>{if(!s.editor||s.busy)return;const i=Number(input.dataset.point),p=s.editor.corners[i];moveCorner(s,i,input.dataset.axis==='x'?Number(input.value):p.x,input.dataset.axis==='y'?Number(input.value):p.y);}));
    dialog.querySelector('[data-auto-capture]').addEventListener('change',()=>{s.liveSince=0;s.liveCorners=null;s.liveAnchor=null;dialog.querySelector('[data-live-progress]').value=0;});
    dialog.querySelector('[data-scan-filter]').addEventListener('change',event=>{if(s.editor&&!s.busy){s.editor.filter=event.target.value;invalidatePreview(s);}});
    dialog.querySelectorAll('[data-corner]').forEach(handle=>{
      const index=CORNERS.indexOf(handle.dataset.corner);
      handle.addEventListener('keydown',event=>{if(!s.editor||s.busy||!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();const p=s.editor.corners[index],step=event.shiftKey?2:.5;moveCorner(s,index,p.x+(event.key==='ArrowRight'?step:event.key==='ArrowLeft'?-step:0),p.y+(event.key==='ArrowDown'?step:event.key==='ArrowUp'?-step:0));});
      handle.addEventListener('pointerdown',event=>{
        if(!s.editor||s.busy)return;event.preventDefault();handle.setPointerCapture(event.pointerId);
        const move=event=>{if(!s.editor||s.busy)return;const bounds=dialog.querySelector('.scan-preview').getBoundingClientRect();moveCorner(s,index,(event.clientX-bounds.left)/bounds.width*100,(event.clientY-bounds.top)/bounds.height*100);};
        const stop=()=>{handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',stop);handle.removeEventListener('pointercancel',stop);handle.removeEventListener('lostpointercapture',stop);};
        handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',stop);handle.addEventListener('pointercancel',stop);handle.addEventListener('lostpointercapture',stop);
      });
    });
    dialog.addEventListener('click', async event => {
      const button = event.target.closest('[data-scan-action]'); if (!button || button.disabled || s.busy) return;
      const action = button.dataset.scanAction, index = Number(button.dataset.index);
      if (action === 'close') return requestClose(s);
      if (action === 'discard') return release(s);
      if (action === 'keep') {dialog.querySelector('[data-scan-discard]').hidden = true; return;}
      if(action==='camera'){await startCamera(s);return;}
      if(action==='stop-camera'){stopCamera(s);update(s);return;}
      if(action==='native-camera'||action==='gallery'){stopCamera(s);update(s);const input=dialog.querySelector('[data-scan-'+(action==='native-camera'?'camera':'gallery')+']');input.value='';input.click();return;}
      if((s.stream||s.cameraPending)&&action!=='capture'){status(s,'Спочатку зніміть сторінку або закрийте камеру.',true);return;}
      if (s.editor && ['edit','remove','up','down'].includes(action)) {status(s, 'Спочатку збережіть або відхиліть сторінку, яку редагуєте.', true); return;}
      s.busy = true; update(s);
      try {
        if(action==='capture')await capture(s);
        else if (action === 'rotate' && s.editor) {s.editor.rotation = (s.editor.rotation + 90) % 360; s.editor.corners = fullCorners(); drawEditor(s);autoCrop(s);}
        else if(action==='auto'&&s.editor)autoCrop(s);
        else if(action==='preview'&&s.editor)await showPrepared(s);
        else if (action === 'reset' && s.editor) {s.editor.corners = fullCorners(); drawCrop(s);invalidatePreview(s);}
        else if (action === 'save-page') await savePage(s);
        else if (action === 'skip') {if (s.editor?.canvas) s.editor.canvas.width = s.editor.canvas.height = 0; s.editor = null; await nextPhoto(s);}
        else if (action === 'edit') await editSource(s, s.pages[index].source, index);
        else if (action === 'remove') {s.pages.splice(index, 1); renderPages(s);}
        else if (action === 'up' || action === 'down') {const to = index + (action === 'up' ? -1 : 1); if (to >= 0 && to < s.pages.length) {[s.pages[index],s.pages[to]] = [s.pages[to],s.pages[index]]; renderPages(s);}}
        else if (action === 'finish') await finish(s);
      } catch (error) {status(s, error.message || 'Не вдалося підготувати документ.', true);}
      finally {s.busy = false; if (session === s) update(s);}
    });
    document.body.append(dialog); dialog.showModal(); update(s);
    if (recommendation) {
      dialog.querySelector('[data-scan-action="finish"]').textContent = 'Сформувати PDF і розпізнати лист';
      dialog.querySelector('[data-scan-upload-hint]').textContent = 'PDF передається у наявне розпізнавання рекомендаційного листа. Перевірте результат перед створенням справи.';
    }
  }
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&session){stopCamera(session);update(session);}});
  window.addEventListener('pagehide',()=>{if(session)stopCamera(session);});
  window.addEventListener('beforeunload', event => {if (session && dirty(session)) {event.preventDefault(); event.returnValue = '';}});
  window.DocumentCamera = {open};
})();
