import { FC } from 'react';
import './style.scss';

interface ErikAskbarProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  disabled?: boolean;
}

const ErikAskbar: FC<ErikAskbarProps> = ({
  value,
  onChange,
  onSubmit,
  placeholder = 'Ask ERIK',
  disabled = false,
}) => {
  const handleSubmit = () => {
    if (onSubmit && !disabled) {
      onSubmit();
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && onSubmit && !disabled) {
      onSubmit();
    }
  };

  return (
    <div className="askbar askbar-inline" id="erikAskbar">
      <input
        id="erikInput"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyPress={handleKeyPress}
        disabled={disabled}
      />
      <button
        id="erikSend"
        className="erik-sparkle-btn"
        title="Run AI"
        aria-label="Run ERIK"
        onClick={handleSubmit}
        disabled={disabled}
      >
        <span className="erik-sparkle-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M2.5 11.5l18-8-7 17-3-6-8-3z" fill="currentColor" />
          </svg>
        </span>
      </button>
      <div className="erik-sparkle-layer" aria-hidden="true">
        {[...Array(12)].map((_, i) => (
          <svg key={i} className={`spark s${i + 1}`} viewBox="0 0 68 68">
            <path
              fill="white"
              d="M26.5 25.5C19.0043 33.3697 0 34 0 34C0 34 19.1013 35.3684 26.5 43.5C33.234 50.901 34 68 34 68C34 68 36.9884 50.7065 44.5 43.5C51.6431 36.647 68 34 68 34C68 34 51.6947 32.0939 44.5 25.5C36.5605 18.2235 34 0 34 0C34 0 33.6591 17.9837 26.5 25.5Z"
            />
          </svg>
        ))}
      </div>
    </div>
  );
};

export default ErikAskbar;
