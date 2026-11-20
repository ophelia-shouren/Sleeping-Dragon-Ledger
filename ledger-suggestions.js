(() => {
  let openPicker;
  const enhanced = new WeakSet();
  const observers = new Map();
  const close = () => {
    if (!openPicker) return;
    openPicker.menu.hidden = true;
    openPicker.toggle.setAttribute('aria-expanded', 'false');
    openPicker = null;
  };
  function enhance(input) {
    if (enhanced.has(input)) return;
    const list = document.getElementById(input.getAttribute('list'));
    const label = input.closest('label');
    if (!label || list?.tagName !== 'DATALIST') return;
    enhanced.add(input);
    const picker = document.createElement('div');
    picker.className = 'ledger-suggestions';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'ledger-suggestions-toggle';
    toggle.setAttribute('aria-label', '选择已有选项');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.innerHTML = '<svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const menu = document.createElement('div');
    menu.className = 'ledger-suggestions-menu';
    menu.hidden = true;
    menu.id = list.id + '-choices';
    toggle.setAttribute('aria-controls', menu.id);
    label.before(picker);
    picker.append(label, toggle, menu);
    input.removeAttribute('list');
    const align = () => {
      toggle.style.bottom = (picker.getBoundingClientRect().bottom - input.getBoundingClientRect().bottom + 4) + 'px';
      toggle.style.height = Math.max(32, input.offsetHeight - 8) + 'px';
    };
    align();
    const observer = new ResizeObserver(align);
    observer.observe(input);
    observers.set(picker, observer);
    function show() {
      close();
      const choices = [...new Map([...list.options].filter(option => option.value && !option.disabled)
        .map(option => [option.value, option.label || option.value])).entries()];
      menu.replaceChildren();
      if (!choices.length) {
        const empty = document.createElement('p');
        empty.className = 'ledger-suggestions-empty';
        empty.textContent = '暂无已有选项，可直接输入。';
        menu.append(empty);
      }
      for (const [value, name] of choices) {
        const option = document.createElement('button');
        option.type = 'button';
        option.className = 'ledger-suggestions-option';
        option.textContent = name;
        if (value === input.value) option.setAttribute('aria-current', 'true');
        option.onclick = () => {
          input.value = value;
          close();
          toggle.focus({preventScroll:true});
          input.dispatchEvent(new Event('input', {bubbles:true}));
          input.dispatchEvent(new Event('change', {bubbles:true}));
        };
        menu.append(option);
      }
      menu.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');
      openPicker = {picker, toggle, menu};
    }
    toggle.onclick = () => { if (menu.hidden) show(); else close(); };
    picker.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !menu.hidden) {
        event.preventDefault();
        event.stopPropagation();
        close();
        toggle.focus();
      } else if (event.key === 'ArrowDown' && event.target === input) {
        event.preventDefault();
        show();
        menu.querySelector('button')?.focus();
      }
    });
  }
  document.addEventListener('pointerdown', event => {
    if (openPicker && !openPicker.picker.contains(event.target)) close();
  }, true);
  function scan(root) {
    if (root.matches?.('input[list]')) enhance(root);
    root.querySelectorAll?.('input[list]').forEach(enhance);
  }
  scan(document);
  new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) if (node.nodeType === 1) scan(node);
    if (openPicker && !openPicker.picker.isConnected) close();
    for (const [picker, observer] of observers) if (!picker.isConnected) {
      observer.disconnect();
      observers.delete(picker);
    }
  }).observe(document.body, {childList:true, subtree:true});
})();
