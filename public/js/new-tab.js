(() => {
  if (window !== window.top) return;

  function launch() {
    const popup = window.open('about:blank', '_blank');
    if (!popup) return false;
    const doc = popup.document;
    doc.title = 'New Tab';
    doc.documentElement.lang = 'en';
    const viewport = doc.createElement('meta');
    viewport.name = 'viewport';
    viewport.content = 'width=device-width, initial-scale=1';
    doc.head.append(viewport);
    doc.body.style.cssText = 'margin:0;background:#121118';
    const frame = doc.createElement('iframe');
    frame.title = 'Duck';
    frame.allow = 'fullscreen; autoplay; gamepad; cross-origin-isolated';
    frame.allowFullscreen = true;
    frame.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0';
    frame.src = location.href;
    doc.body.append(frame);
    popup.opener = null;
    return true;
  }

  if (launch()) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Open in New Tab';
  button.style.cssText = 'position:fixed;right:1rem;bottom:1rem;z-index:11;padding:.55rem .85rem;border:1px solid #685c70;border-radius:.6rem;background:#221e2a;color:#f9f3e9;font:14px system-ui;cursor:pointer';
  button.addEventListener('click', () => {
    if (launch()) button.remove();
    else button.title = 'Allow pop-ups for this site to open a blank tab.';
  });
  document.body.append(button);
})();
