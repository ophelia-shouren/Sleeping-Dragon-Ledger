(() => {
  'use strict';
  const protectedArea='body[data-native-selection="off"] #view,aside .brand,#dialog .group-room,#dialog #ledgerOnline,#dialog .chat-top';
  function element(node){return node?.nodeType===1?node:node?.parentElement;}
  function blocked(node){
    const target=element(node);
    if(!target||target.closest('input,textarea')||target.isContentEditable)return false;
    return !!target.closest(protectedArea);
  }
  // Do not stop propagation: the app's own long-press menus still receive events.
  for(const type of ['selectstart','contextmenu'])document.addEventListener(type,event=>{
    if(blocked(event.target))event.preventDefault();
  },true);
  document.addEventListener('selectionchange',()=>{
    const selection=window.getSelection();
    if(selection&&!selection.isCollapsed&&(blocked(selection.anchorNode)||blocked(selection.focusNode)))selection.removeAllRanges();
  });
})();
