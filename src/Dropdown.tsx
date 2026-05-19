import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

export interface DropdownOption {
  value: string;
  label: string;
}

interface DropdownProps {
  value: string;
  onChange: (value: string) => void;
  options: DropdownOption[];
  disabled?: boolean;
  className?: string;
}

export default function Dropdown({ value, onChange, options, disabled, className }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedLabel = options.find((o) => o.value === value)?.label ?? value;

  useEffect(() => {
    if (open && triggerRef.current) {
      setRect(triggerRef.current.getBoundingClientRect());
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleResize() { setOpen(false); }
    window.addEventListener('resize', handleResize);
    document.addEventListener('mousedown', handleClick);
    return () => {
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('mousedown', handleClick);
    };
  }, [open]);

  return (
    <div className={`dropdown-container ${disabled ? 'dropdown-disabled' : ''} ${className ?? ''}`} ref={containerRef}>
      <button
        type="button"
        ref={triggerRef}
        className={`dropdown-trigger ${open ? 'dropdown-open' : ''}`}
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
      >
        <span>{selectedLabel}</span>
        <span className="dropdown-arrow">{open ? '▴' : '▾'}</span>
      </button>
      {open && rect
        && createPortal(
          <div
            className="dropdown-menu"
            style={{ position: 'fixed', top: rect.bottom + 4, left: rect.left, minWidth: rect.width }}
          >
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`dropdown-option ${option.value === value ? 'dropdown-option-selected' : ''}`}
                onClick={() => { onChange(option.value); setOpen(false); }}
              >
                {option.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
