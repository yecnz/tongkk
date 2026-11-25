import { useEffect, useRef, type ReactNode } from "react";

type ModalDialogProps = {
  children: ReactNode;
  labelledBy: string;
  onClose: () => void;
  width?: number;
};

export default function ModalDialog({ children, labelledBy, onClose, width = 380 }: ModalDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current!;
    const trigger = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className="tongkk-dialog"
      aria-labelledby={labelledBy}
      style={{ width }}
      onCancel={event => { event.preventDefault(); onClose(); }}
    >
      {children}
    </dialog>
  );
}
