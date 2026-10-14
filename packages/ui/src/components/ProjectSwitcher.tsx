import { useState } from "react";
import { DropdownMenu } from "radix-ui";
import { Check, ChevronDown, LayoutGrid, Pencil } from "lucide-react";
import type { AssignmentSummary } from "@framenote/core";
import { usePlatform } from "../platform";
import { navigate } from "../lib/router";

export function ProjectSwitcher({
  currentId,
  title,
  beforeLeave,
  onRename,
}: {
  currentId: string;
  title: string;
  /** Runs before navigating away, e.g. to flush pending saves. */
  beforeLeave: () => Promise<void>;
  onRename: () => void;
}) {
  const platform = usePlatform();
  const [projects, setProjects] = useState<AssignmentSummary[] | null>(null);
  const [error, setError] = useState(false);

  const load = async () => {
    try {
      const list = await platform.listAssignments();
      setProjects(list.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt)));
      setError(false);
    } catch {
      setError(true);
    }
  };

  const go = async (id: string) => {
    if (id === currentId) return;
    await beforeLeave();
    navigate({ name: "editor", id });
  };

  return (
    <DropdownMenu.Root onOpenChange={(open) => open && void load()}>
      <DropdownMenu.Trigger asChild>
        <button type="button" className="project-switcher" aria-label={`Project: ${title}. Switch project`}>
          <span className="project-switcher-title">{title}</span>
          <ChevronDown size={16} aria-hidden="true" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu" align="start" sideOffset={6} collisionPadding={8}>
          <DropdownMenu.Label className="menu-label">Projects</DropdownMenu.Label>
          <div className="menu-scroll">
            {error ? (
              <p className="menu-note">Projects could not be loaded.</p>
            ) : projects === null ? (
              <p className="menu-note">Loading…</p>
            ) : (
              projects.map((p) => (
                <DropdownMenu.Item key={p.id} className="menu-item" onSelect={() => void go(p.id)}>
                  <span className="menu-check" aria-hidden="true">
                    {p.id === currentId ? <Check size={14} /> : null}
                  </span>
                  <span className="menu-text">{p.title}</span>
                  <span className="menu-meta mono">{p.imageCount}</span>
                </DropdownMenu.Item>
              ))
            )}
          </div>
          <DropdownMenu.Separator className="menu-sep" />
          <DropdownMenu.Item className="menu-item" onSelect={onRename}>
            <span className="menu-check" aria-hidden="true">
              <Pencil size={14} />
            </span>
            Rename this project…
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className="menu-item"
            onSelect={async () => {
              await beforeLeave();
              navigate({ name: "library" });
            }}
          >
            <span className="menu-check" aria-hidden="true">
              <LayoutGrid size={14} />
            </span>
            All projects
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
