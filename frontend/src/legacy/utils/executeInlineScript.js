export function executeInlineScript(code, key) {
  const prev = document.querySelector(`script[data-legacy-inline="${key}"]`);
  if (prev) prev.remove();

  const script = document.createElement('script');
  script.type = 'text/javascript';
  script.dataset.legacyInline = key;
  script.text = code;
  document.body.appendChild(script);

  return () => {
    script.remove();
  };
}
