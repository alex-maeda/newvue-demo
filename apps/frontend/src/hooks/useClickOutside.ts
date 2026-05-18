import { useEffect, useRef } from 'react';

const useDetectClickOutside = (handlerOutSide: () => void) => {
  const refElement = useRef<HTMLDivElement | null>(null);
  const checkClickRef = useRef<boolean | null>(false);
  const isScrolled = useRef<boolean | null>(false);

  const handlerMouseDown = (event: MouseEvent) => {
    const target = event.target as HTMLElement;

    const excludeSelectors: string[] = [
      '.modal',
      '.document-modal',
      '.note-modal',
    ];

    const isOutsideClick =
      refElement.current && !refElement.current.contains(target);

    const isExcludedClick = excludeSelectors.some((selector) =>
      document.querySelector(selector)?.contains(target),
    );

    checkClickRef.current = isOutsideClick && !isExcludedClick;
  };

  const handlerScroll = () => {
    isScrolled.current = true;

    handlerOutSide();
  };

  const handlerMouseUp = () => {
    if (!isScrolled.current && checkClickRef.current) {
      handlerOutSide();
    }
    isScrolled.current = false;
  };

  useEffect(() => {
    document.addEventListener('mousedown', handlerMouseDown);
    document.addEventListener('mouseup', handlerMouseUp);
    document.addEventListener('scroll', handlerScroll);
    return () => {
      document.removeEventListener('mousedown', handlerMouseDown);
      document.removeEventListener('mouseup', handlerMouseUp);
      document.removeEventListener('scroll', handlerScroll);
    };
  }, [handlerOutSide]);

  return refElement;
};

export default useDetectClickOutside;
