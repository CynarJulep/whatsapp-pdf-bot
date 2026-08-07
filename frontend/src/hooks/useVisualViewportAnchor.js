import { useState, useEffect } from 'react';

const MOBILE_QUERY = '(max-width: 767px)';

/**
 * Keeps fixed overlays anchored to the visible viewport on mobile
 * (above the on-screen keyboard) using the Visual Viewport API.
 */
export function useVisualViewportAnchor(enabled = false) {
  const [style, setStyle] = useState(null);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      setStyle(null);
      return undefined;
    }

    const media = window.matchMedia(MOBILE_QUERY);
    const vv = window.visualViewport;

    const update = () => {
      if (!media.matches || !vv) {
        setStyle(null);
        return;
      }

      const margin = 12;
      const top = vv.offsetTop + margin;
      const maxHeight = Math.max(180, vv.height - margin * 2);

      // Solo se ajusta el eje vertical: el centrado horizontal lo resuelven
      // las utilidades `left-1/2` + `-translate-x-1/2` del diálogo.
      setStyle({
        top: `${top}px`,
        maxHeight: `${maxHeight}px`,
      });
    };

    update();
    media.addEventListener('change', update);
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    window.addEventListener('orientationchange', update);
    document.addEventListener('focusin', update);

    return () => {
      media.removeEventListener('change', update);
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
      window.removeEventListener('orientationchange', update);
      document.removeEventListener('focusin', update);
    };
  }, [enabled]);

  return style;
}
