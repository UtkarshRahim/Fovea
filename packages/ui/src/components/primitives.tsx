import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Checkbox as RCheckbox, Dialog as RDialog, Slider as RSlider, ToggleGroup } from "radix-ui";
import { Check, X } from "lucide-react";

type Variant = "primary" | "default" | "ghost" | "danger";

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "md" | "sm" }>(
  function Button({ variant = "default", size = "md", className = "", type = "button", ...rest }, ref) {
    return <button ref={ref} type={type} className={`btn btn-${variant} btn-${size} ${className}`} {...rest} />;
  },
);

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string; variant?: Variant }>(
  function IconButton({ label, variant = "ghost", className = "", type = "button", ...rest }, ref) {
    return <button ref={ref} type={type} aria-label={label} title={label} className={`icon-btn btn-${variant} ${className}`} {...rest} />;
  },
);

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="dialog-overlay" />
        <RDialog.Content className={`dialog ${wide ? "dialog-wide" : ""}`}>
          <div className="dialog-head">
            <RDialog.Title className="dialog-title">{title}</RDialog.Title>
            <RDialog.Close asChild>
              <IconButton label="Close">
                <X size={18} />
              </IconButton>
            </RDialog.Close>
          </div>
          {description ? <RDialog.Description className="dialog-desc">{description}</RDialog.Description> : <RDialog.Description className="sr-only">{title}</RDialog.Description>}
          {children}
          {footer ? <div className="dialog-foot">{footer}</div> : null}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="danger"
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}

export function Checkbox({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="check-row">
      <RCheckbox.Root id={id} className="checkbox" checked={checked} onCheckedChange={(v) => onChange(v === true)}>
        <RCheckbox.Indicator>
          <Check size={14} strokeWidth={2.5} />
        </RCheckbox.Indicator>
      </RCheckbox.Root>
      <label htmlFor={id}>{label}</label>
    </div>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  return (
    <div className="slider-row">
      <div className="slider-label">
        <span>{label}</span>
        <span className="mono muted">{format ? format(value) : value}</span>
      </div>
      <RSlider.Root className="slider" value={[value]} min={min} max={max} step={step} onValueChange={([v]) => v !== undefined && onChange(v)}>
        <RSlider.Track className="slider-track">
          <RSlider.Range className="slider-range" />
        </RSlider.Track>
        <RSlider.Thumb className="slider-thumb" aria-label={label} />
      </RSlider.Root>
    </div>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented-row">
      <span className="segmented-label">{label}</span>
      <ToggleGroup.Root
        type="single"
        className="segmented"
        value={value}
        aria-label={label}
        onValueChange={(v) => v && onChange(v as T)}
      >
        {options.map((o) => (
          <ToggleGroup.Item key={o.value} value={o.value} className="segmented-item">
            {o.label}
          </ToggleGroup.Item>
        ))}
      </ToggleGroup.Root>
    </div>
  );
}
