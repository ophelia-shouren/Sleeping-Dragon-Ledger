const ledgerOnline = (() => {
  const base='https://sleeping-dragon-ledger.yearnwingwings.workers.dev/ledger-api/';
  const key='sleeping-dragon-online-identity';
  const displayKey='sleeping-dragon-online-display';
  const pictures=new Map();
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
      localStorage.setItem(key,value);
    }
    return value;
  }
  async function request(path,data){
    const headers={Authorization:'Bearer '+identity()};
    if(data)headers['Content-Type']='application/json';
    let response;
    try{response=await fetch(base+path,{method:data?'POST':'GET',headers,body:data?JSON.stringify(data):undefined});}
    catch{throw Error('在线聊天服务连接失败，请稍后再试。');}
    const result=await response.json().catch(()=>null);
    if(!response.ok||!result)throw Error(result?.error||'在线聊天服务暂时不可用。');
    return result;
  }
  function status(message){
    const node=el('onlineStatus');
    if(scope()&&node)node.textContent=message;
  }
  function screen(title,body,back,headerAction=''){
    clearTimeout(pollTimer);
    const serial=++generation;
    dialog('<section class="group-room" id="ledgerOnline"><div class="chat-top"><button id="onlineBack" type="button" aria-label="返回">‹</button><div class="chat-name"><h2>'+esc(title)+'</h2></div>'+headerAction+'</div>'+body+'</section>',true);
    el('onlineBack').onclick=back||(()=>el('dialog').close());
    return serial;
  }
  const personAvatar=(name,src)=>avatarMarkup({name,avatar:src||'',frame:{src:'',ring:false}});
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
          canvas.getContext('2d').drawImage(image,(image.naturalWidth-size)/2,(image.naturalHeight-size)/2,size,size,0,0,96,96);
          resolve(canvas.toDataURL('image/jpeg',0.72));
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
  async function activate(){
    const serial=screen('在线聊天','<p class="muted">正在连接…</p>'+end);
    try{
      const avatar=await avatarThumbnail();
      if(!active(serial))return;
      me=await request('profile',{name:(appearance('user').name||'你').slice(0,30),persona:userPersona(),avatar});
      if(!active(serial))return;
      const invite=inviteFromUrl();
      if(invite)join(invite);else rooms();
    }catch(error){if(active(serial))status(error.message);}
  }
  function open(){
    if(localStorage.getItem(key))return activate();
    screen('在线聊天','<p>你将使用当前 User 人设卡参与聊天。昵称和头像会显示给会话成员，角色回复时可参考近期发言者的人设。在线身份保存在此浏览器或设备。</p><div class="row"><button type="button" class="primary" id="onlineStart">使用当前人设进入</button></div>'+end);
    el('onlineStart').onclick=activate;
  }
  function later(serial, refresh, delay){
    if(!active(serial))return;
    pollTimer=setTimeout(async()=>{
      if(!active(serial))return;
      try{if(!document.hidden)await refresh();}
      catch(error){if(active(serial))status(error.message);}
      finally{later(serial,refresh,delay);}
    },delay);
  }
  function rooms(){
    room=null;
    const serial=screen('在线聊天','<div class="row"><button class="primary" id="onlineNew">新建会话</button><button id="onlineJoin">加入会话</button></div>'+end+'<div class="messages" id="onlineList"></div>');
    el('onlineNew').onclick=create;
    el('onlineJoin').onclick=()=>join('');
    let previous;
    async function refresh(){
      const list=await request('rooms');
      if(!active(serial))return;
      const signature=JSON.stringify(list);
      if(signature===previous)return;
      previous=signature;
      el('onlineList').innerHTML=list.map(x=>'<button type="button" class="directory-item" data-online-room="'+esc(x.id)+'">'+personAvatar(x.kind==='group'?'群':x.name)+'<span><strong>'+esc(x.name)+'</strong><small>'+esc(x.preview||(x.kind==='group'?'群聊':'私聊'))+'</small></span><b>›</b></button>').join('')||'<div class="empty">还没有在线会话</div>';
      el('onlineList').querySelectorAll('button').forEach(b=>b.onclick=()=>chatRoom(list.find(x=>x.id===b.dataset.onlineRoom)));
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
      if(active(serial))chatRoom({id,name:data.kind==='dm'?'好友私聊':data.name,kind:data.kind});
    });
  }
  function join(code){
    screen('加入会话','<form id="onlineJoinForm"><label>邀请链接或邀请码<input name="invite" required value="'+esc(code)+'"></label><button type="submit" class="primary">加入</button></form>'+end,rooms);
    form('onlineJoinForm',async(data,serial)=>{
      let invite=data.invite.trim();
      try{invite=new URL(invite).searchParams.get('onlineInvite')||'';}catch{}
      const {id}=await request('join',{invite});
      if(!active(serial))return;
      const url=new URL(location.href);url.searchParams.delete('onlineInvite');history.replaceState(null,'',url);
      const list=await request('rooms');
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
  function imageInOnlineMessage(id){
    return '<img data-online-image="'+id+'" alt="聊天图片" style="display:block;max-width:min(68vw,400px);max-height:55vh;object-fit:contain;border-radius:6px">';
  }
  function loadPictures(box){
    const serial=generation, currentRoom=room.id;
    for(const image of box.querySelectorAll('[data-online-image]')){
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
  }
  function drawMessages(mode){
    const box=el('onlineMessages'), oldHeight=box.scrollHeight, oldTop=box.scrollTop;
    const people=new Map((detail?.members||[]).map(x=>[x.id,x]));
    const display=displayFor(room.id);
    const resolved=new Set(messages.filter(m=>m.challenge).map(m=>Number(m.challenge)));
    box.innerHTML=(older?'<div class="chat-history-page"><button type="button" id="onlineOlder">查看更早的消息</button></div>':'')+
      (messages.map(m=>{
        const mine=!m.char_id&&m.sender===me.id;
        const role=mine?'user':'assistant';
        const avatar='<button type="button" class="avatar-button" data-online-avatar="'+esc(m.id)+'" style="touch-action:pan-y;user-select:none;-webkit-touch-callout:none" aria-label="长按提及 '+esc(m.name)+'">'+personAvatar(m.name,m.char_id?'':people.get(m.sender)?.avatar)+'</button>';
        const name=mine||display.showName===false?'':'<small>'+esc(m.name)+(m.char_id?' · AI':'')+'</small>';
        const date=new Date(m.created.replace(' ','T')+'Z');
        const time=display.showTime===false||Number.isNaN(date.getTime())?'':'<small class="muted">'+date.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false})+'</small>';
        const layout=chatMessageLayout(avatar,name,time);
        const parts=m.char_id?chatBubbleParts({role:'assistant',content:m.body},{split:display.split!==false,limit:30}):[m.body];
        return parts.map((part,index)=>{
          const first=index===0;
          let content='<p style="white-space:pre-wrap;overflow-wrap:anywhere">'+esc(part)+'</p>';
          if(m.kind==='image')content=imageInOnlineMessage(m.id);
          if(m.kind==='rps'){
            const closed=m.resolved||resolved.has(m.id);
            content+=closed?'<small class="muted">已结束</small>':mine?'<small class="muted">等待另一位真人出拳</small>':
              '<div class="row">'+hands.map(([value,label])=>'<button type="button" data-rps-id="'+m.id+'" data-rps-choice="'+value+'">'+label+'</button>').join('')+'</div>';
          }
          return '<div class="message-row '+role+'">'+(first?layout.before:'')+'<article class="bubble '+role+'">'+(first?layout.name:'')+content+(first?layout.time:'')+'</article></div>';
        }).join('');
      }).join('')||'<div class="empty">还没有消息，打声招呼吧。</div>');
    box.scrollTop=mode==='bottom'?box.scrollHeight:mode==='prepend'?oldTop+box.scrollHeight-oldHeight:oldTop;
    loadPictures(box);
    if(el('onlineOlder'))el('onlineOlder').onclick=loadOlder;
  }
  async function loadOlder(){
    const serial=generation, first=messages[0]?.id;
    try{
      const rows=await request('messages?room='+room.id+'&before='+first);
      if(!active(serial)||messages[0]?.id!==first)return;
      messages=[...rows,...messages];older=rows.length===60;drawMessages('prepend');
    }catch(e){if(active(serial))status(e.message);}
  }
  function cardContext(card){
    return {
      persona:[['姓名',card.name],['性别',card.gender],['性格',card.personality],['人设',card.description],['与用户的关系',card.relationship]].filter(x=>x[1]).map(([k,v])=>k+'：'+v).concat(charRelationContext(card)).join('\n'),
      worldFront:worldContext('front',card.id),worldEnd:worldContext('end',card.id)
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
      const choices=(detail?.chars||[]).filter(c=>c.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
      el('onlineComposerMenu').hidden=true;
      el('onlineMore').setAttribute('aria-expanded','false');
      picker.replaceChildren();
      if(!choices.length){
        const empty=document.createElement('span');
        empty.className='muted';empty.textContent=query?'没有匹配的角色。':'还没有可提及的角色。';
        picker.append(empty);
      }
      for(const char of choices){
        const button=document.createElement('button');
        button.type='button';button.textContent='@'+char.name;
        button.onclick=()=>insert({name:char.name,charId:char.id},range);
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
    function mentionAvatar(avatar){
      const message=messages.find(m=>String(m.id)===avatar.dataset.onlineAvatar);
      if(!message)return;
      if(message.char_id&&!detail?.chars.some(x=>x.id===message.char_id)){status('此角色已离开群聊。');return;}
      insert({name:message.name,charId:message.char_id});
    }
    feed.addEventListener('pointerdown',event=>{
      const avatar=event.target.closest('[data-online-avatar]');
      if(!avatar||event.button!==0)return;
      cancelPress();
      position=[event.clientX,event.clientY];
      press=setTimeout(()=>{press=null;if(avatar.isConnected)mentionAvatar(avatar);},500);
    });
    feed.addEventListener('pointermove',event=>{
      if(press && Math.hypot(event.clientX-position[0],event.clientY-position[1])>10)cancelPress();
    });
    for(const event of ['pointerup','pointercancel','pointerleave','scroll'])feed.addEventListener(event,cancelPress);
    feed.addEventListener('contextmenu',event=>{
      const avatar=event.target.closest('[data-online-avatar]');
      if(avatar)event.preventDefault();
    });
    feed.addEventListener('click',event=>{
      const avatar=event.target.closest('[data-online-avatar]');
      if(avatar&&event.detail===0)mentionAvatar(avatar);
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
  function chatRoom(current){
    if(!current)return rooms();
    room=current;messages=[];older=false;detail=null;
    const group=current.kind==='group';
    const sendIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2l9 15H3L12 2Zm0 20L3 7h18l-9 15Z"/></svg>';
    const header='<button type="button" class="star-button" id="onlineMembers" style="margin-inline-start:auto" aria-label="'+(group?'群聊设置':'成员与邀请')+'">★</button>';
    const serial=screen(current.name,end+'<div id="onlineMessages" class="messages"></div><div class="composer-tools" id="onlineChoices" aria-label="可提及的角色" style="display:none;max-height:26vh;overflow:auto" hidden></div>'+
      '<div class="composer-menu" id="onlineComposerMenu" hidden><div class="composer-tools">'+(group?'<button type="button" id="onlineMention" aria-label="提及角色" aria-controls="onlineChoices" aria-expanded="false">@ 角色</button><button type="button" id="onlineChatMemory">群记忆</button>':'')+
      '<button type="button" id="onlinePickImage">图片／表情包</button><button type="button" id="onlineEmoji">表情</button><button type="button" id="onlineDice">🎲 骰子</button><button type="button" id="onlineRps">✊ 猜拳</button></div><div id="onlineExtra" class="composer-tools" style="margin-top:6px"></div><input id="onlineImageFile" type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden></div>'+
      '<form id="onlineCompose" class="row"><button type="button" class="composer-tool composer-icon" id="onlineMore" aria-label="聊天工具" aria-controls="onlineComposerMenu" aria-expanded="false">＋</button>'+
      '<textarea name="body" aria-label="聊天消息" required maxlength="4000" placeholder="写一条消息…"></textarea><button type="submit" class="composer-send composer-icon" aria-label="发送" title="发送">'+sendIcon+'</button></form>',rooms,header);
    el('onlineMembers').onclick=()=>members(current);
    const mentions=setupMentions(el('onlineCompose').elements.body,group);
    let refreshing=false, ticks=0;
    async function refresh(){
      if(refreshing)return;
      refreshing=true;
      try{
        const cursor=messages.at(-1)?.id||0;
        const refreshDetail=ticks++%4===0;
        const [rows,info]=await Promise.all([
          request('messages?room='+current.id+(cursor?'&after='+cursor:'')),
          refreshDetail?request('detail?room='+current.id):null
        ]);
        if(!active(serial))return;
        if(info)detail=info;
        const box=el('onlineMessages'), stick=box.scrollHeight-box.clientHeight-box.scrollTop<120;
        if(!cursor)older=rows.length===60;
        messages.push(...rows.filter(x=>x.id>(messages.at(-1)?.id||0)));
        if(rows.length||info||!cursor)drawMessages(stick?'bottom':'keep');
        if(info)await syncCards(serial,current,info);
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
      status('正在处理图片…');
      try{
        const image=await prepareImage(selected);
        if(active(serial)){status('');await activity('activity',{kind:'image',image},el('onlinePickImage'));}
      }catch(error){if(active(serial))status(error.message);}
    };
    el('onlineEmoji').onclick=()=>toolOptions(['😊','😂','❤️','👍','✨','😭','🐉','🦉'].map(x=>[x,x]),emoji=>{
      const input=el('onlineCompose').elements.body;
      if(input.value.length+emoji.length<=input.maxLength)input.setRangeText(emoji,input.selectionStart,input.selectionEnd,'end');
      closeTools();input.focus();
    });
    el('onlineDice').onclick=event=>activity('activity',{kind:'dice'},event.currentTarget);
    el('onlineRps').onclick=()=>toolOptions(hands,(choice,button)=>activity('activity',{kind:'rps',choice},button));
    el('onlineMessages').addEventListener('click',event=>{
      const button=event.target.closest('[data-rps-id]');
      if(button)activity('accept-rps',{id:Number(button.dataset.rpsId),choice:button.dataset.rpsChoice},button);
    });
    form('onlineCompose',async(data,requestSerial)=>{
      const input=el('onlineCompose').elements.body;
      const body=data.body.trim();
      if(!body)return;
      const charId=mentions.target(body);
      input.value='';
      let result;
      try{result=await request('send',{room:current.id,body,charId});}
      catch(error){if(active(requestSerial)&&!input.value)input.value=body;throw error;}
      if(!active(requestSerial))return;
      if(!input.value)mentions.clear();
      if(result.notice)status(result.notice);
      await refresh();
    });
    refresh().catch(e=>{if(active(serial))status(e.message);});
    later(serial,refresh,4500);
  }
  async function members(current){
    clearTimeout(pollTimer);
    const serial=++generation, group=current.kind==='group';
    dialog('<div class="group-settings-page" id="ledgerOnline"><header class="group-settings-header"><button id="onlineBack" type="button" aria-label="返回">‹</button><h2>'+(group?'群聊设置':'成员与邀请')+'</h2><span></span></header><div id="onlineMemberList" style="display:grid;gap:14px"></div>'+end+'</div>',true);
    el('onlineBack').onclick=()=>chatRoom(current);
    try{
      const info=await request('detail?room='+current.id);
      if(!active(serial))return;
      const link=new URL('https://ophelia-shouren.github.io/Sleeping-Dragon-Ledger/');
      link.searchParams.set('onlineInvite',info.invite||'');
      const owner=group&&info.owner===me.id, prefs=displayFor(current.id);
      const person=(id,name,avatar,note,canEdit)=>{
        const tag=canEdit?'button':'div';
        return '<'+tag+(canEdit?' type="button" data-online-manage="'+esc(id)+'"':'')+' class="group-settings-person">'+personAvatar(name,avatar)+'<span title="'+esc(name+note)+'">'+esc(name+note)+'</span></'+tag+'>';
      };
      const setting=(key,label)=>'<label class="mode-toggle group-settings-switch"><input type="checkbox" role="switch" data-online-display="'+key+'" '+(prefs[key]!==false?'checked':'')+'><span aria-hidden="true"></span>'+label+'</label>';
      el('onlineMemberList').innerHTML=
        '<section class="group-settings-card"><div class="group-settings-profile">'+groupAvatar({name:current.name})+'<span><strong>'+esc(current.name)+'</strong><small>'+info.members.length+' 位成员'+(group?' · '+info.chars.length+' 位角色':'')+'</small></span><span></span></div></section>'+
        '<section class="group-settings-card group-settings-block"><div class="group-settings-section-head"><h3>会话成员</h3></div><div class="group-settings-members">'+
        info.members.map(x=>person(x.id,x.name,x.avatar,x.id===me.id?(owner?' · 群主（你）':'（你）'):x.id===info.owner&&group?' · 群主':'',owner&&x.id!==me.id)).join('')+
        info.chars.map(x=>person(x.id,x.name,'',' · AI',owner||x.owner===me.id)).join('')+
        (group?'<button type="button" class="group-settings-person" id="onlineAddChar"><b aria-hidden="true">＋</b><span>邀请角色</span></button>':'')+
        '</div><div id="onlineManage" style="margin-top:10px"></div></section>'+
        (info.invite?'<section class="group-settings-card group-settings-block"><h3>邀请链接</h3><label><input id="onlineLink" aria-label="邀请链接" readonly value="'+esc(link.href)+'"></label><button id="onlineCopy" type="button">复制邀请链接</button></section>':'')+
        '<section class="group-settings-card group-settings-block"><h3>聊天显示</h3>'+setting('showTime','显示消息时间戳')+setting('showName','显示发言者名称')+setting('split','AI 回复分句显示')+'</section>'+
        (group?'<section class="group-settings-card group-settings-block"><h3>群聊记忆</h3><p class="muted">仅用于当前群，独立于记忆同心圆。</p><button type="button" id="onlineOpenMemory" style="margin-top:8px">打开群记忆</button></section><section class="group-settings-card group-settings-block"><h3>服务器每日用量</h3><p id="onlineQuota" class="muted" role="status">正在读取用量…</p><p class="muted">当前可读取在线消息数。Cloudflare 账户剩余额度需要账户级统计授权。</p></section>':'');
      el('onlineMemberList').querySelectorAll('[data-online-display]').forEach(input=>input.onchange=()=>{
        try{
          const settings=JSON.parse(localStorage.getItem(displayKey)||'{}');
          settings[current.id]={...settings[current.id],[input.dataset.onlineDisplay]:input.checked};
          localStorage.setItem(displayKey,JSON.stringify(settings));
        }catch(error){input.checked=!input.checked;status('显示设置未能保存。');}
      });
      if(group){
        async function refreshQuota(){
          const quota=await request('quota?room='+current.id);
          if(!active(serial))return;
          const count=new Intl.NumberFormat('zh-CN').format(quota.messages);
          const date=new Date(quota.resetsAt).toLocaleString('zh-CN',{hour12:false});
          el('onlineQuota').textContent='今日在线消息 '+count+' 条 · '+date+' 重置';
        }
        refreshQuota().catch(e=>{if(active(serial))el('onlineQuota').textContent=e.message;});
        later(serial,refreshQuota,4500);
      }
      if(el('onlineCopy'))el('onlineCopy').onclick=async()=>{
        try{await navigator.clipboard.writeText(link.href);status('已复制邀请链接。');}
        catch{el('onlineLink').select();status('已选中邀请链接，可以手动复制。');}
      };
      if(el('onlineOpenMemory'))el('onlineOpenMemory').onclick=()=>roomMemory(current,()=>members(current));
      if(el('onlineAddChar'))el('onlineAddChar').onclick=()=>inviteCard(current);
      async function managed(path,data,button){
        button.disabled=true;
        try{
          await request(path,{room:current.id,...data});
          if(path==='remove-char'){
            const map=mapping();delete map[data.id];localStorage.setItem(mappingKey,JSON.stringify(map));
          }
          if(active(serial))await members(current);
        }catch(e){if(active(serial))status(e.message);button.disabled=false;}
      }
      el('onlineMemberList').querySelectorAll('[data-online-manage]').forEach(button=>button.onclick=()=>{
        const id=button.dataset.onlineManage, char=info.chars.find(x=>x.id===id), user=info.members.find(x=>x.id===id);
        const panel=el('onlineManage');
        panel.innerHTML=char?
          (char.owner===me.id?'<label>角色群昵称<input id="onlineCharName" value="'+esc(char.name)+'" maxlength="24" required></label><button id="onlineRename" type="button">保存群昵称</button> ':'')+
          '<button id="onlineRemoveMember" type="button">移除角色</button>':
          '<button id="onlineRemoveMember" type="button">移出 '+esc(user?.name)+'</button>';
        if(el('onlineRename'))el('onlineRename').onclick=event=>{
          const input=el('onlineCharName');
          if(input.reportValidity())managed('rename-char',{id,name:input.value.trim()},event.currentTarget);
        };
        el('onlineRemoveMember').onclick=event=>{
          const prompt=char?'移除此角色？它将停止在群里回复。':'将 '+user.name+' 移出群聊？其邀请的角色也会退出，旧邀请链接将失效。';
          if(confirm(prompt))managed(char?'remove-char':'kick-member',{id},event.currentTarget);
        };
        panel.scrollIntoView({block:'nearest'});
      });
    }catch(e){if(active(serial))status(e.message);}
  }
  async function roomMemory(current,back){
    clearTimeout(pollTimer);
    const serial=++generation;
    dialog('<div class="group-settings-page" id="ledgerOnline"><header class="group-settings-header"><button id="onlineBack" type="button" aria-label="返回">‹</button><h2>群聊记忆</h2><span></span></header><div id="onlineMemoryWindow" style="display:grid;gap:14px"></div>'+end+'</div>',true);
    el('onlineBack').onclick=back;
    try{
      const info=await request('detail?room='+current.id);
      if(!active(serial))return;
      const owner=info.owner===me.id;
      const profiles=owner?state.profiles.filter(p=>p.url&&p.model&&p.key):[];
      el('onlineMemoryWindow').innerHTML=
        '<section class="group-settings-card group-settings-block"><h3>当前总结</h3><p id="onlineMemoryProgress" class="muted" role="status">正在读取群记忆…</p><p id="onlineMemoryText" style="white-space:pre-wrap;overflow-wrap:anywhere"></p></section>'+
        '<section class="group-settings-card group-settings-block"><h3>总结 API</h3><p id="onlineMemoryApiStatus" class="muted"></p><p class="muted">累计每 100 条真人文字消息或 AI 回复总结一次。模型请求由群主的 API 账户承担，角色回复会读取当前总结与最近 10 条文字聊天。</p>'+
        (owner?'<form id="onlineMemoryApi"><label>群主的 API 预设<select name="profile" required><option value="">请选择</option>'+profiles.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name||p.model)+'</option>').join('')+'</select></label><button type="submit" class="primary">保存总结 API</button></form>':'')+'</section>';
      let previous;
      async function refresh(){
        const memory=await request('room-memory?room='+current.id);
        if(!active(serial))return;
        const signature=JSON.stringify(memory);
        if(signature===previous)return;
        previous=signature;
        const updated=memory.updated?new Date(memory.updated.replace(' ','T')+'Z').toLocaleString('zh-CN',{hour12:false}):'尚未生成总结';
        el('onlineMemoryProgress').textContent='待总结 '+memory.pending+' 条 · '+updated;
        el('onlineMemoryText').textContent=memory.summary||'累计满 100 条且群主配置 API 后生成。';
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
    const profiles=state.profiles.filter(p=>p.url&&p.model&&p.key);
    screen('邀请已有角色','<p class="muted">受邀角色会读取你已启用且适用于它的世界书。群成员 @ 角色时，近期群聊和相关人设会发给你选用的 API，费用由你的 API 账户承担。</p><form id="onlineCard"><label>已有角色卡<select name="card" required><option value="">请选择角色</option>'+state.contacts.map(c=>'<option value="'+esc(c.id)+'">'+esc(displayName(c))+'</option>').join('')+'</select></label><label>使用我的 API 预设<select name="profile" required><option value="">请选择 API 预设</option>'+profiles.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name||p.model)+'</option>').join('')+'</select></label>'+(!profiles.length?'<p class="muted">请先在「API 连接」中保存含 Key 的文本预设。</p>':'')+'<button type="submit" class="primary">邀请角色</button></form>'+end,()=>members(current));
    el('onlineCard').elements.card.onchange=()=>{
      const card=contact(el('onlineCard').elements.card.value);
      const preferred=card&&profileFor(card);
      if(preferred&&profiles.some(p=>p.id===preferred.id))el('onlineCard').elements.profile.value=preferred.id;
    };
    form('onlineCard',async(data,serial)=>{
      const card=contact(data.card),profile=profiles.find(p=>p.id===data.profile);
      if(!card||!profile)throw Error('请选择已有角色和 API 预设。');
      const context=cardContext(card);
      const {id}=await request('chars',{room:current.id,name:displayName(card).replace(/[\s@＠]+/gu,'').slice(0,24),avatar:'✦',...context,endpoint:profile.url,model:profile.model,key:profile.key});
      const map=mapping();map[id]={card:card.id,signature:await contextSignature(context)};
      localStorage.setItem(mappingKey,JSON.stringify(map));
      if(active(serial))members(current);
    });
  }
  return {directory,open,inviteFromUrl};
})();
