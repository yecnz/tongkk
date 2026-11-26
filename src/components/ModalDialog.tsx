import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

let openDialogCount = 0;
let previousBodyOverflow = '';

type ModalDialogProps = {
  children: ReactNode;
  labelledBy: string;
  onClose: () => void;
  width?: number | string;
  className?: string;
  style?: CSSProperties;
  closeOnBackdrop?: boolean;
  describedBy?: string;
};

export default function ModalDialog({ children, labelledBy, onClose, width = 380, className = '', style, closeOnBackdrop = true, describedBy }: ModalDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const backdropPressed = useRef(false);

  useEffect(() => {
    const dialog = ref.current!;
    const trigger = document.activeElement;
    dialog.showModal();
    if (openDialogCount === 0) {
      previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    openDialogCount += 1;
    return () => {
      dialog.close();
      openDialogCount -= 1;
      if (openDialogCount === 0) document.body.style.overflow = previousBodyOverflow;
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={`tongkk-dialog ${className}`.trim()}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      style={{ width, ...style }}
      onPointerDown={event => { backdropPressed.current = event.target === event.currentTarget; }}
      onClick={event => {
        if (closeOnBackdrop && backdropPressed.current && event.target === event.currentTarget) {
          const bounds = event.currentTarget.getBoundingClientRect();
          if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
        }
        backdropPressed.current = false;
      }}
      onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }}
      onKeyDown={event => {
        if ((event.target as Element).closest('dialog') !== event.currentTarget) return;
        if (event.key !== 'Tab') return;
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
          'button, [href], input:not([type="hidden"]), select, textarea, [tabindex]',
        )).filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length > 0);
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      {children}
    </dialog>
  );
}
