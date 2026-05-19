import React, { useState, useRef, useEffect, type ReactNode } from 'react';

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
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedLabel = options.find((o) => o.value === value)?.label ?? value;

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div className={`dropdown-container ${disabled ? 'dropdown-disabled' : ''} ${className ?? ''}`} ref={containerRef}>
      <button
        type="button"
        className={`dropdown-trigger ${open ? 'dropdown-open' : ''}`}
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
      >
        <span>{selectedLabel}</span>
        <span className="dropdown-arrow">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="dropdown-menu">
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
        </div>
      )}
    </div>
  );
}
