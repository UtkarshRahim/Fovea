export interface Shortcut {
  keys: string[];
  action: string;
}

export interface ShortcutGroup {
  title: string;
  items: Shortcut[];
}

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const mod = () => (isMac() ? "⌘" : "Ctrl");

const zoomKeys: Shortcut[] = [
  { keys: ["+"], action: "Zoom in" },
  { keys: ["−"], action: "Zoom out" },
  { keys: ["0"], action: "Fit to screen" },
];

/** Every keyboard shortcut in the app. The key handlers in Editor and Present must match this list. */
export function shortcutGroups(): ShortcutGroup[] {
  return [
    {
      title: "Project",
      items: [
        { keys: ["←", "→"], action: "Previous / next photo (↑ ↓ also work)" },
        ...zoomKeys,
        { keys: ["R"], action: "Review mode on / off" },
        { keys: ["I"], action: "Choose what shows on the photo" },
        { keys: ["P"], action: "Present" },
        { keys: ["?"], action: "Show keyboard shortcuts" },
      ],
    },
    {
      title: "Presentation",
      items: [
        { keys: ["←", "→"], action: "Previous / next photo" },
        { keys: ["Home", "End"], action: "First / last photo" },
        ...zoomKeys,
        { keys: ["O"], action: "Overlay on / off" },
        { keys: ["I"], action: "Choose what shows on the photo" },
        { keys: ["F"], action: "Fullscreen on / off" },
        { keys: ["Esc"], action: "Fit to screen, then leave the presentation" },
        { keys: ["?"], action: "Show keyboard shortcuts" },
      ],
    },
    {
      title: "Mouse, trackpad and touch",
      items: [
        { keys: ["Swipe"], action: "Previous / next photo (drag with a mouse)" },
        { keys: ["Double-click"], action: "Zoom to 100% there, or back to fit (double-tap on touch)" },
        { keys: [`${mod()} + scroll`], action: "Zoom around the pointer (pinch on a trackpad or screen)" },
        { keys: ["Drag"], action: "Move around while zoomed" },
        { keys: ["Tap"], action: "Show / hide controls in a presentation" },
      ],
    },
  ];
}
