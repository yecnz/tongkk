import { useId } from 'react';
import CustomSelect from './CustomSelect';
import './SelectField.css';

type Props = {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  placeholder?: string;
  layout?: 'stacked' | 'row';
  className?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
};

/** Label and layout for the shared app select, including optional empty choices. */
export default function SelectField({ label, value, options, placeholder, disabled, layout = 'stacked', className = '', onChange }: Props) {
  const id = useId();
  const items = placeholder === undefined ? options : [{ value: '', label: placeholder }, ...options];
  return <div className={`select-field${layout === 'row' ? ' select-field--row' : ''} ${className}`.trim()}>
    <label htmlFor={id}>{label}</label>
    <CustomSelect id={id} aria-label={label} value={value} options={items} disabled={disabled}
      placeholder={placeholder || '선택할 항목이 없습니다'} onChange={onChange} />
  </div>;
}
