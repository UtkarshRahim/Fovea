import { Keyboard } from "lucide-react";
import { shortcutGroups } from "../lib/shortcuts";
import { Dialog, IconButton } from "./primitives";

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Keyboard shortcuts" wide>
      <div className="dialog-body shortcuts">
        {shortcutGroups().map((g) => (
          <section key={g.title} aria-labelledby={`sc-${g.title}`}>
            <h3 id={`sc-${g.title}`} className="section-title">
              {g.title}
            </h3>
            <dl className="shortcut-list">
              {g.items.map((s) => (
                <div key={s.action + s.keys.join()}>
                  <dt>
                    {s.keys.map((k) => (
                      <kbd key={k}>{k}</kbd>
                    ))}
                  </dt>
                  <dd>{s.action}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}

export function ShortcutsButton({ onClick, className = "" }: { onClick: () => void; className?: string }) {
  return (
    <IconButton label="Keyboard shortcuts (?)" onClick={onClick} className={`shortcuts-btn ${className}`}>
      <Keyboard size={18} />
    </IconButton>
  );
}
