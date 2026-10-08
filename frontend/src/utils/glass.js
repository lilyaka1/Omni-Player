export function initGlobalGlass() {
  let raf = null;

  const getGlassTarget = (event) => {
    let node = event.target;
    while (node && node !== document.documentElement) {
      if (node.classList?.contains('glass')) return node;
      node = node.parentElement;
    }
    return null;
  };

  const onMouseMove = (event) => {
    const element = getGlassTarget(event);
    if (!element) return;

    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const rect = element.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
      element.style.setProperty('--_sx', `${x * 100}%`);
      element.style.setProperty('--_sy', `${y * 100}%`);
    });
  };

  const onMouseLeave = (event) => {
    const element = event.target;
    if (!element?.classList?.contains('glass')) return;
    element.style.setProperty('--_sx', '32%');
    element.style.setProperty('--_sy', '20%');
  };

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseleave', onMouseLeave, true);

  return () => {
    if (raf) cancelAnimationFrame(raf);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseleave', onMouseLeave, true);
  };
}
