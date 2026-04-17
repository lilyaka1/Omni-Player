import { useEffect, useRef } from 'react';

export default function LegacyHtmlPage({ html, init }) {
  const containerRef = useRef(null);

  useEffect(() => {
    const cleanup = init?.(containerRef.current);
    return () => {
      cleanup?.();
    };
  }, [html, init]);

  return <div ref={containerRef} dangerouslySetInnerHTML={{ __html: html }} />;
}
