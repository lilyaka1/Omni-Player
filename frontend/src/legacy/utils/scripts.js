export async function loadScriptsSequentially(urls) {
  for (const url of urls) {
    await new Promise((resolve, reject) => {
      if (document.querySelector(`script[data-legacy-src="${url}"]`)) {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = url;
      script.async = false;
      script.dataset.legacySrc = url;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load ${url}`));
      document.body.appendChild(script);
    });
  }
}
