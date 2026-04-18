import { useCallback, useRef, useState } from "react";

const MODAL_CLOSE_DURATION = 140;

export function useModalClose(onClose: () => void) {
  const [closing, setClosing] = useState(false);
  const timerRef = useRef<number | null>(null);

  const close = useCallback(() => {
    if (timerRef.current !== null) return;
    setClosing(true);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      onClose();
    }, MODAL_CLOSE_DURATION);
  }, [onClose]);

  return { closing, close };
}
