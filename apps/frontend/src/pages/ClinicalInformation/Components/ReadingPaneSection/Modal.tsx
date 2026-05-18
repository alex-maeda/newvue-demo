import { FC, ReactNode } from 'react';
import { IoMdClose } from 'react-icons/io';
import './Modal.scss';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  className?: string;
}

const Modal: FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  className = '',
}) => {
  if (!isOpen) return null;

  return (
    <div className={`nv-modal ${className}`}>
      <div className="nv-modal__backdrop" onClick={onClose} />
      <div className="nv-modal__panel">
        <div className="nv-modal__header">
          <h2>{title}</h2>
          <button
            type="button"
            className="nv-icon-btn"
            onClick={onClose}
            aria-label="Close"
          >
            <IoMdClose />
          </button>
        </div>
        <div className="nv-modal__body">{children}</div>
      </div>
    </div>
  );
};

export default Modal;
