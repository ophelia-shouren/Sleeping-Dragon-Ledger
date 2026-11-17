const ledgerOnline = (() => {
  const base='https://sleeping-dragon-ledger.yearnwingwings.workers.dev/ledger-api/';
  const key='sleeping-dragon-online-identity';
  const profileReadyKey='sleeping-dragon-online-profile-confirmed';
  const displayKey='sleeping-dragon-online-display';
  const pictures=new Map();
  const views=new Map(), feedsInFlight=new Map(), detailsInFlight=new Map();
  const cardSyncs=new Map();
  let onlineIdentity, syncedProfile, imageObserver, knownRooms=null;
  let roomsAt=0, roomsRequest, noticeSession, noticeTimer, bannerTimer, queuedNotice;
  const noticeDisplayKey='sleeping-dragon-online-muted';
  function groupMuted(id,value){
    const storageKey=noticeDisplayKey+':'+me.id+':'+id;
    if(value!==undefined)localStorage.setItem(storageKey,value?'1':'0');
    return localStorage.getItem(storageKey)==='1';
  }
  function stripCharacterPrefix(body,name){
    if(!name)return body;
    const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    return body.replace(new RegExp('^[^\\S\\r\\n]*'+escaped+'[^\\S\\r\\n]*[:：][^\\S\\r\\n]*','gm'),'').trim();
  }
  const mentionsEveryone=/[@＠]全体成员(?=$|[\s，。！？、；：,.!?;:])/u;
  function canShowNotice(message){
    return !['deleted','message-deleted'].includes(message.kind)&&!groupMuted(message.room)&&!(scope()&&room?.id===message.room&&el('onlineMessages'));
  }
  function showNotice(message){
    if(!canShowNotice(message)||typeof deviceLocked!=='undefined'&&deviceLocked)return;
    if(document.hidden){queuedNotice=message;return;}
    let banner=el('onlineNotice');
    const sheet=Array.from(document.querySelectorAll('dialog[open]')).at(-1);
    if(!banner){
      banner=document.createElement('div');
      banner.id='onlineNotice';
      banner.setAttribute('role','status');
      banner.style.cssText='position:fixed;inset:max(8px,env(safe-area-inset-top)) 12px auto;margin:0 auto;box-sizing:border-box;width:auto;max-width:40rem;padding:.65em 1em;border:1px solid var(--line);border-inline-start:3px solid var(--gold);border-radius:.55em;background:var(--panel);color:var(--ink);font:inherit;box-shadow:0 4px 16px #0004;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;pointer-events:none;z-index:2147483647';
      if(banner.showPopover)banner.setAttribute('popover','manual');
      (banner.showPopover?document.body:sheet||document.body).append(banner);
    }
    if(!banner.showPopover&&banner.parentElement!==(sheet||document.body))(sheet||document.body).append(banner);
    banner.dataset.room=message.room;
    banner.textContent=message.group_name+' · '+(message.kind==='member-joined'?'':message.name+'：')+message.body.replace(/\s+/g,' ');
    if(banner.showPopover){
      if(banner.matches(':popover-open'))banner.hidePopover();
      banner.showPopover();
    }
    clearTimeout(bannerTimer);
    bannerTimer=setTimeout(()=>banner.remove(),3000);
  }
  async function pollNotices(){
    const session=noticeSession;
    if(!session||session.loading)return;
    clearTimeout(noticeTimer);
    session.loading=true;
    try{
      const signal=AbortSignal.timeout(12000);
      const feed=await request('notifications'+(session.cursor===null?'':'?after='+session.cursor),undefined,signal);
      if(noticeSession!==session)return;
      session.cursor=feed.cursor;
      session.failures=0;
      const latest=feed.rows.findLast(message=>message.kind==='mention-all'&&canShowNotice(message))||feed.rows.findLast(canShowNotice);
      if(latest)showNotice(latest);
    }catch{
      session.failures++;
    }finally{
      session.loading=false;
      if(noticeSession===session)noticeTimer=setTimeout(pollNotices,Math.min(30000,3500*2**Math.min(session.failures,4)));
    }
  }
  function startNotices(){
    if(noticeSession)return;
    noticeSession={cursor:null,loading:false,failures:0};
    pollNotices();
  }
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden)return;
    if(queuedNotice){showNotice(queuedNotice);queuedNotice=null;}
    pollNotices();
    resumeChat?.();
  });
  window.addEventListener('online',()=>{
    pollNotices();
    resumeChat?.();
  });
  function readRooms(force=false){
    if(!force&&knownRooms&&Date.now()-roomsAt<12000)return Promise.resolve(knownRooms);
    if(roomsRequest)return roomsRequest;
    const token=onlineIdentity;
    const work=request('rooms').then(list=>{
      if(onlineIdentity===token){knownRooms=list;roomsAt=Date.now();}
      return list;
    }).finally(()=>{if(roomsRequest===work)roomsRequest=null;});
    roomsRequest=work;
    return work;
  }
  function viewFor(id){
    let view=views.get(id);
    if(view)views.delete(id);
    else view={messages:[],typing:[],older:false,loaded:false,top:null};
    views.set(id,view);
    if(views.size>6)views.delete(views.keys().next().value);
    return view;
  }
  function roomFeed(id,cursor=0){
    const key=id+':'+cursor;
    if(!feedsInFlight.has(key)){
      const promise=request('messages?live=1&room='+id+(cursor?'&after='+cursor:'')).finally(()=>feedsInFlight.delete(key));
      feedsInFlight.set(key,promise);
    }
    return feedsInFlight.get(key);
  }
  function roomDetail(id){
    if(!detailsInFlight.has(id)){
      const promise=request('detail?room='+id).finally(()=>detailsInFlight.delete(id));
      detailsInFlight.set(id,promise);
    }
    return detailsInFlight.get(id);
  }
  function prefetchRoom(id){
    const view=viewFor(id);
    if(!view.loaded)roomFeed(id).then(feed=>{
      if(view.loaded || views.get(id)!==view)return;
      const rows=Array.isArray(feed)?feed:feed.rows;
      view.messages=rows.slice(-36);view.older=rows.length>36;
      view.typing=feed.typing||[];view.loaded=true;view.updated=Date.now();
    }).catch(()=>{});
    if(!view.detail)roomDetail(id).then(info=>{
      if(views.get(id)===view)view.detail=info;
    }).catch(()=>{});
  }
  function rememberChat(id){
    const box=el('onlineMessages'),view=views.get(id);
    if(view&&box&&room?.id===id){
      view.draft=el('onlineCompose')?.elements.body.value||'';
      view.top=box.scrollHeight-box.clientHeight-box.scrollTop<120?null:box.scrollTop;
    }
  }
  let pendingMessage=null, typingCharacters=[], resumeChat;
  const localTyping=new Map();
  const hands=[['rock','✊ 石头'],['paper','✋ 布'],['scissors','✌️ 剪刀']];
  const mappingKey='sleeping-dragon-online-cards';
  let room=null, me=null, messages=[], detail=null, pollTimer, generation=0, older=false;
  const el=id=>document.getElementById(id);
  const end='<p class="muted" id="onlineStatus" role="status"></p>';
  const inviteFromUrl=()=>new URL(location.href).searchParams.get('onlineInvite')||'';
  const scope=()=>el('dialog').open && el('ledgerOnline');
  const active=serial=>scope() && serial===generation;
  function identity(){
    let value=localStorage.getItem(key);
    if(!/^[a-f0-9]{64}$/.test(value||'')){
      value=Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('');
      localStorage.removeItem(profileReadyKey);
      localStorage.setItem(key,value);
    }
    return value;
  }
  async function request(path,data,signal){
    const headers={Authorization:'Bearer '+identity()};
    if(data)headers['Content-Type']='application/json';
    let response;
    try{response=await fetch(base+path,{method:data?'POST':'GET',headers,body:data?JSON.stringify(data):undefined,signal});}
    catch{throw Error(signal?.aborted?'同步 User 人设超时，请重试。':'在线聊天服务连接失败，请稍后再试。');}
    const result=await response.json().catch(()=>null);
    if(!response.ok||!result)throw Object.assign(Error(result?.error||'在线聊天服务暂时不可用。'),{status:response.status});
    return result;
  }
  function status(message){
    const node=el('onlineStatus');
    if(!scope()||!node)return;
    delete node.dataset.connectionError;
    node.textContent=message;
    if(message==='在线聊天服务连接失败，请稍后再试。'&&el('onlineMessages')&&resumeChat){
      node.dataset.connectionError='1';
      const retry=document.createElement('button');
      retry.type='button';
      retry.textContent='重试';
      retry.style.cssText='margin-inline-start:auto;flex:none;min-height:36px;padding:0 10px';
      const row=document.createElement('span');
      row.style.cssText='display:flex;align-items:center;gap:8px';
      const label=document.createElement('span');
      label.textContent=message;
      row.append(label,retry);
      node.replaceChildren(row);
      retry.onclick=async()=>{
        retry.disabled=true;
        retry.textContent='重试中…';
        try{await resumeChat();}finally{retry.disabled=false;retry.textContent='重试';}
      };
      return;
    }
    if(!/请稍后再\s*@/u.test(message))return;
    const close=document.createElement('button');
    close.type='button';
    close.textContent='×';
    close.setAttribute('aria-label','关闭提示');
    close.style.cssText='margin-inline-start:auto;flex:none;min-width:36px;min-height:36px;padding:0 8px;font-size:20px;line-height:1';
    const text=document.createElement('span');
    text.textContent=message;
    const row=document.createElement('span');
    row.style.cssText='display:flex;align-items:center;gap:8px;width:100%';
    row.append(text,close);
    node.replaceChildren(row);
    close.onclick=()=>{node.replaceChildren();};
  }
  function screen(title,body,back,headerAction='',headerAvatar=''){
    clearTimeout(pollTimer);
    resumeChat=null;
    imageObserver?.disconnect();
    const serial=++generation;
    dialog('<section class="group-room" id="ledgerOnline"><div class="chat-top"><button id="onlineBack" type="button" aria-label="返回">‹</button>'+headerAvatar+'<div class="chat-name"><h2 id="onlineTitle">'+esc(title)+'</h2></div>'+headerAction+'</div>'+body+'</section>',true);
    el('onlineBack').onclick=back||(()=>el('dialog').close());
    el('dialog').orbBack=el('onlineBack').onclick;
    return serial;
  }
  function storedFrame(value){
    if(typeof value==='string')try{value=JSON.parse(value);}catch{value=null;}
    return {...frameDefaults(),ring:false,...(value||{})};
  }
  const personAvatar=(name,src,frame)=>avatarMarkup({name,avatar:src||'',frame:storedFrame(frame)});
  function fitText(value,limit){
    return String(value??'').trim().slice(0,limit).replace(/[\uD800-\uDBFF]$/u,'');
  }
  async function compactFrame(frame){
    const layout=storedFrame(frame);
    const src=safePicture(layout.src||'');
    if(src.length<=120000)return {...layout,src};
    if(!src.startsWith('data:'))return {...layout,src:''};
    try{return {...layout,src:await renderLook(src)};}
    catch{return {...layout,src:''};}
  }
  async function renderLook(src){
    const img=new Image();img.src=src;await img.decode();
    const canvas=document.createElement('canvas');
    const context=canvas.getContext('2d');
    for(const max of [256,192,144,96]){
      const scale=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));
      canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));
      canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
      context.drawImage(img,0,0,canvas.width,canvas.height);
      const encoded=canvas.toDataURL('image/webp',0.78);
      if(encoded.length<=120000 && /^data:image\/(webp|png);base64,/.test(encoded))return encoded;
    }
    throw Error('这张图片无法缩小到在线聊天支持的大小。');
  }
  async function readLookFile(file){
    if(!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type))throw Error('请选择有效图片。');
    const url=URL.createObjectURL(file);
    try{return await renderLook(url);}finally{URL.revokeObjectURL(url);}
  }
  function directory(){
    return '<button type="button" class="directory-item" data-action="onlineChat" aria-haspopup="dialog">'+personAvatar('◈')+'<span><strong>在线聊天</strong><small>'+(inviteFromUrl()?'你收到了会话邀请':'和朋友私聊、建群或邀请角色')+'</small></span><b>›</b></button>';
  }
  function userPersona(){
    return [['性别',state.userGender],['性格',state.userPersonality],['人设',state.user]].filter(x=>x[1]).map(([k,v])=>k+'：'+v).join('\n');
  }
  async function avatarThumbnail(){
    const source=safePicture(appearance('user').avatar||'');
    if(!source)return '';
    if(/^data:image\/(jpeg|png|webp);base64,/.test(source)&&source.length<=24000)return source;
    return new Promise(resolve=>{
      const image=new Image();
      const timer=setTimeout(()=>resolve(''),3000);
      image.crossOrigin='anonymous';
      image.onload=()=>{
        clearTimeout(timer);
        try{
          const canvas=document.createElement('canvas');canvas.width=96;canvas.height=96;
          const size=Math.min(image.naturalWidth,image.naturalHeight);
          for(const pixels of [96,72,48]){
            canvas.width=canvas.height=pixels;
            canvas.getContext('2d').drawImage(image,(image.naturalWidth-size)/2,(image.naturalHeight-size)/2,size,size,0,0,pixels,pixels);
            const encoded=canvas.toDataURL('image/jpeg',0.72);
            if(encoded.length<=24000&&/^data:image\/(jpeg|png);base64,/.test(encoded)){resolve(encoded);return;}
          }
          resolve('');
        }catch{resolve('');}
      };
      image.onerror=()=>{clearTimeout(timer);resolve('');};
      image.src=source;
    });
  }
  function form(id,callback){
    const node=el(id);
    node.onsubmit=async event=>{
      event.preventDefault();
      const button=node.querySelector('[type=submit]');
      if(button.disabled)return;
      button.disabled=true;
      const serial=generation;
      try{await callback(Object.fromEntries(new FormData(node)),serial);}
      catch(error){if(active(serial))status(error.message);}
      finally{button.disabled=false;}
    };
  }
  let visionSync=Promise.resolve(), syncedVision;
  function syncVision(){
    if(localStorage.getItem(profileReadyKey)!=='1')return Promise.resolve();
    const token=identity(), {url,model,key:apiKey}=state.imageApi;
    const config=url&&model&&apiKey?{endpoint:url,model,key:apiKey}:{enabled:false};
    const signature=JSON.stringify([token,config]);
    const work=visionSync.catch(()=>{}).then(async()=>{
      if(localStorage.getItem(key)!==token||syncedVision===signature)return;
      await request('vision-api',config,AbortSignal.timeout(10000));
      syncedVision=signature;
    });
    visionSync=work;
    return work;
  }
  async function activate(){
    const token=identity();
    const look=appearance('user');
    const snapshot={name:fitText(look.name,30)||'你',persona:fitText(userPersona(),18000),avatar:look.avatar,frame:look.frame};
    if(onlineIdentity!==token){
      clearTimeout(noticeTimer);noticeSession=null;queuedNotice=null;el('onlineNotice')?.remove();
      roomsRequest=null;roomsAt=0;onlineIdentity=token;me=null;syncedProfile=null;knownRooms=null;views.clear();pictures.clear();
    }
    const invite=inviteFromUrl();
    if(me && !invite)rooms();
    const serial=me&&!invite?generation:screen('在线聊天','<p class="muted">正在连接…</p>'+end);
    try{
      if(!me||JSON.stringify(snapshot)!==syncedProfile){
        const [avatar,frame]=await Promise.all([avatarThumbnail(),compactFrame(snapshot.frame)]);
        if(onlineIdentity!==token)return;
        const controller=new AbortController();
        const timeout=setTimeout(()=>controller.abort(),15000);
        let user;
        try{user=await request('profile',{...snapshot,avatar,frame},controller.signal);}
        finally{clearTimeout(timeout);}
        if(!user?.id)throw Error('服务器没有确认在线身份，请重试。');
        if(onlineIdentity!==token)return;
        me=user;syncedProfile=JSON.stringify(snapshot);
        localStorage.setItem(profileReadyKey,'1');
      }
      if(!active(serial))return;
      startNotices();
      void syncVision().catch(()=>{if(active(serial))status('在线识图配置同步失败，请检查图片 API 设置。');});
      if(invite)join(invite);else if(!el('onlineList'))rooms();
    }catch(error){
      if(!active(serial))return;
      if(el('onlineList')){status('在线资料同步失败。'+error.message);return;}
      showProfileGate('在线 User 人设同步未完成。'+error.message);
    }
  }
  function showProfileGate(message=''){
    const look=appearance('user');
    const name=fitText(look.name,30)||'你';
    screen('在线聊天',
      '<section class="group-settings-card group-settings-block"><h3>在线 User 人设</h3><p class="muted">当前昵称：'+esc(name)+'</p>'+
      '<p>使用本机的 User 人设卡进入在线聊天。昵称和头像会显示给会话成员。</p>'+
      (message?'<p role="alert">'+esc(message)+'</p>':'')+
      '<div class="row"><button type="button" class="primary" id="onlineStart">'+(message?'重新同步并进入':'使用当前 User 人设进入')+'</button>'+
      '<button type="button" id="onlineEditUser">编辑 User 人设卡</button></div></section>'+end);
    el('onlineStart').onclick=activate;
    el('onlineEditUser').onclick=()=>openCard('user');
  }
  function open(){
    if(localStorage.getItem(key)&&localStorage.getItem(profileReadyKey)==='1')return activate();
    showProfileGate();
  }
  function later(serial, refresh, delay){
    if(!active(serial))return;
    pollTimer=setTimeout(async()=>{
      if(!active(serial))return;
      try{if(!document.hidden)await refresh();}
      catch(error){if(active(serial))status(error.message);}
      finally{later(serial,refresh,delay);}
    },typeof delay==='function'?delay():delay);
  }
  function rooms(){
    room=null;
    const serial=screen('在线聊天','<div class="row"><button class="primary" id="onlineNew">新建会话</button></div>'+end+'<div class="messages" id="onlineList"></div><p class="contact-signature" id="onlineSignature" tabindex="0" role="button">BELONG TO S.J.&amp;L.S.R.</p>',undefined,'<button type="button" id="onlineJoin" style="margin-inline-start:auto;white-space:nowrap">加入群聊</button>');
    const signature=el('onlineSignature');
    let revealing=false;
    async function revealCode(){
      if(revealing)return;
      revealing=true;
      try{
        const identityAtStart=me?.id;
        const code=me?.userCode||(await request('user-code')).code;
        if(!active(serial)||me?.id!==identityAtStart)return;
        me.userCode=code;
        screen('个人用户码','<section class="group-settings-card group-settings-block"><p style="text-align:center;overflow-wrap:anywhere"><strong>'+esc(code)+'</strong></p><button type="button" id="onlineCodeBack">返回</button></section>'+end,rooms);
        el('onlineCodeBack').onclick=rooms;
      }catch(error){if(active(serial))status(error.message);}
      finally{revealing=false;}
    }
    signature.onclick=revealCode;
    signature.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();void revealCode();}};
    el('onlineNew').onclick=create;
    el('onlineJoin').onclick=()=>join();
    let previous;
    function paint(list){
      if(!active(serial))return;
      const signature=JSON.stringify(list);
      if(signature===previous)return;
      previous=signature;
      el('onlineList').innerHTML=list.map(x=>'<button type="button" class="directory-item" data-online-room="'+esc(x.id)+'">'+(x.kind==='group'?groupAvatar(x):personAvatar(x.name))+'<span><strong>'+esc(x.name)+'</strong><small>'+esc(x.preview||(x.kind==='group'?'群聊':'私聊'))+'</small></span>'+(x.unread?'<b aria-label="'+Number(x.unread)+' 条未读消息" style="display:inline-grid;place-items:center;min-width:1.7em;height:1.7em;border:1px solid var(--gold);border-radius:50%;font:inherit;font-size:.82em;color:var(--gold);background:var(--panel)">'+(x.unread>99?'99+':Number(x.unread))+'</b>':'<b>›</b>')+'</button>').join('')||'<div class="empty">还没有在线会话</div>';
      el('onlineList').querySelectorAll('button').forEach(b=>{
        b.onclick=()=>chatRoom(list.find(x=>x.id===b.dataset.onlineRoom));
        b.onpointerdown=()=>prefetchRoom(b.dataset.onlineRoom);
      });
    }
    if(knownRooms)paint(knownRooms);
    else el('onlineList').textContent='正在加载会话…';
    async function refresh(){
      const firstLoad=knownRooms===null;
      const list=await readRooms();
      if(!active(serial))return;
      paint(list);
      if(firstLoad&&list[0])prefetchRoom(list[0].id);
    }
    refresh().catch(e=>{if(active(serial))status(e.message);});
    later(serial,refresh,12000);
  }
  function create(){
    screen('新建会话','<form id="onlineCreate"><label>类型<select name="kind"><option value="group">群聊</option><option value="dm">私聊</option></select></label><label id="onlineGroupName">群聊名称<input name="name" maxlength="40" required></label><button type="submit" class="primary">创建</button></form>'+end,rooms);
    const node=el('onlineCreate');
    node.elements.kind.onchange=()=>{
      const dm=node.elements.kind.value==='dm';
      el('onlineGroupName').hidden=dm;node.elements.name.required=!dm;
    };
    form('onlineCreate',async(data,serial)=>{
      const {id}=await request('rooms',data);
      roomsAt=0;
      if(active(serial))chatRoom({id,name:data.kind==='dm'?'好友私聊':data.name,kind:data.kind});
    });
  }
  function join(linkInvite=''){
    const linked=/^[a-f0-9-]{36}$/i.test(linkInvite);
    const url=new URL(location.href);
    if(url.searchParams.has('onlineInvite')){
      url.searchParams.delete('onlineInvite');history.replaceState(null,'',url);
    }
    screen(linked?'好友私聊邀请':'加入群聊','<form id="onlineJoinForm">'+(linked
      ?'<p class="muted">如果你要加入在线群聊，请返回并输入群主提供的六位邀请码。</p>'
      :'<label>六位邀请码<input name="invite" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="6" pattern="[A-Za-z0-9]{6}" required placeholder="例如 a7k2m9"></label>')+
      '<button type="submit" class="primary">加入</button></form>'+end,rooms);
    form('onlineJoinForm',async(data,serial)=>{
      const invite=linked?linkInvite:data.invite.trim().toLowerCase();
      if(!linked&&!/^[a-z0-9]{6}$/.test(invite))throw Error('请输入六位邀请码。');
      const {id}=await request('join',{invite});
      if(!active(serial))return;
      const list=await readRooms(true);
      if(active(serial))chatRoom(list.find(x=>x.id===id));
    });
  }
  function displayFor(id){
    try{return JSON.parse(localStorage.getItem(displayKey)||'{}')[id]||{};}
    catch{return {};}
  }
  async function prepareImage(file){
    if(!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type))throw Error('请选择 JPG、PNG、WebP 或 GIF。');
    if(file.size>12000000)throw Error('请选择小于 12 MB 的图片。');
    if(file.size<=178000)return new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onload=()=>resolve(reader.result);
      reader.onerror=()=>reject(Error('图片读取失败。'));
      reader.readAsDataURL(file);
    });
    if(file.type==='image/gif')throw Error('为保留动画，请选择小于 178 KB 的 GIF 表情包。');
    const url=URL.createObjectURL(file);
    try{
      const image=new Image();image.src=url;await image.decode();
      const canvas=document.createElement('canvas');
      for(const max of [960,720,480,320]){
        const scale=Math.min(1,max/Math.max(image.naturalWidth,image.naturalHeight));
        canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));
        canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
        canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
        const data=canvas.toDataURL('image/webp',0.75);
        if(data.length<=240000)return data;
      }
      throw Error('图片过大，压缩后仍无法发送。');
    }finally{URL.revokeObjectURL(url);}
  }
  async function packetSettings(current,back){
    const serial=screen('群聊货币','<p class="muted">正在读取货币单位…</p>'+end,back);
    try{
      const {currency}=await request('red-packet-options?room='+current.id);
      if(!active(serial))return;
      const [main,middle,small]=currency.units;
      const name=(field,label,value)=>'<label>'+label+'<input name="'+field+'" required maxlength="16" value="'+esc(value)+'"></label>';
      const rate=(field,label,value)=>'<label>'+label+'<input type="number" name="'+field+'" required min="2" max="10000" step="1" value="'+value+'"></label>';
      screen('群聊货币','<form id="onlineCurrency" class="group-settings-card group-settings-block">'+name('main','最大单位',main)+name('middle','中间单位',middle)+name('small','最小单位',small)+
        rate('mainRate','1 个最大单位等于几个中间单位',currency.rates[0])+rate('smallRate','1 个中间单位等于几个最小单位',currency.rates[1])+
        '<button type="submit" class="primary">保存</button></form>'+end,back);
      form('onlineCurrency',async(data,requestSerial)=>{
        await request('red-packet-currency',{...data,room:current.id});
        if(active(requestSerial)){back();toast('群聊货币已保存');}
      });
    }catch(error){if(active(serial))status(error.message);}
  }
  const packetLabels={normal:'普通红包',lucky:'拼手气红包',exclusive:'专属红包'};
  const packetStyle=`<style>
    #ledgerOnline .packet-page{width:min(100%,28rem);margin:0 auto;min-height:0;overflow:auto;padding:2px 2px 16px;box-sizing:border-box;display:grid;align-content:start;gap:14px;color:var(--ink)}
    #ledgerOnline .packet-page [hidden]{display:none!important}
    #ledgerOnline .packet-modes{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;border:1px solid var(--line);background:var(--panel);border-radius:12px;padding:4px}
    #ledgerOnline .packet-mode{position:relative;display:block;margin:0;text-align:center}
    #ledgerOnline .packet-mode input{position:absolute;inset:0;opacity:0;width:100%;height:100%;margin:0;cursor:pointer}
    #ledgerOnline .packet-mode span{display:grid;place-items:center;min-height:44px;padding:0 2px;border-radius:8px;font-size:.9em}
    #ledgerOnline .packet-mode input:checked+span{background:var(--button-hi,var(--gold));color:var(--button-ink,var(--field));font-weight:700}
    #ledgerOnline .packet-mode input:focus-visible+span{outline:2px solid var(--ink);outline-offset:-3px}
    #ledgerOnline .packet-panel{border:1px solid var(--line);background:var(--panel);border-radius:14px;overflow:hidden}
    #ledgerOnline .packet-field{display:grid;gap:10px;padding:13px 14px;margin:0}
    #ledgerOnline .packet-field+.packet-field{border-top:1px solid var(--line)}
    #ledgerOnline .packet-field-inline{grid-template-columns:auto minmax(0,1fr);align-items:center}
    #ledgerOnline .packet-units{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
    #ledgerOnline .packet-units label{display:grid;gap:4px;margin:0;min-width:0;font-size:.86em;color:var(--muted);overflow-wrap:anywhere}
    #ledgerOnline .packet-field input,#ledgerOnline .packet-field select{box-sizing:border-box;min-width:0;width:100%;margin:0;min-height:44px;padding:7px 9px}
    #ledgerOnline .packet-field [name=count]{width:min(100%,7rem);justify-self:end;text-align:right}
    #ledgerOnline .packet-field small{grid-column:1/-1;text-align:right;color:var(--muted)}
    #ledgerOnline .packet-total{text-align:center;padding:14px 10px 9px;overflow-wrap:anywhere}
    #ledgerOnline .packet-total strong{display:block;font-size:clamp(1.8rem,8vw,2.6rem);line-height:1.15;font-variant-numeric:tabular-nums}
    #ledgerOnline .packet-total small{display:block;margin-top:6px;color:var(--muted)}
    #ledgerOnline .packet-send{min-height:46px;width:100%}
    #ledgerOnline .packet-envelope{text-align:center;padding:24px 16px 20px;color:var(--ink);border:1px solid var(--line);border-radius:16px;background:var(--panel);background:linear-gradient(165deg,color-mix(in srgb,var(--panel) 78%,var(--gold)),var(--panel) 75%);overflow-wrap:anywhere}
    #ledgerOnline .packet-envelope h3,#ledgerOnline .packet-envelope p{margin:6px 0}
    #ledgerOnline .packet-claim{border-radius:50%;width:70px;height:70px;margin:12px auto 0;padding:0;display:grid;place-items:center;font-size:1.45rem;font-weight:700}
    #ledgerOnline .packet-claims{padding:3px 14px;margin:0;list-style:none}
    #ledgerOnline .packet-claims li{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:10px 0;overflow-wrap:anywhere}
    #ledgerOnline .packet-claims li+li{border-top:1px solid var(--line)}
    #ledgerOnline .packet-claims strong{text-align:right}
  </style>`;
  async function composePacket(current){
    const back=()=>chatRoom(current);
    const serial=screen('发红包','<p class="muted">正在读取群聊货币…</p>'+end,back);
    try{
      const {currency,people}=await request('red-packet-options?room='+current.id);
      if(!active(serial))return;
      const maxCount=Math.min(100,people.length);
      const modes=Object.entries(packetLabels).map(([mode,label])=>`<label class="packet-mode"><input type="radio" name="mode" value="${mode}" ${mode==='normal'?'checked':''}><span>${label}</span></label>`).join('');
      const amount=['main','middle','small'].map((name,i)=>`<label>${esc(currency.units[i])}<input type="number" name="${name}" min="0" step="${i?'1':'0.01'}" inputmode="${i?'numeric':'decimal'}" placeholder="0"></label>`).join('');
      const targets=people.filter(person=>person.id!=='user:'+me.id).map(person=>`<option value="${esc(person.id)}">${esc(person.name)}${person.id.startsWith('char:')?' · Char':''}</option>`).join('');
      screen('发红包',packetStyle+`<form id="onlinePacket" class="packet-page">
        <div class="packet-modes" role="group" aria-label="红包类型">${modes}</div>
        <div class="packet-panel">
          <div class="packet-field"><span>总金额</span><div class="packet-units">${amount}</div></div>
          <div class="packet-field packet-field-inline" id="onlinePacketCount">
            <label for="onlinePacketCountInput">红包个数</label>
            <input id="onlinePacketCountInput" name="count" type="number" inputmode="numeric" min="1" max="${maxCount}" required value="1" aria-describedby="onlinePacketCountHint">
            <small id="onlinePacketCountHint">最多 ${maxCount} 份</small>
          </div>
          <label class="packet-field packet-field-inline" id="onlinePacketTarget" hidden>发给<select name="target"><option value="">选择群成员</option>${targets}</select></label>
        </div>
        <div class="packet-total"><strong id="onlinePacketAmount"></strong><small>${esc(currency.units[0])} · 虚拟货币</small></div>
        <button type="submit" class="primary packet-send">发红包</button>
      </form>`+end,back);
      const node=el('onlinePacket');
      const update=()=>{
        const {mode,count,target,main,middle,small}=node.elements, exclusive=mode.value==='exclusive';
        el('onlinePacketCount').hidden=exclusive;count.disabled=exclusive;
        el('onlinePacketTarget').hidden=!exclusive;target.required=exclusive;target.disabled=!exclusive;
        const total=Number(main.value)+Number(middle.value)/currency.rates[0]+Number(small.value)/(currency.rates[0]*currency.rates[1]);
        el('onlinePacketAmount').textContent=Number.isFinite(total)?total.toFixed(2):'—';
      };
      node.addEventListener('input',update);update();
      form('onlinePacket',async(data,requestSerial)=>{
        await request('red-packet',{room:current.id,mode:data.mode,count:data.count,target:data.target,amount:{main:data.main,middle:data.middle,small:data.small}});
        if(active(requestSerial))back();
      });
    }catch(error){if(active(serial))status(error.message);}
  }
  function openPacket(current,id){
    const serial=screen('群聊红包',packetStyle+`<div class="packet-page">
      <section class="packet-envelope">
        <div id="onlinePacketDetails"><p class="muted">正在读取红包…</p></div>
        <button id="onlineClaimPacket" type="button" class="primary packet-claim" aria-label="拆开红包" hidden>开</button>
      </section>
      <ul class="packet-panel packet-claims" id="onlinePacketClaims" aria-label="领取明细" hidden></ul>
    </div>`+end,()=>chatRoom(current));
    const button=el('onlineClaimPacket');
    let previous, claiming=false;
    async function refresh(){
      const packet=await request('red-packet-detail?room='+current.id+'&id='+id);
      if(!active(serial))return;
      button.hidden=!packet.canClaim;
      const signature=JSON.stringify(packet);
      if(previous===signature)return;
      previous=signature;
      const own=packet.claims.find(claim=>claim.id==='user:'+me.id);
      const amount=cents=>esc((cents/100).toFixed(2));
      const unit=esc(packet.unit);
      const progress=packet.declined?esc(packet.declined)+' 已拒收':
        (packet.remaining===0?'已领完 · ':'')+'已领取 '+packet.claims.length+' / '+packet.count;
      el('onlinePacketDetails').innerHTML=`<h3>${esc(packetLabels[packet.mode])}</h3>
        ${packet.targetName?'<p>专属给 '+esc(packet.targetName)+'</p>':''}
        ${own||!packet.canClaim?`<div class="packet-total"><strong>${amount(own?own.cents:packet.total)}</strong><small>${own?'你领取了':'红包总额'} · ${unit}</small></div>`:''}
        <p class="muted">${progress}</p>`;
      const claims=el('onlinePacketClaims');
      claims.hidden=!packet.claims.length;
      claims.innerHTML=packet.claims.map(claim=>`<li><span>${esc(claim.name)}</span><strong>${amount(claim.cents)} ${unit}</strong></li>`).join('');
    }
    button.onclick=async()=>{
      if(claiming)return;
      claiming=true;button.disabled=true;
      try{
        await request('red-packet-claim',{room:current.id,id:Number(id)});
        if(active(serial)){await refresh();status('已领取红包。');}
      }catch(error){if(active(serial))status(error.message);}
      finally{claiming=false;button.disabled=false;}
    };
    refresh().catch(error=>{if(active(serial))status(error.message);});
    later(serial,refresh,2500);
  }
  async function shareArchive(card,back){
    const type=card.htmlCard?'moon':'story';
    const serial=screen('分享到在线群聊','<p class="muted">正在读取在线群聊…</p>'+end,back);
    try{
      const groups=(await request('rooms')).filter(item=>item.kind==='group');
      if(!active(serial))return;
      if(!groups.length){
        screen('分享到在线群聊','<p class="muted">你还没有加入在线群聊。</p>',back);
        return;
      }
      screen('分享到在线群聊','<form id="onlineArchiveShare"><p>'+esc(card.title)+'</p><label>选择群聊<select name="target" required><option value="">请选择</option>'+
        groups.map(item=>'<option value="'+esc(item.id)+'">'+esc(item.name)+'</option>').join('')+'</select></label><button type="submit" class="primary">发送卡片</button></form>'+end,back);
      form('onlineArchiveShare',async(data,requestSerial)=>{
        await request('archive-card',{room:data.target,title:card.title,body:card.body,type});
        if(active(requestSerial)){back();toast('卡片已分享到在线群聊');}
      });
    }catch(error){
      if(active(serial))status(error.status===403?'请先从通讯录进入在线聊天，完成在线身份设置。':error.message);
    }
  }
  async function readOnlineArchive(current,id,serial,button,forwardPosition=null){
    button.disabled=true;
    try{
      const card=await request((forwardPosition===null?'archive-card':'forward-archive')+'?room='+current.id+'&id='+id+(forwardPosition===null?'':'&position='+forwardPosition));
      if(!active(serial))return;
      rememberChat(current.id);
      const back=()=>forwardPosition===null?chatRoom(current):readForwardCard(current,id);
      const body=card.type==='moon'
        ? storyHtmlPreview(card.body,card.title).replace('sandbox="allow-scripts"','sandbox=""')
        : '<article class="story-paper story-reader" style="font-size:'+state.storyFont+'px">'+esc(card.body)+'</article>';
      storyDialog(card.title,body+'<footer class="story-reader-exit"><button type="button" data-action="storyBack">返回聊天</button></footer>','reader',back);
      const exit=el('dialog').querySelector('.story-header-exit');
      exit?.setAttribute('aria-label','返回聊天');
      exit?.setAttribute('title','返回聊天');
      if(card.type==='story')bindStoryScrubber();
    }catch(error){if(active(serial))status(error.message);}
    finally{button.disabled=false;}
  }
  function imageInOnlineMessage(id){
    return '<img data-online-image="'+id+'" alt="聊天图片" class="message-image" decoding="async">';
  }
  function loadPictures(box){
    const serial=generation, currentRoom=room.id;
    imageObserver?.disconnect();
    function loadImage(image){
      const id=image.dataset.onlineImage, key=currentRoom+':'+id;
      if(!pictures.has(key)){
        if(pictures.size>=30)pictures.delete(pictures.keys().next().value);
        const loading=request('image?room='+currentRoom+'&id='+id).then(result=>safePicture(result.image));
        pictures.set(key,loading);
        loading.catch(()=>{if(pictures.get(key)===loading)pictures.delete(key);});
      }
      pictures.get(key).then(src=>{
        if(src&&active(serial)&&image.isConnected)image.src=src;
      }).catch(()=>{if(active(serial)&&image.isConnected)image.alt='图片加载失败';});
    }
    const images=box.querySelectorAll('[data-online-image]:not([src])');
    if(typeof IntersectionObserver!=='function'){
      images.forEach(loadImage);
      return;
    }
    imageObserver=new IntersectionObserver((entries,observer)=>{
      for(const entry of entries){
        if(entry.isIntersecting&&active(serial)){
          observer.unobserve(entry.target);
          loadImage(entry.target);
        }
      }
    },{root:box,rootMargin:'180px 0px'});
    images.forEach(image=>imageObserver.observe(image));
  }
  const humanMessageFrame='<style>'+
    '#ledgerOnline .bubble.online-human-only{outline:var(--human-frame-width,1px) var(--human-frame-style,solid) var(--human-frame-color,var(--gold));outline-offset:var(--human-frame-offset,-3px)}'+
    '[data-skin="day"] #ledgerOnline{--human-frame-color:#667683;--human-frame-style:dashed}'+
    '[data-skin="night"] #ledgerOnline{--human-frame-color:#bda7eb;--human-frame-style:dotted;--human-frame-width:2px}'+
    '[data-skin="gryffindor"] #ledgerOnline{--human-frame-color:#e0b76a;--human-frame-style:double;--human-frame-width:3px}'+
    '[data-skin="slytherin"] #ledgerOnline{--human-frame-color:#a4cfbc;--human-frame-width:2px}'+
    '[data-skin="hufflepuff"] #ledgerOnline{--human-frame-color:#e9c988;--human-frame-style:dashed;--human-frame-offset:-4px}'+
    '[data-skin="ravenclaw"] #ledgerOnline{--human-frame-color:#99bce8;--human-frame-style:double;--human-frame-width:3px}'+
    '[data-skin="mist"] #ledgerOnline{--human-frame-color:#8ca9cf;--human-frame-offset:-3px}'+
    '[data-skin="dawn-frost"] #ledgerOnline .bubble.online-human-only{outline-color:#a35469;box-shadow:inset 0 0 0 1px #789db7}'+
    '[data-skin="obsidian-duet"] #ledgerOnline{--human-frame-color:#bca06a;--human-frame-style:double;--human-frame-width:3px;--human-frame-offset:-4px}'+
    '[data-skin="rose-graphite"] #ledgerOnline{--human-frame-color:#b57284;--human-frame-style:double;--human-frame-width:3px}'+
    '[data-skin="baker-street"] #ledgerOnline .bubble.online-human-only{position:relative;outline:none;border:1px solid color-mix(in srgb,var(--gold) 42%,var(--line));box-shadow:inset 3px 0 0 color-mix(in srgb,var(--gold) 58%,var(--panel)),0 2px 5px #0002;background-image:linear-gradient(90deg,color-mix(in srgb,var(--gold) 7%,transparent),transparent 28%)}'+
    '[data-skin="baker-street"] #ledgerOnline .bubble.online-human-only:after{content:"";position:absolute;right:8px;top:8px;width:7px;height:7px;border-top:1px solid color-mix(in srgb,var(--gold) 65%,transparent);border-right:1px solid color-mix(in srgb,var(--gold) 65%,transparent);pointer-events:none}'+
    '#ledgerOnline .bubble.online-message-picked{outline:4px solid var(--gold)!important;outline-offset:2px!important}'+
    '</style>';
  function drawMessages(mode,added=null){
    const box=el('onlineMessages'), oldHeight=box.scrollHeight, oldTop=box.scrollTop;
    const people=new Map((detail?.members||[]).map(x=>[x.id,x]));
    const display=displayFor(room.id);
    const cast=new Map((detail?.chars||[]).map(x=>[x.id,x]));
    const resolved=new Set(messages.filter(m=>m.challenge).map(m=>Number(m.challenge)));
    const removed=new Set(messages.filter(m=>m.kind==='message-deleted').map(m=>Number(m.body)));
    const markup=(added||messages).map(m=>{
        if(['deleted','message-deleted'].includes(m.kind)||removed.has(m.id))return '';
        if(m.kind==='member-joined'){
          return '<div class="muted" style="text-align:center;margin:10px 0"><small style="display:inline-block;padding:3px 10px;border:1px solid var(--line);border-radius:999px;background:var(--field);overflow-wrap:anywhere">'+esc(m.body)+'</small></div>';
        }
        const mine=!m.char_id&&m.sender===me.id;
        const role=mine?'user':'assistant';
        const frame=['human-only','human-image','mention-all'].includes(m.kind)?' online-human-only':'';
        const look=m.char_id?cast.get(m.char_id):people.get(m.sender);
        const face=personAvatar(m.name,m.char_id?look?.avatar_image:look?.avatar,look?.frame);
        const avatar=room.kind==='group'&&!mine
          ? '<button type="button" class="avatar-button" data-online-avatar="'+esc(m.id)+'" style="touch-action:pan-y;user-select:none;-webkit-touch-callout:none" aria-label="长按提及 '+esc(m.name)+'">'+face+'</button>'
          : '<span class="avatar-button">'+face+'</span>';
        const name=mine||display.showName===false?'':'<small>'+esc(m.name)+'</small>';
        const date=new Date(m.created.replace(' ','T')+'Z');
        const time=display.showTime===false||Number.isNaN(date.getTime())?'':'<small class="muted">'+date.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false})+'</small>';
        const layout=chatMessageLayout(avatar,name,time);
        const parts=m.char_id&&!['red-packet','forwarded-chat'].includes(m.kind)?chatBubbleParts({role:'assistant',content:stripCharacterPrefix(m.body,m.name)},{split:display.split!==false,limit:30}):[m.body];
        return parts.map((part,index)=>{
          const first=index===0;
          let content=(first?quoteMarkup(readOnlineMeta(m).quote):'')+'<p style="white-space:pre-wrap;overflow-wrap:anywhere">'+esc(part)+'</p>';
          if(m.kind==='image'||m.kind==='human-image')content=imageInOnlineMessage(m.id);
          if(m.kind==='red-packet')content='<button type="button" class="forwarded-story-card" data-online-packet="'+esc(m.id)+'" style="display:grid;gap:4px;text-align:start;border:1px solid var(--gold);max-width:100%;overflow-wrap:anywhere"><small>红包 · 虚拟货币</small><strong>'+esc(m.body)+'</strong><span>查看红包 ›</span></button>';
          if(m.kind==='forwarded-chat'){const card=readOnlineMeta(m);content='<button type="button" class="forwarded-story-card online-forward-card" data-online-forward="'+esc(m.id)+'" style="width:min(300px,65vw);max-width:100%;text-align:start"><small>聊天记录 · '+Number(card.count||0)+' 条</small><strong>'+esc(card.title||m.body)+'</strong>'+((card.preview||[]).map(item=>'<span style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(item.speaker+'：'+item.body)+'</span>').join(''))+'<small>点开查看 ›</small></button>';}
          if(m.kind==='archive-card')content='<button type="button" class="forwarded-story-card" data-online-archive="'+esc(m.id)+'" style="display:grid;text-align:start;max-width:100%;overflow-wrap:anywhere"><small>✦ 群聊分享</small><strong>'+esc(m.body)+'</strong><span>点开阅读 ›</span></button>';
          if(m.kind==='rps'){
            const closed=m.resolved||resolved.has(m.id);
            content+=closed?'<small class="muted">已结束</small>':mine?'<small class="muted">等待另一位真人出拳</small>':
              '<div class="row">'+hands.map(([value,label])=>'<button type="button" data-rps-id="'+m.id+'" data-rps-choice="'+value+'">'+label+'</button>').join('')+'</div>';
          }
          // Mist uses the metadata sibling to theme the bubble. Keep it without a layout box.
          const leading=first?layout.before:state.skin==='mist'?'<div class="mist-chat-meta" hidden style="display:none"></div>':'<span class="avatar-button" aria-hidden="true" style="visibility:hidden;flex:none">'+personAvatar(m.name)+'</span>';
          return '<div class="message-row '+role+'">'+leading+'<article data-online-message="'+esc(m.id)+'" class="bubble '+role+frame+(onlineSelected.has(m.id)?' online-message-picked':'')+'" '+(onlineSelection?'role="checkbox" tabindex="0" aria-checked="'+onlineSelected.has(m.id)+'"':'')+'>'+(first?layout.name:'')+content+(first?layout.time:'')+'</article></div>';
        }).join('');
      }).join('');
    if(added){
      el('onlineTyping').insertAdjacentHTML('beforebegin',markup);
    }else{
      box.innerHTML=(older?'<div class="chat-history-page"><button type="button" id="onlineOlder">查看更早的消息</button></div>':'')+
      (markup||(!(pendingMessage?.room===room.id)?'<div class="empty">还没有消息，打声招呼吧。</div>':'')) +
      (pendingMessage?.room===room.id?'<div class="message-row user"><span class="avatar-button">'+personAvatar(me.name,people.get(me.id)?.avatar,people.get(me.id)?.frame)+'</span><article class="bubble user'+(pendingMessage.humanOnly?' online-human-only':'')+'"><p style="white-space:pre-wrap;overflow-wrap:anywhere">'+esc(pendingMessage.body)+'</p><small class="muted">'+(pendingMessage.saved?'已发送':'发送中…')+'</small></article></div>':'')+
      '<div id="onlineTyping"></div>';
    }
    drawTyping();
    box.scrollTop=mode==='bottom'?box.scrollHeight:mode==='prepend'?oldTop+box.scrollHeight-oldHeight:oldTop;
    loadPictures(box);
    if(el('onlineOlder'))el('onlineOlder').onclick=loadOlder;
  }
  function drawTyping(){
    const target=el('onlineTyping');
    if(!target)return;
    const cast=new Map((detail?.chars||[]).map(x=>[x.id,x]));
    const activeCharacters=new Map([...typingCharacters,...[...localTyping.values()].filter(x=>x.room===room.id)].map(char=>[char.id,char]));
    const showName=displayFor(room.id).showName!==false;
    const box=el('onlineMessages');
    const stick=box.scrollHeight-box.clientHeight-box.scrollTop<120;
    target.innerHTML=[...activeCharacters.values()].map(char=>{
      const look=cast.get(char.id)||char;
      return typingBubble({...look,avatar:look.avatar_image||'',frame:storedFrame(look.frame)},showName,true);
    }).join('');
    if(stick)box.scrollTop=box.scrollHeight;
  }
  async function loadOlder(){
    const serial=generation, first=messages[0]?.id;
    try{
      const rows=await request('messages?room='+room.id+'&before='+first);
      if(!active(serial)||messages[0]?.id!==first)return;
      messages=[...rows,...messages];older=rows.length===60;
      const view=viewFor(room.id);view.messages=messages;view.older=older;drawMessages('prepend');
    }catch(e){if(active(serial))status(e.message);}
  }
  function cardContext(card){
    return {
      persona:[['姓名',card.name],['性别',card.gender],['性格',card.personality],['人设',card.description],['必须遵守的发言规则',card.speechRules],['与用户的关系',card.relationship]].filter(x=>x[1]).map(([k,v])=>k+'：'+v).concat(charRelationContext(card)).join('\n'),
      worldFront:worldContext('front',card.id),worldEnd:worldContext('end',card.id)
    };
  }
  function personalContext(card){
    const recent=(card.messages||[]).filter(m=>!m.tea&&['user','assistant'].includes(m.role)&&!replyPending(m)).slice(-10);
    return {
      memories:fitText(memoryContext(card),100000),
      dialogue:recent.map(m=>(m.role==='user'?'邀请者':'角色')+'：'+fitText(chatTextRecord(m).content,2300)).join('\n')
    };
  }
  function mapping(){
    try{return JSON.parse(localStorage.getItem(mappingKey)||'{}');}catch{return {};}
  }
  async function syncCards(serial, current, info){
    const map=mapping();
    let changed=false;
    for(const member of info.chars.filter(x=>x.owner===me.id)){
      if(!active(serial))break;
      const entry=map[member.id],card=entry&&contact(entry.card);
      if(!card)continue;
      const context=cardContext(card);
      if(member.personal_enabled)context.personal=personalContext(card);
      const signature=await contextSignature(context);
      if(entry.signature===signature)continue;
      await request('sync-card',{room:current.id,id:member.id,...context});
      entry.signature=signature;changed=true;
    }
    if(changed)localStorage.setItem(mappingKey,JSON.stringify(map));
  }
  async function contextSignature(context){
    const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(context)));
    return Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join('');
  }
  function setupMentions(input, group){
    const picker=el('onlineChoices'), toggle=el('onlineMention'), feed=el('onlineMessages');
    const selected=new Map();
    let press, position, composing=false;
    function close(){
      picker.hidden=true;picker.style.display='none';
      toggle?.setAttribute('aria-expanded','false');
    }
    function insert(person, range){
      const start=range?.start??input.selectionStart, end=range?.end??input.selectionEnd;
      const left=input.value.slice(0,start);
      const token=(left&&!/\s$/u.test(left)?' ':'')+'@'+person.name+' ';
      if(input.value.length-(end-start)+token.length>input.maxLength){status('消息已达到长度上限。');return;}
      input.setRangeText(token,start,end,'end');
      selected.set(person.name,person.charId || null);
      close();
      input.focus();
    }
    function show(range, query=''){
      const choices=[
        ...(group&&detail?.owner===me.id?[{name:'全体成员'}]:[]),
        ...(detail?.chars||[]).map(char=>({name:char.name,charId:char.id})),
        ...(detail?.members||[]).filter(member=>member.id!==me.id).map(member=>({name:member.name}))
      ].filter(person=>person.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
      el('onlineComposerMenu').hidden=true;
      el('onlineMore').setAttribute('aria-expanded','false');
      picker.replaceChildren();
      if(!choices.length){
        const empty=document.createElement('span');
        empty.className='muted';empty.textContent=query?'没有匹配的成员。':'还没有可提及的成员。';
        picker.append(empty);
      }
      for(const person of choices){
        const button=document.createElement('button');
        button.type='button';button.textContent='@'+person.name;
        button.onclick=()=>insert(person,range);
        picker.append(button);
      }
      picker.hidden=false;picker.style.display='';
      toggle?.setAttribute('aria-expanded','true');
    }
    function suggest(){
      if(!group||composing)return;
      const match=input.value.slice(0,input.selectionStart).match(/[@＠]([^\s@＠]*)$/u);
      if(!match){close();return;}
      show({start:input.selectionStart-match[0].length,end:input.selectionEnd},match[1]);
    }
    if(toggle)toggle.onclick=()=>{
      el('onlineComposerMenu').hidden=true;
      el('onlineMore').setAttribute('aria-expanded','false');
      show({start:input.selectionStart,end:input.selectionEnd});
    };
    input.addEventListener('input',suggest);
    input.addEventListener('click',suggest);
    input.addEventListener('compositionstart',()=>{composing=true;});
    input.addEventListener('compositionend',()=>{composing=false;suggest();});
    input.addEventListener('keydown',event=>{if(event.key==='Escape'&&!picker.hidden){event.preventDefault();event.stopPropagation();close();}});
    function cancelPress(){clearTimeout(press);press=null;}
    function mentionAvatar(message){
      if(!group||!message||(!message.char_id&&message.sender===me.id))return;
      const member=message.char_id
        ? detail?.chars.find(item=>item.id===message.char_id)
        : detail?.members.find(item=>item.id===message.sender);
      if(detail&&!member){status('对方已离开群聊。');return;}
      insert({name:member?.name||message.name,charId:message.char_id});
    }
    feed.addEventListener('pointerdown',event=>{
      const avatar=event.target.closest('[data-online-avatar]');
      if(!avatar||event.button!==0)return;
      const message=messages.find(item=>String(item.id)===avatar.dataset.onlineAvatar);
      if(!message)return;
      cancelPress();
      feed.setPointerCapture?.(event.pointerId);
      position=[event.clientX,event.clientY];
      press=setTimeout(()=>{press=null;if(feed.isConnected)mentionAvatar(message);},500);
    });
    feed.addEventListener('pointermove',event=>{
      if(press && Math.hypot(event.clientX-position[0],event.clientY-position[1])>10)cancelPress();
    });
    for(const event of ['pointerup','pointercancel','pointerleave','lostpointercapture','scroll'])feed.addEventListener(event,cancelPress);
    feed.addEventListener('contextmenu',event=>{
      const avatar=event.target.closest('[data-online-avatar]');
      if(avatar)event.preventDefault();
    });
    feed.addEventListener('click',event=>{
      const avatar=event.target.closest('[data-online-avatar]');
      if(avatar&&event.detail===0)mentionAvatar(messages.find(item=>String(item.id)===avatar.dataset.onlineAvatar));
    });
    return {
      target(body){
        for(const match of body.matchAll(/[@＠]([^\s@＠]+)/gu)){
          const exact=match[1], clean=exact.replace(/[，。！？、；：,.!?;:]+$/u,'');
          if(selected.has(exact)||selected.has(clean)){
            const target=selected.has(exact)?selected.get(exact):selected.get(clean);
            if(target)return target;
            continue;
          }
          const charId=detail?.chars.find(c=>c.name===exact || c.name===clean)?.id;
          if(charId)return charId;
        }
        return null;
      },
      clear(){selected.clear();close();}
    };
  }
  function readOnlineMeta(message){try{return JSON.parse(message.meta||'{}');}catch{return {};}}
  let onlineSelection=false;
  const onlineSelected=new Set();
  function paintOnlineQuote(id){
    const node=el('onlineQuoteDraft'),quote=viewFor(id).quote;
    if(!node)return;
    node.innerHTML=quote?'<div class="chat-quote-draft">'+quoteMarkup(quote)+'<button type="button" aria-label="取消引用">×</button></div>':'';
    if(quote)node.querySelector('button').onclick=()=>{viewFor(id).quote=null;paintOnlineQuote(id);};
  }
  async function markRead(current,cursor){
    const view=viewFor(current.id);
    if(!cursor||document.hidden||cursor<=(view.readCursor||0))return;
    view.readCursor=cursor;
    try{await request('read-room',{room:current.id,cursor});roomsAt=0;if(knownRooms)knownRooms=knownRooms.map(item=>item.id===current.id?{...item,unread:0}:item);}
    catch{view.readCursor=0;}
  }
  async function announcement(current,owner){
    const serial=screen('群公告','<p class="muted">正在读取…</p>'+end,()=>members(current));
    try{
      const value=await request('announcement?room='+current.id);
      if(!active(serial))return;
      const shown=screen('群公告',owner?'<form id="onlineAnnouncementForm"><label>公告内容<textarea name="body" rows="10" maxlength="5000">'+esc(value.body)+'</textarea></label><button type="submit" class="primary">保存公告</button></form>'+end:'<section class="group-settings-card"><p style="white-space:pre-wrap;overflow-wrap:anywhere">'+esc(value.body||'暂无群公告')+'</p></section>'+end,()=>members(current));
      if(owner)form('onlineAnnouncementForm',async data=>{await request('announcement',{room:current.id,body:data.body});if(active(shown))await members(current);});
    }catch(error){if(active(serial))status(error.message);}
  }
  async function readForwardCard(current,id){
    const serial=screen('聊天记录',humanMessageFrame+'<div class="messages" id="onlineForwardEntries"></div><button type="button" id="onlineForwardMore" hidden>加载更多记录</button>'+end,()=>chatRoom(current));
    const box=el('onlineForwardEntries'),more=el('onlineForwardMore');
    let last=-1,loading=false;
    function imageFor(image){
      const position=image.dataset.forwardImage;
      request('forward-image?room='+current.id+'&id='+id+'&position='+position).then(value=>{if(active(serial)&&image.isConnected)image.src=safePicture(value.image);}).catch(()=>{if(active(serial)&&image.isConnected)image.alt='图片载入失败';});
    }
    if(typeof IntersectionObserver==='function')imageObserver=new IntersectionObserver((entries,observer)=>{for(const entry of entries)if(entry.isIntersecting){observer.unobserve(entry.target);imageFor(entry.target);}},{root:box,rootMargin:'150px'});
    async function next(){
      if(loading||!active(serial))return;
      loading=true;more.disabled=true;
      try{
        const card=await request('forward-card?room='+current.id+'&id='+id+'&after='+last);
        if(!active(serial))return;
        el('onlineTitle').textContent=card.title;
        const fragment=document.createDocumentFragment();
        for(const entry of card.entries){
          const row=document.createElement('div');row.className='message-row assistant';
          let quote;try{quote=typeof entry.quote==='string'?JSON.parse(entry.quote):entry.quote;}catch{}
          const date=Date.parse(entry.created?.replace(' ','T')+(entry.created&&!/[zZ]|[+-]\d\d:\d\d$/.test(entry.created)?'Z':''));
          const stamp=Number.isFinite(date)?new Date(date).toLocaleString('zh-CN'):entry.created||'';
          row.innerHTML='<article class="bubble assistant'+(entry.humanOnly?' online-human-only':'')+'" style="max-width:100%;min-width:0;overflow-wrap:anywhere"><small>'+esc(entry.speaker)+'</small>'+quoteMarkup(quote)+'<p style="white-space:pre-wrap">'+esc(entry.body)+'</p>'+(entry.archive?'<button type="button" data-forward-archive="'+entry.position+'">阅读分享内容 ›</button>':'')+(entry.image?'<img class="message-image" data-forward-image="'+entry.position+'" alt="聊天图片" decoding="async">':'')+'<small class="muted">'+esc(stamp)+'</small></article>';
          fragment.append(row);
        }
        box.append(fragment);
        for(const image of box.querySelectorAll('img[data-forward-image]:not([data-observed])')){image.dataset.observed='1';if(imageObserver)imageObserver.observe(image);else imageFor(image);}
        if(card.entries.length)last=card.entries.at(-1).position;
        more.hidden=!card.more;
      }catch(error){if(active(serial)){status(error.message);more.hidden=false;more.textContent='重试加载';}}
      finally{loading=false;more.disabled=false;}
    }
    box.addEventListener('click',event=>{const button=event.target.closest('[data-forward-archive]');if(button)void readOnlineArchive(current,id,serial,button,Number(button.dataset.forwardArchive));});
    more.onclick=next;
    await next();
  }
  async function forwardOnline(current,chosen){
    const selected=Array.isArray(chosen)?chosen:[chosen];
    const back=()=>chatRoom(current);
    const serial=screen('转发到在线群聊','<p class="muted">正在读取…</p>'+end,back);
    try{
      const groups=(await readRooms(true)).filter(item=>item.kind==='group'&&item.id!==current.id);
      if(!active(serial))return;
      screen('转发到在线群聊','<form id="onlineForwardForm"><label>接收群聊<select name="target" required><option value="">请选择</option>'+groups.map(item=>'<option value="'+esc(item.id)+'">'+esc(item.name)+'</option>').join('')+'</select></label><button type="submit" class="primary">转发</button></form>'+end,back);
      form('onlineForwardForm',async(data,serial)=>{await request('forward-message',{room:data.target,sourceRoom:current.id,ids:selected.map(message=>message.id)});if(active(serial)){back();toast('已转发聊天记录卡片');}});
    }catch(error){if(active(serial))status(error.message);}
  }
  function toggleOnlineSelection(id,current){
    if(onlineSelected.has(id))onlineSelected.delete(id);else onlineSelected.add(id);
    for(const node of el('onlineMessages').querySelectorAll('[data-online-message="'+id+'"]')){node.classList.toggle('online-message-picked',onlineSelected.has(id));node.setAttribute('aria-checked',String(onlineSelected.has(id)));}
    paintOnlineSelection(current);
  }
  function paintOnlineSelection(current){
    const bar=el('onlineSelectionBar');if(!bar)return;
    bar.innerHTML=onlineSelection?'<div class="message-selection bulk-tools"><strong>已选 '+onlineSelected.size+' 条</strong><div class="row"><button type="button" id="onlineSelectAll">全选已加载消息</button><button type="button" id="onlineForwardSelected">转发</button><button type="button" id="onlineExportTxt">导出 TXT</button><button type="button" id="onlineScreenshot">截图</button><button type="button" id="onlineSelectDone">完成</button></div></div>':'';
    if(!onlineSelection)return;
    el('onlineSelectDone').onclick=()=>{onlineSelection=false;onlineSelected.clear();chatRoom(current);};
    el('onlineSelectAll').onclick=()=>{for(const message of messages)if(!['deleted','message-deleted','member-joined'].includes(message.kind))onlineSelected.add(message.id);for(const node of el('onlineMessages').querySelectorAll('[data-online-message]')){node.classList.add('online-message-picked');node.setAttribute('aria-checked','true');}paintOnlineSelection(current);};
    const selected=()=>{const removed=new Set(messages.filter(event=>event.kind==='message-deleted').map(event=>Number(event.body)));return messages.filter(message=>onlineSelected.has(message.id)&&!['deleted','message-deleted'].includes(message.kind)&&!removed.has(message.id));};
    el('onlineForwardSelected').onclick=()=>{const list=selected();if(!list.length)return;rememberChat(current.id);void forwardOnline(current,list);};
    el('onlineExportTxt').onclick=()=>{
      const text=selected().map(message=>message.name+' · '+message.created+' UTC\n'+[quoteText(readOnlineMeta(message).quote),message.body,['image','human-image'].includes(message.kind)?'[图片]':''].filter(Boolean).join('\n')).join('\n\n');
      if(!text)return;
      const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download='眠龙-在线群聊-'+dateString()+'.txt';link.click();setTimeout(()=>URL.revokeObjectURL(url),15000);
    };
    el('onlineScreenshot').onclick=async event=>{
      const button=event.currentTarget,list=selected();if(!list.length)return;
      button.disabled=true;
      try{
        const converted=[];
        for(const message of list){
          let image='';if(['image','human-image'].includes(message.kind)){const cache=current.id+':'+message.id;if(!pictures.has(cache))pictures.set(cache,request('image?room='+current.id+'&id='+message.id).then(result=>safePicture(result.image)));try{image=await pictures.get(cache);}catch{pictures.delete(cache);throw Error('图片载入失败，请重试截图。');}}
          const person=message.char_id?detail?.chars.find(x=>x.id===message.char_id):detail?.members.find(x=>x.id===message.sender);
          const mine=!message.char_id&&message.sender===me.id;
          converted.push({content:message.body,speaker:message.name,roleId:mine?'':'online:'+message.id,role:mine?'user':'assistant',quote:readOnlineMeta(message).quote,image,sentAt:Date.parse(message.created.replace(' ','T')+'Z'),onlinePerson:{name:message.name,avatar:person?.avatar_image||person?.avatar||'',frame:storedFrame(person?.frame)}});
        }
        await screenshotSelectedMessages(button,{c:{name:current.name},group:{...current,...displayFor(current.id),split:displayFor(current.id).split!==false},messages:converted,indices:new Set(converted.map((_,i)=>i))});
      }catch(error){status(error.message);}finally{button.disabled=false;}
    };
  }
  async function forwardExternal(scope,message){
    const back=()=>{if(scope.group)openGroup(scope.group.id);else{el('dialog').close();render();}};
    try{
      if(!me)throw Error('请先进入在线聊天完成身份同步。');
      const authors=scope.group?(message.roleId?[message.roleId]:(message.audience||scope.group.members)):[scope.c.id];
      const quoted=scope.group&&message.quote?scope.group.members.filter(id=>{const card=contact(id);return card&&[card.name,displayName(card)].includes(message.quote.speaker);}):[];
      const localIds=[...new Set([...authors,...quoted])];
      const groups=await readRooms(true),map=mapping(),remote=[];
      for(const localId of localIds){
        let enabled=null;
        for(const group of groups.filter(x=>x.kind==='group')){
          const info=await roomDetail(group.id);
          enabled=info.chars.find(char=>char.owner===me.id&&char.personal_enabled&&map[char.id]?.card===localId);
          if(enabled)break;
        }
        if(!enabled)throw Error('涉及角色须先开启在线群聊内读取个人记忆与私聊记录。');
        remote.push(enabled.id);
      }
      screen('转发到在线群聊','<form id="onlineExternalForward"><label>接收群聊<select name="target" required><option value="">请选择</option>'+groups.filter(x=>x.kind==='group').map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name)+'</option>').join('')+'</select></label><button type="submit" class="primary">转发</button></form>'+end,back);
      form('onlineExternalForward',async(data,serial)=>{await request('external-forward',{room:data.target,charIds:remote,speaker:message.speaker||(message.role==='user'?state.userName:displayName(scope.c)),body:[quoteText(message.quote),message.content].filter(Boolean).join('\n'),created:message.sentAt?new Date(message.sentAt).toISOString():'',image:message.image||''});if(active(serial)){back();toast('已转发');}});
    }catch(error){toast(error.message);}
  }
  function chatRoom(current){
    if(!current)return rooms();
    if(el('onlineNotice')?.dataset.room===current.id)el('onlineNotice').remove();
    if(queuedNotice?.room===current.id)queuedNotice=null;
    if(room?.id)rememberChat(room.id);
    const view=viewFor(current.id);
    if(room?.id!==current.id){onlineSelected.clear();onlineSelection=false;}
    room=current;messages=view.messages;older=view.older;detail=view.detail||null;typingCharacters=view.typing;
    const group=current.kind==='group';
    if(group&&detail?.name)Object.assign(current,{name:detail.name,avatar:detail.avatar});
    const bulbIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6m-5 3h4m-6-7a6 6 0 1 1 8 0c-.8.7-1 1.3-1 2H9c0-.7-.2-1.3-1-2Z"/></svg>';
    const sendIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2l9 15H3L12 2Zm0 20L3 7h18l-9 15Z"/></svg>';
    const header='<button type="button" class="star-button" id="onlineMembers" style="margin-inline-start:auto" aria-label="'+(group?'群聊设置':'成员与邀请')+'">★</button>';
    const serial=screen(current.name,humanMessageFrame+end+'<div id="onlineSelectionBar"></div><div id="onlineMessages" class="messages"></div><form id="onlineCompose"><div id="onlineQuoteDraft"></div><textarea name="body" aria-label="聊天消息" required maxlength="4000" style="width:100%;box-sizing:border-box" placeholder="'+(group?'写一条群消息…':'写一条消息…')+'"></textarea><div class="composer-tools" id="onlineChoices" aria-label="可提及的成员" style="display:none;max-height:26vh;overflow:auto" hidden></div>'+
      '<div class="composer-menu" id="onlineComposerMenu" hidden><div class="composer-tools">'+(group?'<button type="button" id="onlineMention" aria-label="提及成员" aria-controls="onlineChoices" aria-expanded="false">@ 成员</button><button type="button" id="onlineChatMemory">群记忆</button>':'')+
      '<button type="button" id="onlinePickImage">图片／表情包</button><button type="button" id="onlineEmoji">表情</button><button type="button" id="onlineDice">🎲 骰子</button><button type="button" id="onlineRps">✊ 猜拳</button>'+(group?'<button type="button" id="onlineRedPacket">发红包</button>':'')+'</div><div id="onlineExtra" class="composer-tools" style="margin-top:6px"></div><input id="onlineImageFile" type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden></div>'+
      '<div class="composer-actions"><button type="button" class="composer-tool composer-icon" id="onlineMore" aria-label="聊天工具" aria-controls="onlineComposerMenu" aria-expanded="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" aria-hidden="true"><path d="M12 4v16M4 12h16"/></svg></button>'+
      (group?'<button type="button" class="composer-tool composer-icon" id="onlineHumanOnly" aria-label="消息仅真人可读" title="消息仅真人可读" aria-pressed="false">'+bulbIcon+'</button>':'')+
      '<button type="submit" class="composer-send composer-icon" aria-label="发送" title="发送">'+sendIcon+'</button></div></form>',()=>{rememberChat(current.id);rooms();},header,group?'<span id="onlineGroupAvatar">'+groupAvatar(current)+'</span>':'');
    el('onlineMembers').onclick=()=>{rememberChat(current.id);members(current);};
    const bulb=el('onlineHumanOnly');
    if(bulb){
      const paintBulb=()=>{
        const enabled=view.humanOnly===true;
        bulb.setAttribute('aria-pressed',String(enabled));
        bulb.style.borderColor=enabled?'var(--gold)':'';
        bulb.style.boxShadow=enabled?'0 0 0 1px var(--gold), inset 0 0 7px color-mix(in srgb,var(--gold) 30%,transparent)':'';
        bulb.title=enabled?'已开启：发送的消息仅真人可读':'消息仅真人可读';
      };
      bulb.onclick=()=>{view.humanOnly=!view.humanOnly;paintBulb();};
      paintBulb();
    }
    paintOnlineQuote(current.id);
    const draft=el('onlineCompose').elements.body;
    draft.value=view.draft||'';
    const mentions=setupMentions(draft,group);
    if(view.loaded){
      drawMessages(view.top===null?'bottom':'keep');
      if(view.top!==null)el('onlineMessages').scrollTop=view.top;
    }else el('onlineMessages').textContent='正在加载聊天记录…';
    let refreshing=false, lastDetail=0, lastActivity=Date.now();
    function refreshDetail(){
      roomDetail(current.id).then(info=>{
        if(!active(serial))return;
        const changed=detail!==info&&JSON.stringify(detail)!==JSON.stringify(info);
        view.detail=info;detail=info;
        if(group&&info.name){
          el('onlineTitle').textContent=info.name;
          if(current.name!==info.name||current.avatar!==info.avatar){
            Object.assign(current,{name:info.name,avatar:info.avatar});
            el('onlineGroupAvatar').innerHTML=groupAvatar(current);
          }
        }
        if(changed&&view.loaded){
          const box=el('onlineMessages');
          drawMessages(box.scrollHeight-box.clientHeight-box.scrollTop<120?'bottom':'keep');
        }
        if(!cardSyncs.has(current.id)){
          const work=syncCards(serial,current,info).catch(error=>{if(active(serial))status(error.message);});
          cardSyncs.set(current.id,work);
          work.finally(()=>{if(cardSyncs.get(current.id)===work)cardSyncs.delete(current.id);});
        }
      }).catch(error=>{if(active(serial)&&error.status===404){views.delete(current.id);rooms();status(error.message);}});
    }
    async function refresh(){
      if(refreshing||!active(serial))return;
      refreshing=true;
      if(Date.now()-lastDetail>=17500){
        lastDetail=Date.now();
        refreshDetail();
      }
      try{
        const cursor=messages.at(-1)?.id||0;
        const feed=await roomFeed(current.id,cursor);
        if(!active(serial))return;
        if(el('onlineStatus')?.dataset.connectionError)status('');
        const rows=Array.isArray(feed)?feed:feed.rows;
        const nextTyping=Array.isArray(feed)?[]:feed.typing||[];
        const typingChanged=JSON.stringify(typingCharacters)!==JSON.stringify(nextTyping);
        typingCharacters=nextTyping;view.typing=nextTyping;
        const box=el('onlineMessages'),stick=box.scrollHeight-box.clientHeight-box.scrollTop<120;
        const firstLoad=!view.loaded;
        const added=cursor?rows.filter(message=>message.id>cursor):rows;
        if(!cursor&&!messages.length){
          older=rows.length>36;
          messages=rows.slice(-36);
        }else messages.push(...added);
        view.messages=messages;view.older=older;view.loaded=true;view.updated=Date.now();
        if(cursor||messages.length)void markRead(current,messages.at(-1)?.id||0);
        const hadPending=pendingMessage?.room===current.id;
        if(hadPending&&messages.some(x=>x.id===pendingMessage.saved))pendingMessage=null;
        if(added.length||nextTyping.length)lastActivity=Date.now();
        if(added.length||firstLoad){
          const append=cursor&&!firstLoad&&!hadPending&&el('onlineTyping')&&!added.some(row=>['rps-result','message-deleted'].includes(row.kind));
          drawMessages(stick?'bottom':'keep',append?added:null);
        }
        else if(typingChanged)drawTyping();
      }catch(error){
        if(active(serial)&&error.status===404){views.delete(current.id);rooms();status(error.message);}
        else throw error;
      }finally{refreshing=false;}
    }
    const menu=el('onlineComposerMenu'), more=el('onlineMore'), extra=el('onlineExtra'), file=el('onlineImageFile');
    function closeTools(){menu.hidden=true;more.setAttribute('aria-expanded','false');extra.replaceChildren();}
    let activityBusy=false;
    async function activity(path,data,button){
      if(activityBusy)return;
      activityBusy=true;button.disabled=true;
      try{
        await request(path,{room:current.id,...data});
        if(active(serial)){closeTools();await refresh();}
      }catch(error){if(active(serial))status(error.message);}
      finally{activityBusy=false;button.disabled=false;}
    }
    function toolOptions(options,onChoose){
      extra.replaceChildren();
      for(const [value,label] of options){
        const button=document.createElement('button');
        button.type='button';button.textContent=label;
        button.onclick=()=>onChoose(value,button);
        extra.append(button);
      }
    }
    more.onclick=()=>{
      if(!menu.hidden){closeTools();return;}
      const choices=el('onlineChoices');choices.hidden=true;choices.style.display='none';
      menu.hidden=false;more.setAttribute('aria-expanded','true');
    };
    if(el('onlineChatMemory'))el('onlineChatMemory').onclick=()=>roomMemory(current,()=>chatRoom(current));
    el('onlinePickImage').onclick=()=>file.click();
    file.onchange=async()=>{
      const selected=file.files[0];file.value='';
      if(!selected)return;
      const humanOnly=group&&view.humanOnly===true;
      status('正在处理图片…');
      try{
        const image=await prepareImage(selected);
        if(active(serial)){status('');await activity('activity',{kind:'image',image,humanOnly},el('onlinePickImage'));}
      }catch(error){if(active(serial))status(error.message);}
    };
    el('onlineEmoji').onclick=()=>toolOptions(['😊','😂','❤️','👍','✨','😭','🐉','🦉'].map(x=>[x,x]),emoji=>{
      const input=el('onlineCompose').elements.body;
      if(input.value.length+emoji.length<=input.maxLength)input.setRangeText(emoji,input.selectionStart,input.selectionEnd,'end');
      closeTools();input.focus();
    });
    if(el('onlineRedPacket'))el('onlineRedPacket').onclick=()=>{rememberChat(current.id);void composePacket(current);};
    el('onlineDice').onclick=event=>activity('activity',{kind:'dice'},event.currentTarget);
    el('onlineRps').onclick=()=>toolOptions(hands,(choice,button)=>activity('activity',{kind:'rps',choice},button));
    const feedNode=el('onlineMessages');
    let messagePress=null,pressOrigin=null,suppressMessageClick=false;
    const cancelMessagePress=()=>{clearTimeout(messagePress);messagePress=null;};
    function manageMessage(target){
      if(!group)return;
      const message=messages.find(item=>String(item.id)===target.dataset.onlineMessage);
      if(!message||['deleted','message-deleted'].includes(message.kind))return;
      rememberChat(current.id);
      const actions=[['quote','❝','引用回复','附在下一条消息里'],['forward','↗','转发','转发到其他在线群聊'],['select','☷','多选消息','导出 TXT 或截图'],...(detail?.owner===me.id?[['delete','×','删除消息','从当前群聊删除']]:[])];
      clearTimeout(pollTimer);resumeChat=null;imageObserver?.disconnect();generation++;
      dialog('<section id="ledgerOnline"><h2>消息操作</h2><div class="message-menu">'+actions.map(([key,icon,title,desc])=>'<button type="button" data-online-command="'+key+'"><span class="message-menu-icon" aria-hidden="true">'+icon+'</span><span><strong>'+title+'</strong><small>'+desc+'</small></span></button>').join('')+'</div><div class="row actions"><button type="button" id="onlineCancelMessage">取消</button></div>'+end+'</section>');
      el('onlineCancelMessage').onclick=()=>chatRoom(current);
      el('ledgerOnline').querySelectorAll('[data-online-command]').forEach(button=>button.onclick=async()=>{
        const command=button.dataset.onlineCommand;
        if(command==='quote'){
          view.quote={id:message.id,speaker:message.name,content:['image','human-image'].includes(message.kind)?'[图片]':message.body.slice(0,300)};
          chatRoom(current);el('onlineCompose').elements.body.focus();return;
        }
        if(command==='forward'){await forwardOnline(current,message);return;}
        if(command==='select'){onlineSelection=true;onlineSelected.add(message.id);chatRoom(current);return;}
        if(!confirm('删除这条消息？群内所有成员都将无法再查看，分句回复会整条删除。'))return;
        button.disabled=true;
        try{
          await request('delete-message',{room:current.id,id:message.id});
          const original=view.messages.find(item=>item.id===message.id);
          if(original)Object.assign(original,{kind:'deleted',body:''});
          chatRoom(current);
        }catch(error){status(error.message);button.disabled=false;}
      });
    }
    feedNode.addEventListener('pointerdown',event=>{
      const target=event.target.closest('[data-online-message]');
      if(!target||event.button!==0||!group||onlineSelection)return;
      cancelMessagePress();pressOrigin=[event.clientX,event.clientY];
      messagePress=setTimeout(()=>{messagePress=null;suppressMessageClick=true;manageMessage(target);},550);
    });
    feedNode.addEventListener('pointermove',event=>{
      if(messagePress&&Math.hypot(event.clientX-pressOrigin[0],event.clientY-pressOrigin[1])>10)cancelMessagePress();
    });
    for(const type of ['pointerup','pointercancel','pointerleave','scroll'])feedNode.addEventListener(type,cancelMessagePress);
    feedNode.addEventListener('contextmenu',event=>{
      const target=event.target.closest('[data-online-message]');
      if(target&&group){event.preventDefault();cancelMessagePress();if(!suppressMessageClick)manageMessage(target);}
    });
    feedNode.addEventListener('click',event=>{
      if(suppressMessageClick){suppressMessageClick=false;event.preventDefault();event.stopImmediatePropagation();}
    },true);
    paintOnlineSelection(current);
    feedNode.addEventListener('keydown',event=>{const node=event.target.closest('[data-online-message]');if(node&&onlineSelection&&['Enter',' '].includes(event.key)){event.preventDefault();toggleOnlineSelection(Number(node.dataset.onlineMessage),current);}});
    el('onlineMessages').addEventListener('click',event=>{
      if(onlineSelection){const node=event.target.closest('[data-online-message]');if(node){toggleOnlineSelection(Number(node.dataset.onlineMessage),current);event.preventDefault();event.stopImmediatePropagation();}return;}
      const forward=event.target.closest('[data-online-forward]');
      if(forward){rememberChat(current.id);void readForwardCard(current,Number(forward.dataset.onlineForward));return;}
      const packet=event.target.closest('[data-online-packet]');
      if(packet){rememberChat(current.id);openPacket(current,packet.dataset.onlinePacket);return;}
      const card=event.target.closest('[data-online-archive]');
      if(card){void readOnlineArchive(current,card.dataset.onlineArchive,serial,card);return;}
      const button=event.target.closest('[data-rps-id]');
      if(button)activity('accept-rps',{id:Number(button.dataset.rpsId),choice:button.dataset.rpsChoice},button);
    });
    form('onlineCompose',async(data,requestSerial)=>{
      const input=el('onlineCompose').elements.body;
      const body=data.body.trim();
      if(!body)return;
      lastActivity=Date.now();
      const humanOnly=group&&view.humanOnly===true;
      const mentionAll=group&&mentionsEveryone.test(body);
      const charId=humanOnly||mentionAll?null:mentions.target(body);
      const path=mentionAll?'send-mention-all':humanOnly?'send-human-only':'send';
      input.value='';
      const pending={room:current.id,body,humanOnly:humanOnly||mentionAll};
      pendingMessage=pending;
      drawMessages('bottom');
      let result;
      const quoteId=view.quote?.id;
      try{result=await request(path,{room:current.id,body,charId,deferReply:true,quoteId});view.quote=null;if(active(requestSerial))paintOnlineQuote(current.id);}
      catch(error){
        if(pendingMessage===pending)pendingMessage=null;
        if(active(requestSerial)){if(!input.value)input.value=body;drawMessages('bottom');}
        throw error;
      }
      pending.saved=result.message;
      if(!result.message||messages.some(message=>message.id===result.message)){
        if(pendingMessage===pending)pendingMessage=null;
        if(active(requestSerial))drawMessages('bottom');
      }
      if(result.reply){
        const character=active(requestSerial)?detail?.chars?.find(item=>item.id===charId):null;
        if(character){localTyping.set(result.reply,{...character,room:current.id});drawTyping();}
        request('reply',{room:current.id,message:result.reply}).then(reply=>{
          if(!active(requestSerial))return;
          if(reply.notice)status(reply.notice);
          return refresh();
        }).catch(error=>{if(active(requestSerial))status(error.message);}).finally(()=>{
          localTyping.delete(result.reply);
          if(active(requestSerial)){
            typingCharacters=typingCharacters.filter(item=>item.id!==charId);
            drawTyping();
          }
        });
      }
      if(!active(requestSerial))return;
      if(!input.value)mentions.clear();
      if(result.notice)status(result.notice);
      refresh().catch(error=>{if(active(requestSerial))status(error.message);});
    });
    resumeChat=()=>{
      if(!active(serial))return;
      lastActivity=Date.now();
      return refresh().catch(error=>{if(active(serial))status(error.message);});
    };
    if(!view.updated||Date.now()-view.updated>=1200)resumeChat();
    later(serial,refresh,()=>Date.now()-lastActivity<45000?1200:2500);
  }
  async function members(current){
    clearTimeout(pollTimer);
    resumeChat=null;
    imageObserver?.disconnect();
    const serial=++generation, group=current.kind==='group';
    const view=viewFor(current.id);
    dialog('<style>#dialog.story-fullscreen:has(>#ledgerOnline.group-settings-page){overflow:hidden}#dialog>#ledgerOnline.group-settings-page{height:100%;overflow:auto;overscroll-behavior:contain}</style>'+
      '<div class="group-settings-page" id="ledgerOnline"><header class="group-settings-header"><button id="onlineBack" type="button" aria-label="返回">‹</button><h2>'+(group?'群聊设置':'成员与邀请')+'</h2><span></span></header><div id="onlineMemberList" style="display:grid;gap:14px"></div>'+end+'</div>',true);
    el('onlineBack').onclick=()=>chatRoom(current);
    el('dialog').orbBack=el('onlineBack').onclick;
    function paint(info){
      if(!active(serial))return;
      const link=new URL('https://ophelia-shouren.github.io/Sleeping-Dragon-Ledger/');
      link.searchParams.set('onlineInvite',info.invite||'');
      const owner=group&&info.owner===me.id, prefs=displayFor(current.id);
      if(group&&info.name)Object.assign(current,{name:info.name,avatar:info.avatar});
      const person=(id,name,avatar,note,canEdit,frame)=>{
        const tag=canEdit?'button':'div';
        return '<'+tag+(canEdit?' type="button" data-online-manage="'+esc(id)+'"':'')+' class="group-settings-person">'+personAvatar(name,avatar,frame)+'<span title="'+esc(name+note)+'">'+esc(name+note)+'</span></'+tag+'>';
      };
      const setting=(key,label)=>'<label class="mode-toggle group-settings-switch"><input type="checkbox" role="switch" data-online-display="'+key+'" '+(prefs[key]!==false?'checked':'')+'><span aria-hidden="true"></span>'+label+'</label>';
      el('onlineMemberList').innerHTML=
        '<section class="group-settings-card"><div class="group-settings-profile">'+groupAvatar(current)+'<span><strong>'+esc(current.name)+'</strong><small>'+info.members.length+' 位成员'+(group?' · '+info.chars.length+' 位角色':'')+'</small></span>'+(owner?'<button id="onlineEditGroupLook" type="button">编辑</button>':'<span></span>')+'</div></section>'+
        '<section class="group-settings-card group-settings-block"><div class="group-settings-section-head"><h3>会话成员</h3></div><div class="group-settings-members">'+
        info.members.map(x=>person(x.id,x.name,x.avatar,x.id===me.id?(owner?' · 群主（你）':'（你）'):x.id===info.owner&&group?' · 群主':'',owner&&x.id!==me.id,x.frame)).join('')+
        info.chars.map(x=>person(x.id,x.name,x.avatar_image,'',owner||x.owner===me.id,x.frame)).join('')+
        (group?'<button type="button" class="group-settings-person" id="onlineAddChar"><b aria-hidden="true">＋</b><span>邀请角色</span></button>':'')+
        '</div><div id="onlineManage" style="margin-top:10px"></div></section>'+
        (owner?'<section class="group-settings-card group-settings-block"><h3>邀请成员</h3><label>六位邀请码<input id="onlineInviteCode" readonly value="'+esc(info.inviteCode||'')+'"></label><div class="row"><button id="onlineCopyCode" type="button">复制邀请码</button><button id="onlineRotateCode" type="button">重新生成邀请码</button></div></section>':
          !group&&info.invite?'<section class="group-settings-card group-settings-block"><h3>邀请成员</h3><label>邀请链接<input id="onlineLink" aria-label="邀请链接" readonly value="'+esc(link.href)+'"></label><button id="onlineCopy" type="button">复制邀请链接</button></section>':'')+
        (owner?'<section class="group-settings-card group-settings-block"><h3>群聊货币</h3><button type="button" id="onlineCurrencySettings">设置货币单位</button></section>':'')+
        (group?'<section class="group-settings-card group-settings-block"><h3>群公告</h3><button type="button" id="onlineAnnouncement">查看'+(owner?'／编辑':'')+'群公告</button></section>':'')+
        '<section class="group-settings-card group-settings-block"><h3>聊天显示</h3>'+setting('showTime','显示消息时间戳')+setting('showName','显示发言者名称')+setting('split','AI 回复分句显示')+'</section>'+
        (group?'<section class="group-settings-card group-settings-block"><h3>消息通知</h3><label class="mode-toggle group-settings-switch"><input type="checkbox" role="switch" id="onlineMute" '+(groupMuted(current.id)?'checked':'')+'><span aria-hidden="true"></span>消息免打扰</label></section>':'')+
        (group?'<section class="group-settings-card group-settings-block"><h3>群聊记忆</h3><p class="muted">仅用于当前群，独立于记忆同心圆。</p><button type="button" id="onlineOpenMemory" style="margin-top:8px">打开群记忆</button></section><section class="group-settings-card group-settings-block"><h3>服务器每日用量</h3><p id="onlineQuota" class="muted" role="status">正在读取用量…</p><div id="onlineD1Quota" class="muted"></div></section>':'');
      if(group){
        el('onlineAnnouncement').onclick=()=>announcement(current,owner);
        el('onlineMute').onchange=event=>{
          const input=event.currentTarget;
          try{
            groupMuted(current.id,input.checked);
            if(input.checked&&el('onlineNotice')?.dataset.room===current.id)el('onlineNotice').remove();
            if(input.checked&&queuedNotice?.room===current.id)queuedNotice=null;
          }catch{input.checked=!input.checked;status('免打扰设置未能保存。');}
        };
        el('onlineMemberList').insertAdjacentHTML('beforeend',
          '<div class="clear-chat-row"><button type="button" class="archive-danger" id="onlineQuitGroup">'+(owner?'解散群聊':'退出群聊')+'</button></div>');
        el('onlineQuitGroup').onclick=()=>confirmGroupExit(current,owner);
      }
      el('onlineMemberList').querySelectorAll('[data-online-display]').forEach(input=>input.onchange=()=>{
        try{
          const settings=JSON.parse(localStorage.getItem(displayKey)||'{}');
          settings[current.id]={...settings[current.id],[input.dataset.onlineDisplay]:input.checked};
          localStorage.setItem(displayKey,JSON.stringify(settings));
        }catch(error){input.checked=!input.checked;status('显示设置未能保存。');}
      });
      if(el('onlineRotateCode'))el('onlineRotateCode').onclick=async event=>{
        if(!confirm('重新生成邀请码？旧邀请码将立即失效。'))return;
        const button=event.currentTarget;
        button.disabled=true;
        try{
          const result=await request('rotate-invite-code',{room:current.id});
          view.detail={...info,inviteCode:result.inviteCode};
          if(active(serial)){
            info.inviteCode=result.inviteCode;
            el('onlineInviteCode').value=result.inviteCode;
            status('已生成新邀请码，旧邀请码已失效。');
          }
        }catch(error){if(active(serial))status(error.message);}
        finally{button.disabled=false;}
      };
      if(el('onlineCopyCode'))el('onlineCopyCode').onclick=async()=>{
        try{await navigator.clipboard.writeText(info.inviteCode);status('已复制邀请码。');}
        catch{el('onlineInviteCode').select();status('已选中邀请码，可以手动复制。');}
      };
      if(el('onlineCopy'))el('onlineCopy').onclick=async()=>{
        try{await navigator.clipboard.writeText(link.href);status('已复制邀请链接。');}
        catch{el('onlineLink').select();status('已选中邀请链接，可以手动复制。');}
      };
      if(el('onlineOpenMemory'))el('onlineOpenMemory').onclick=()=>roomMemory(current,()=>members(current));
      if(el('onlineAddChar'))el('onlineAddChar').onclick=()=>inviteCard(current);
      if(el('onlineCurrencySettings'))el('onlineCurrencySettings').onclick=()=>packetSettings(current,()=>members(current));
      if(el('onlineEditGroupLook'))el('onlineEditGroupLook').onclick=()=>editOnlineGroup(current);
      async function managed(path,data,button){
        button.disabled=true;
        try{
          await request(path,{room:current.id,...data});
          if(path==='remove-char'){
            const map=mapping();delete map[data.id];localStorage.setItem(mappingKey,JSON.stringify(map));
          }
          view.detail=null;
          if(active(serial))await members(current);
        }catch(e){if(active(serial))status(e.message);button.disabled=false;}
      }
      el('onlineMemberList').querySelectorAll('[data-online-manage]').forEach(button=>button.onclick=()=>{
        const id=button.dataset.onlineManage, char=info.chars.find(x=>x.id===id), user=info.members.find(x=>x.id===id);
        const panel=el('onlineManage');
        panel.innerHTML=char?
          (char.owner===me.id?'<button id="onlineEditLook" type="button">头像与头像框</button> <button id="onlineEditCharApi" type="button">更换角色 API</button> ' +(group?'<button id="onlineAlive" type="button">AI 活人感</button> ':'')+' <button id="onlinePersonalContext" type="button">个人记忆与私聊'+(char.personal_enabled?'（已开启）':'')+'</button><label>角色群昵称<input id="onlineCharName" value="'+esc(char.name)+'" maxlength="24" required></label><button id="onlineRename" type="button">保存群昵称</button> ':'')+
          (char.owner!==me.id&&char.can_configure_api?'<button id="onlineEditCharApi" type="button">临时更换角色 API</button> ':'')+
          '<button id="onlineRemoveMember" type="button">移除角色</button>':
          '<button id="onlineRemoveMember" type="button">移出 '+esc(user?.name)+'</button>';
        if(el('onlineEditLook'))el('onlineEditLook').onclick=()=>editCharLook(current,char);
        if(el('onlinePersonalContext'))el('onlinePersonalContext').onclick=()=>editPersonalContext(current,char);
        if(el('onlineAlive'))el('onlineAlive').onclick=()=>editOnlineAlive(current,char);
        if(el('onlineEditCharApi'))el('onlineEditCharApi').onclick=()=>editOnlineCharApi(current,char);
        if(el('onlineRename'))el('onlineRename').onclick=event=>{
          const input=el('onlineCharName');
          if(input.reportValidity())managed('rename-char',{id,name:input.value.trim()},event.currentTarget);
        };
        el('onlineRemoveMember').onclick=event=>{
          const prompt=char?'移除此角色？它将停止在群里回复。':'将 '+user.name+' 移出群聊？其邀请的角色也会退出，旧邀请码将失效。';
          if(confirm(prompt))managed(char?'remove-char':'kick-member',{id},event.currentTarget);
        };
        panel.scrollIntoView({block:'nearest'});
      });
    }
    let rendered=view.detail;
    if(rendered)paint(rendered);
    else el('onlineMemberList').textContent='正在加载群聊设置…';
    async function refreshQuota(){
      const quota=await request('quota?room='+current.id);
      if(!active(serial)||!el('onlineQuota'))return;
      view.quota=quota;
      paintQuota();
    }
    function paintQuota(){
      if(!view.quota||!el('onlineQuota'))return;
      const count=new Intl.NumberFormat('zh-CN').format(view.quota.messages);
      const date=new Date(view.quota.resetsAt).toLocaleString('zh-CN',{hour12:false});
      el('onlineQuota').textContent='今日在线消息 '+count+' 条 · '+date+' 重置';
      const node=el('onlineD1Quota'), d1=view.quota.d1;
      if(!node)return;
      if(d1?.status!=='ready'){
        node.textContent=d1?.status==='unavailable'?'暂时无法读取 Cloudflare D1 统计。':'Cloudflare D1 统计尚未配置完成。';
        return;
      }
      const format=new Intl.NumberFormat('zh-CN');
      const rows=(label,used,limit)=>{
        const line=document.createElement('div');
        line.textContent=label+'已用 '+format.format(used)+' 行 · 免费档预计剩余 '+format.format(Math.max(0,limit-used))+' 行';
        return line;
      };
      const note=document.createElement('small');
      note.textContent='D1 账户统计可能有延迟 · '+new Date(d1.checkedAt).toLocaleTimeString('zh-CN',{hour12:false})+' 查询';
      node.replaceChildren(rows('读取',d1.reads,d1.readLimit),rows('写入',d1.writes,d1.writeLimit),note);
    }
    function requestQuota(){
      refreshQuota().catch(error=>{if(active(serial)&&el('onlineQuota'))el('onlineQuota').textContent=error.message;});
    }
    if(group&&rendered){paintQuota();requestQuota();}
    try{
      const info=await roomDetail(current.id);
      if(!active(serial))return;
      view.detail=info;
      if(!rendered||(!el('onlineManage')?.children.length&&JSON.stringify(rendered)!==JSON.stringify(info))){
        paint(info);paintQuota();
      }
      if(group){
        if(!rendered)requestQuota();
        later(serial,refreshQuota,4500);
      }
    }catch(error){
      if(active(serial)){
        if(error.status===404){views.delete(current.id);rooms();}
        status(error.message);
      }
    }
  }
  function editOnlineGroup(current){
    let avatar=current.avatar||'';
    const serial=screen('编辑群聊','<section class="group-settings-card group-settings-block"><form id="onlineGroupLookForm"><div id="onlineGroupPreview"></div><label>群聊名称<input name="name" required maxlength="40" value="'+esc(current.name)+'"></label><label>群头像<input type="file" id="onlineGroupFile" accept="image/png,image/jpeg,image/webp,image/gif"></label><div class="row"><button type="button" id="onlineGroupAvatarClear">移除群头像</button><button type="submit" class="primary">保存</button></div></form></section>'+end,()=>members(current));
    const name=el('onlineGroupLookForm').elements.name, file=el('onlineGroupFile');
    const save=el('onlineGroupLookForm').querySelector('[type=submit]');
    const preview=()=>{if(active(serial))el('onlineGroupPreview').innerHTML=groupAvatar({name:name.value,avatar});};
    name.oninput=preview;
    file.onchange=async()=>{
      if(!file.files[0])return;
      save.disabled=true;
      try{avatar=await readLookFile(file.files[0]);preview();}
      catch(error){if(active(serial))status(error.message);}
      finally{save.disabled=false;}
    };
    el('onlineGroupAvatarClear').onclick=()=>{avatar='';file.value='';preview();};
    form('onlineGroupLookForm',async(data,requestSerial)=>{
      const title=fitText(data.name,40);
      if(!title)throw Error('请输入群聊名称。');
      const updated=await request('group-look',{room:current.id,name:title,avatar});
      const changes={name:updated.name,avatar:updated.avatar};
      Object.assign(current,changes);
      const view=viewFor(current.id);
      if(view.detail)Object.assign(view.detail,changes);
      if(knownRooms)knownRooms=knownRooms.map(item=>item.id===current.id?{...item,...changes}:item);
      if(active(requestSerial))await members(current);
    });
    preview();
  }
  function confirmGroupExit(current,owner){
    const action=owner?'解散群聊':'退出群聊';
    const consequence=owner?'解散后，所有成员都将失去访问权限，邀请链接和邀请码会失效。':
      '退出后，你邀请的 AI 角色也会一起移出群聊。';
    const back=()=>members(current);
    const serial=screen(action,'<section class="group-settings-card group-settings-block"><h3>'+esc(current.name)+'</h3><p>'+consequence+'</p><div class="row"><button type="button" id="onlineExitCancel">取消</button><button type="button" class="archive-danger" id="onlineExitNext">继续'+action.slice(0,2)+'</button></div></section>'+end,back);
    el('onlineExitCancel').onclick=back;
    el('onlineExitNext').onclick=async event=>{
      if(!confirm('最终确认：要'+action.slice(0,2)+'「'+current.name+'」吗？'))return;
      const button=event.currentTarget;
      button.disabled=true;
      el('onlineExitCancel').disabled=true;
      try{
        await request(owner?'dissolve-group':'leave-group',{room:current.id});
        views.delete(current.id);
        roomsAt=0;
        if(knownRooms)knownRooms=knownRooms.filter(item=>item.id!==current.id);
        if(active(serial)){rooms();status(owner?'群聊已解散。':'已退出群聊。');}
      }catch(error){
        if(active(serial)){status(error.message);button.disabled=false;el('onlineExitCancel').disabled=false;}
      }
    };
  }
  function editPersonalContext(current,char){
    const card=contact(mapping()[char.id]?.card);
    const enabled=Boolean(char.personal_enabled);
    const serial=screen('个人记忆与私聊','<section class="group-settings-card group-settings-block"><h3>'+esc(char.name)+'</h3>'+
      '<p>开启后，该角色回复本群时可参考它自己的同心圆，以及和你最近 10 条私聊。角色可能在群里提到这些内容。</p>'+
      '<p>群聊内容不会写入同心圆。关闭会清除这个在线角色已同步的个人资料。</p>'+
      (!card&&!enabled?'<p>请在最初邀请该角色、保存有原角色卡的设备上开启。</p>':'<button type="button" id="onlineTogglePersonalContext" class="primary">'+(enabled?'关闭读取':'开启读取')+'</button>')+'</section>'+end,()=>members(current));
    const button=el('onlineTogglePersonalContext');
    if(!button)return;
    button.onclick=async()=>{
      button.disabled=true;
      try{
        await request('char-personal-context',{room:current.id,id:char.id,enabled:!enabled,...(enabled?{}:personalContext(card))});
        viewFor(current.id).detail=null;
        if(active(serial))await members(current);
      }catch(error){if(active(serial)){status(error.message);button.disabled=false;}}
    };
  }
  function roleModelTools(){
    return '<button type="button" data-online-load-models>读取模型</button> '+
      '<select data-online-model-choices aria-label="选择已读取的模型" hidden></select>'+
      '<p class="muted" data-online-model-status role="status"></p>';
  }
  function bindRoleModelTools(node,profiles){
    const {profile,endpoint,key,model}=node.elements;
    const load=node.querySelector('[data-online-load-models]');
    const choices=node.querySelector('[data-online-model-choices]');
    const status=node.querySelector('[data-online-model-status]');
    let version=0;
    function reset(){
      version++;
      load.disabled=false;
      choices.hidden=true;
      choices.replaceChildren();
      status.textContent='';
    }
    function applyPreset(){
      const preset=profiles.find(item=>item.id===profile.value);
      if(preset){endpoint.value=preset.url;key.value=preset.key;model.value=preset.model||'';}
      reset();
    }
    profile.onchange=applyPreset;
    endpoint.oninput=key.oninput=reset;
    choices.onchange=()=>{if(choices.value)model.value=choices.value;};
    load.onclick=async()=>{
      const url=endpoint.value.trim(), secret=key.value.trim();
      if(!url||!secret){status.textContent='请先选择预设，或填写 API 地址和 Key。';return;}
      const token=++version;
      const current=()=>node.isConnected&&el('dialog').open&&token===version;
      load.disabled=true;
      status.textContent='正在读取模型…';
      try{
        const ids=await fetchModelIds({url,key:secret});
        if(!current())return;
        if(!ids.length)throw Error('接口未返回可选模型，可以手动填写模型 ID。');
        choices.replaceChildren(new Option('选择模型',''),...ids.map(id=>new Option(id,id)));
        choices.value=ids.includes(model.value)?model.value:'';
        choices.hidden=false;
        status.textContent='已读取 '+ids.length+' 个模型。选择后保存即可。';
      }catch(error){
        if(current())status.textContent=(error.message||'读取模型失败。').replaceAll(secret,'[已隐藏]');
      }finally{
        if(current())load.disabled=false;
      }
    };
    return applyPreset;
  }
  async function editOnlineAlive(current,char){
    const back=()=>members(current);
    const serial=screen('AI 活人感','<p class="muted">正在读取设置…</p>'+end,back);
    try{
      const config=await request('char-autopost?room='+current.id+'&id='+char.id);
      if(!active(serial))return;
      const formSerial=screen('AI 活人感','<section class="group-settings-card group-settings-block"><h3>'+esc(char.name)+'</h3><form id="onlineAliveForm">'+
        '<label class="mode-toggle group-settings-switch"><input type="checkbox" role="switch" name="enabled" '+(config.minutes?'checked':'')+'><span aria-hidden="true"></span>定时主动发言</label>'+
        '<label>发言间隔（分钟）<input type="number" name="minutes" min="1" max="1440" step="1" required value="'+(config.minutes||15)+'"></label>'+
        '<label><input type="checkbox" name="quietEnabled" '+(config.quiet?'checked':'')+'> 启用静默时间</label><div class="fields"><label>开始<input type="time" name="quietStart" required value="'+(config.quiet?.start||'23:00')+'"></label><label>结束<input type="time" name="quietEnd" required value="'+(config.quiet?.end||'08:00')+'"></label></div><p class="muted">静默时间按保存时的本机时区执行，支持跨午夜。</p>'+
        '<p class="muted">开启后，角色按设定间隔读取最近 10 条文字消息，并使用你为该角色配置的 API 主动发一条群消息。离线时也会运行。</p>'+
        '<button type="submit" class="primary">保存设置</button></form></section>'+end,back);
      form('onlineAliveForm',async data=>{
        await request('char-autopost',{room:current.id,id:char.id,minutes:data.enabled?Number(data.minutes):0,quiet:data.quietEnabled?{start:data.quietStart,end:data.quietEnd,offset:new Date().getTimezoneOffset()}:null});
        if(active(formSerial)){await members(current);status('AI 活人感设置已保存。');}
      });
    }catch(error){if(active(serial))status(error.message);}
  }
  async function editOnlineCharApi(current,char){
    const serial=screen('角色 API','<p class="muted">正在读取配置…</p>'+end,()=>members(current));
    try{
      const config=await request('char-api?room='+encodeURIComponent(current.id)+'&id='+encodeURIComponent(char.id));
      if(!active(serial))return;
      const profiles=state.profiles.filter(x=>x.url&&x.model&&x.key);
      const formSerial=screen('角色 API','<section class="group-settings-card group-settings-block"><h3>'+esc(char.name)+'</h3><form id="onlineCharApiForm">'+
        '<label>调用预设<select name="profile"><option value="">手动填写</option>'+profiles.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name||p.model)+'</option>').join('')+'</select></label>'+
        '<label>OpenAI 兼容 API 地址<input name="endpoint" type="url" required maxlength="400" value="'+esc(config.endpoint)+'"></label>'+
        '<label>模型名称<input name="model" required maxlength="120" value="'+esc(config.model)+'"></label>'+
        '<label>API Key<input name="key" type="password" autocomplete="off" maxlength="2000" placeholder="地址不变时，留空沿用当前 Key"></label>'+
        roleModelTools()+'<button type="submit" class="primary">保存角色 API</button></form></section>'+end,()=>members(current));
      bindRoleModelTools(el('onlineCharApiForm'),profiles);
      form('onlineCharApiForm',async data=>{
        await request('update-char-api',{room:current.id,id:char.id,...data});
        viewFor(current.id).detail=null;
        if(active(formSerial)){await members(current);status('角色 API 已保存。');}
      });
    }catch(error){if(active(serial))status(error.message);}
  }
  function editCharLook(current,char){
    const frame=storedFrame(char.frame);
    let avatar=char.avatar_image||'', frameSrc=frame.src;
    const serial=screen('角色头像与头像框','<div class="messages"><section class="group-settings-card group-settings-block"><div id="onlineLookPreview"></div><form id="onlineLookForm"><label>头像图片<input id="onlineAvatarFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif"></label><button type="button" id="onlineAvatarClear">移除头像</button><label>头像框图片<input id="onlineFrameFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif"></label><button type="button" id="onlineFrameClear">移除头像框图片</button><label><input type="checkbox" id="onlineFrameRing" '+(frame.ring?'checked':'')+'> 显示圆形边框</label><button type="submit" class="primary">保存</button></form></section></div>'+end,()=>members(current));
    function preview(){
      if(active(serial))el('onlineLookPreview').innerHTML=personAvatar(char.name,avatar,{...frame,src:frameSrc,ring:el('onlineFrameRing').checked});
    }
    const choose=async(event,set)=>{
      const file=event.target.files[0];
      if(!file)return;
      try{set(await readLookFile(file));preview();}
      catch(error){if(active(serial))status(error.message);}
    };
    el('onlineAvatarFile').onchange=e=>choose(e,value=>avatar=value);
    el('onlineFrameFile').onchange=e=>choose(e,value=>frameSrc=value);
    el('onlineAvatarClear').onclick=()=>{avatar='';el('onlineAvatarFile').value='';preview();};
    el('onlineFrameClear').onclick=()=>{frameSrc='';el('onlineFrameFile').value='';preview();};
    el('onlineFrameRing').onchange=preview;
    form('onlineLookForm',async(data,requestSerial)=>{
      await request('char-look',{room:current.id,id:char.id,avatar,frame:{...frame,src:frameSrc,ring:el('onlineFrameRing').checked}});
      viewFor(current.id).detail=null;
      if(active(requestSerial))await members(current);
    });
    preview();
  }
  async function roomMemory(current,back){
    clearTimeout(pollTimer);
    resumeChat=null;
    imageObserver?.disconnect();
    const serial=++generation;
    dialog('<div class="group-settings-page" id="ledgerOnline"><header class="group-settings-header"><button id="onlineBack" type="button" aria-label="返回">‹</button><h2>群聊记忆</h2><span></span></header><div id="onlineMemoryWindow" style="display:grid;gap:14px"></div>'+end+'</div>',true);
    el('onlineBack').onclick=back;
    el('dialog').orbBack=el('onlineBack').onclick;
    try{
      const info=viewFor(current.id).detail||await roomDetail(current.id);
      if(!active(serial))return;
      const owner=info.owner===me.id;
      const profiles=owner?state.profiles.filter(p=>p.url&&p.model&&p.key):[];
      el('onlineMemoryWindow').innerHTML=
        '<section class="group-settings-card group-settings-block"><h3>记忆卡片</h3><p id="onlineMemoryProgress" class="muted" role="status">正在读取群记忆…</p><div id="onlineMemoryCards" style="display:grid;gap:8px"></div>'+(owner?'<button id="onlineMergeMemory" type="button" disabled>精简所选记忆</button>':'')+'</section>'+
        '<section class="group-settings-card group-settings-block"><h3>总结 API</h3><p id="onlineMemoryApiStatus" class="muted"></p><p class="muted">累计每 100 条真人文字消息或 AI 回复总结一次。模型请求由群主的 API 账户承担，角色回复会读取近期群记忆卡片与最近 10 条文字聊天。</p>'+
        (owner?'<form id="onlineMemoryApi"><label>群主的 API 预设<select name="profile" required><option value="">请选择</option>'+profiles.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name||p.model)+'</option>').join('')+'</select></label><button type="submit" class="primary">保存总结 API</button></form>':'')+'</section>';
      let previousCards, merging=false;
      const cardList=el('onlineMemoryCards'), merge=el('onlineMergeMemory');
      const selected=()=>[...cardList.querySelectorAll('input:checked')].map(input=>input.value);
      const syncMerge=()=>{if(merge)merge.disabled=merging||selected().length<2;};
      cardList.onchange=syncMerge;
      if(merge)merge.onclick=async()=>{
        const ids=selected();
        if(ids.length<2||merging||!confirm('将所选 '+ids.length+' 张记忆卡精简为一张？'))return;
        merging=true;merge.textContent='精简中…';syncMerge();
        try{
          await request('room-memory-merge',{room:current.id,ids});
          if(active(serial)){await refresh();status('所选记忆已精简。');}
        }catch(error){if(active(serial))status(error.message);}
        finally{merging=false;merge.textContent='精简所选记忆';syncMerge();}
      };
      async function refresh(){
        const memory=await request('room-memory?room='+current.id);
        if(!active(serial))return;
        const cards=memory.cards||(memory.summary?[{id:'legacy',title:'原有群聊总结',body:memory.summary,created:memory.updated}]:[]);
        const signature=JSON.stringify(cards);
        if(signature!==previousCards){
          const checked=new Set(selected());
          const expanded=new Set([...cardList.querySelectorAll('details[open]')].map(node=>node.dataset.memoryId));
          cardList.innerHTML=cards.slice().reverse().map(card=>{
            const date=card.created?new Date(card.created.includes('T')?card.created:card.created.replace(' ','T')+'Z').toLocaleString('zh-CN',{hour12:false}):'';
            return '<div class="group-settings-card">'+(owner?'<label><input type="checkbox" class="bulk-check" value="'+esc(card.id)+'" '+(checked.has(card.id)?'checked':'')+'> 选择记忆卡</label>':'')+
              '<details data-memory-id="'+esc(card.id)+'" '+(expanded.has(card.id)?'open':'')+'><summary>'+esc(card.title)+(date?' · '+esc(date):'')+'</summary><p style="white-space:pre-wrap;overflow-wrap:anywhere">'+esc(card.body)+'</p></details></div>';
          }).join('')||'<p class="muted">累计满 100 条且群主配置 API 后生成。</p>';
          previousCards=signature;
          syncMerge();
        }
        el('onlineMemoryProgress').textContent='待总结 '+memory.pending+' 条 · 已收纳 '+cards.length+' 张记忆卡';
        el('onlineMemoryApiStatus').textContent=memory.error||(!memory.configured?'群主尚未配置总结 API。':memory.model?'当前模型：'+memory.model:'群主已配置总结 API。');
      }
      if(owner)form('onlineMemoryApi',async(data,requestSerial)=>{
        const profile=profiles.find(p=>p.id===data.profile);
        if(!profile)throw Error('请先在「API 连接」保存你自己的文本 API 预设。');
        await request('room-memory-api',{room:current.id,endpoint:profile.url,model:profile.model,key:profile.key});
        if(active(requestSerial)){status('已保存总结 API。');await refresh();}
      });
      await refresh();
      later(serial,refresh,4500);
    }catch(error){if(active(serial))status(error.message);}
  }
  function inviteCard(current){
    const profiles=state.profiles.filter(p=>p.url&&p.key);
    screen('邀请已有角色','<p class="muted">受邀角色会读取你已启用且适用于它的世界书。群成员 @ 角色时，近期群聊和相关人设会发给你选用的 API，费用由你的 API 账户承担。</p><form id="onlineCard"><label>已有角色卡<select name="card" required><option value="">请选择角色</option>'+state.contacts.map(c=>'<option value="'+esc(c.id)+'">'+esc(displayName(c))+'</option>').join('')+'</select></label><label>调用预设<select name="profile"><option value="">手动填写</option>'+profiles.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name||p.model||p.url)+'</option>').join('')+'</select></label>'+
      '<label>OpenAI 兼容 API 地址<input name="endpoint" type="url" required maxlength="400"></label><label>API Key<input name="key" type="password" autocomplete="off" required maxlength="2000"></label><label>模型名称<input name="model" required maxlength="120"></label>'+
      roleModelTools()+'<button type="submit" class="primary">邀请角色</button></form>'+end,()=>members(current));
    const node=el('onlineCard');
    const applyPreset=bindRoleModelTools(node,profiles);
    node.elements.card.onchange=()=>{
      const card=contact(node.elements.card.value);
      const preferred=card&&profileFor(card);
      if(preferred&&profiles.some(p=>p.id===preferred.id)){
        node.elements.profile.value=preferred.id;
        applyPreset();
      }
    };
    form('onlineCard',async(data,serial)=>{
      const card=contact(data.card);
      if(!card)throw Error('请选择已有角色。');
      const context=cardContext(card);
      const {id}=await request('chars',{room:current.id,name:displayName(card).replace(/[\s@＠]+/gu,'').slice(0,24),avatar:'✦',...context,endpoint:data.endpoint,model:data.model,key:data.key});
      const map=mapping();map[id]={card:card.id,signature:await contextSignature(context)};
      localStorage.setItem(mappingKey,JSON.stringify(map));
      viewFor(current.id).detail=null;
      if(active(serial))members(current);
    });
  }
  return {directory,open,inviteFromUrl,shareArchive,syncVision,forwardExternal,kindroid:data=>request('kindroid-send',data)};
})();



