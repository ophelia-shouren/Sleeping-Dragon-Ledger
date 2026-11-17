const ledgerOnline = (() => {
  const base='https://tongpin-chat.yearnwingwings.chatgpt.site/ledger-api/';
  const key='sleeping-dragon-online-identity';
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
  function screen(title,body,back){
    clearTimeout(pollTimer);
    const serial=++generation;
    dialog('<section class="group-room" id="ledgerOnline"><div class="chat-top"><button id="onlineBack" type="button" aria-label="返回">‹</button><div class="chat-name"><h2>'+esc(title)+'</h2></div></div>'+body+'</section>',true);
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
  function drawMessages(mode){
    const box=el('onlineMessages'), oldHeight=box.scrollHeight, oldTop=box.scrollTop;
    const people=new Map((detail?.members||[]).map(x=>[x.id,x]));
    box.innerHTML=(older?'<div class="chat-history-page"><button type="button" id="onlineOlder">查看更早的消息</button></div>':'')+
      (messages.map(m=>{
        const mine=!m.char_id&&m.sender===me.id;
        const text=esc(m.body);
        const role=mine?'user':'assistant';
        const avatar='<span class="avatar-button">'+personAvatar(m.name,m.char_id?'':people.get(m.sender)?.avatar)+'</span>';
        const name=mine?'':'<small>'+esc(m.name)+(m.char_id?' · AI':'')+'</small>';
        const layout=chatMessageLayout(avatar,name,'');
        return '<div class="message-row '+role+'">'+layout.before+'<article class="bubble '+role+'">'+layout.name+'<p style="white-space:pre-wrap;overflow-wrap:anywhere">'+text+'</p></article></div>';
      }).join('')||'<div class="empty">还没有消息，打声招呼吧。</div>');
    box.scrollTop=mode==='bottom'?box.scrollHeight:mode==='prepend'?oldTop+box.scrollHeight-oldHeight:oldTop;
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
  function chatRoom(current){
    if(!current)return rooms();
    room=current;messages=[];older=false;detail=null;
    const serial=screen(current.name,'<div class="row"><button type="button" id="onlineMembers">成员与邀请</button>'+(current.kind==='group'?'<button type="button" id="onlineMention">@ 角色</button>':'')+'</div>'+end+'<div id="onlineMessages" class="messages"></div><form id="onlineCompose" class="row"><textarea name="body" aria-label="聊天消息" required maxlength="4000" placeholder="写一条消息…"></textarea><button type="submit" class="primary composer-send">发送</button></form>',rooms);
    el('onlineMembers').onclick=()=>members(current);
    if(el('onlineMention'))el('onlineMention').onclick=()=>{
      const chars=detail?.chars||[];
      if(!chars.length)return status('还没有角色加入。');
      const choices=el('onlineChoices');
      if(choices){choices.remove();return;}
      const box=document.createElement('div');
      box.id='onlineChoices';box.className='row';
      for(const char of chars){
        const button=document.createElement('button');
        button.type='button';button.textContent='@'+char.name;
        button.onclick=()=>{const input=el('onlineCompose').elements.body;input.value='@'+char.name+' '+input.value;input.focus();box.remove();};
        box.append(button);
      }
      el('onlineCompose').before(box);
    };
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
    form('onlineCompose',async(data,requestSerial)=>{
      const input=el('onlineCompose').elements.body;
      const body=data.body.trim();
      if(!body)return;
      input.value='';
      let result;
      try{result=await request('send',{room:current.id,body});}
      catch(error){if(active(requestSerial)&&!input.value)input.value=body;throw error;}
      if(!active(requestSerial))return;
      if(result.notice)status(result.notice);
      await refresh();
    });
    refresh().catch(e=>{if(active(serial))status(e.message);});
    later(serial,refresh,4500);
  }
  async function members(current){
    const back=()=>chatRoom(current);
    const serial=screen('成员与邀请','<div class="messages" id="onlineMemberList"></div>'+end,back);
    try{
      const info=await request('detail?room='+current.id);
      if(!active(serial))return;
      const link=new URL('https://ophelia-shouren.github.io/Sleeping-Dragon-Ledger/');link.searchParams.set('onlineInvite',info.invite||'');
      el('onlineMemberList').innerHTML=info.members.map(x=>'<div class="row">'+personAvatar(x.name,x.avatar)+'<span>'+esc(x.name)+(x.id===me.id?'（你）':'')+'</span></div>').join('')+
        info.chars.map(x=>'<div class="row"><span>'+esc(x.name)+' · AI</span>'+(x.owner===me.id?'<button type="button" data-online-remove="'+esc(x.id)+'">移除</button>':'')+'</div>').join('')+
        (info.invite?'<label>邀请链接<input id="onlineLink" readonly value="'+esc(link.href)+'"></label><button id="onlineCopy" type="button">复制邀请链接</button>':'')+
        (current.kind==='group'?'<button type="button" class="primary" id="onlineAddChar">邀请已有角色</button>':'');
      if(el('onlineCopy'))el('onlineCopy').onclick=async()=>{
        try{await navigator.clipboard.writeText(link.href);status('已复制邀请链接。');}
        catch{el('onlineLink').select();status('已选中邀请链接，可以手动复制。');}
      };
      if(el('onlineAddChar'))el('onlineAddChar').onclick=()=>inviteCard(current);
      el('onlineMemberList').querySelectorAll('[data-online-remove]').forEach(button=>button.onclick=async()=>{
        button.disabled=true;
        try{
          await request('remove-char',{room:current.id,id:button.dataset.onlineRemove});
          const map=mapping();delete map[button.dataset.onlineRemove];localStorage.setItem(mappingKey,JSON.stringify(map));
          if(active(serial))members(current);
        }catch(e){if(active(serial))status(e.message);button.disabled=false;}
      });
    }catch(e){if(active(serial))status(e.message);}
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
