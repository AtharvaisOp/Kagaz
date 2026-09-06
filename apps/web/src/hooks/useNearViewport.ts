import { useEffect, useRef, useState } from 'react';

export function useNearViewport(): {
  elementRef: React.RefObject<HTMLDivElement | null>;
  isNearViewport: boolean;
} {
  const elementRef = useRef<HTMLDivElement>(null);
  const [isNearViewport, setIsNearViewport] = useState(false);

  useEffect(() => {
    const element = elementRef.current;

    if (!element || typeof IntersectionObserver === 'undefined') {
      setIsNearViewport(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsNearViewport(entry?.isIntersecting ?? false);
      },
      { rootMargin: '700px 0px' },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { elementRef, isNearViewport };
}
