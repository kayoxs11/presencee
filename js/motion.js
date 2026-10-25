/* One-shot reveals: content stays visible if this file or observers are unavailable. */
(() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const seenProducts = new Set();
  const observed = new WeakSet();
  let observer;

  function scan() {
    if (!observer || reduced.matches) return;
    document.querySelectorAll('.cat,.coll > .wrap > h2,.coll .sub,.card,.pers .wrap,.insp .wrap,.ig .wrap,.footer-intro,.fg > *').forEach((element, index) => {
      if (observed.has(element)) return;
      observed.add(element);
      if (element.dataset.product && seenProducts.has(element.dataset.product)) return;
      element.style.setProperty('--reveal-delay', `${Math.min(index % 4, 3) * 45}ms`);
      observer.observe(element);
    });
  }

  function setup() {
    observer?.disconnect();
    if (reduced.matches || !('IntersectionObserver' in window)) return;
    observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const element = entry.target;
        if (element.dataset.product) seenProducts.add(element.dataset.product);
        element.classList.add('reveal-in');
        element.addEventListener('animationend', () => element.classList.remove('reveal-in'), { once: true });
        observer.unobserve(element);
      });
    }, { threshold: .08 });
    scan();
  }
  document.addEventListener('presence:render', scan);
  reduced.addEventListener('change', setup);
  setup();

  // Keep the contact control clear of purchase actions, fields and footer links.
  const contact = document.getElementById('whatsapp-float');
  let scheduled = false;
  function positionContact() {
    scheduled = false;
    if (contact.hidden) return;
    const rect = contact.getBoundingClientRect();
    const controls = [...document.querySelectorAll('.card .btn,.cat,.fav,.tools select,.tools button,.hero a,.plist button,#detail a,#detail button,#detail input,#detail textarea,footer a')]
      .map(element => element.getBoundingClientRect())
      .filter(box => box.width && box.right > rect.left - 8 && box.left < rect.right + 8 && box.bottom > 0 && box.top < innerHeight);
    const base = 20;
    let bottom = base;
    for (let attempt = 0; attempt < 12; attempt++) {
      const top = innerHeight - bottom - rect.height;
      const collision = controls.find(box => box.bottom > top - 8 && box.top < top + rect.height + 8);
      if (!collision) break;
      bottom = Math.max(bottom, innerHeight - collision.top + 12);
    }
    contact.style.setProperty('--contact-lift', `${Math.min(bottom - base, Math.max(0, innerHeight - 260))}px`);
  }
  function schedulePosition() {
    if (!scheduled) { scheduled = true; requestAnimationFrame(positionContact); }
  }
  addEventListener('scroll', schedulePosition, { passive: true });
  addEventListener('resize', schedulePosition);
  addEventListener('hashchange', schedulePosition);
  document.addEventListener('presence:render', schedulePosition);
  schedulePosition();
})();
