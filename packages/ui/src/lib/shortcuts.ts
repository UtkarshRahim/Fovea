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

const focusKey: Shortcut = { keys: ["A"], action: "Focus point on / off (where the camera focused)" };

/** Every keyboard shortcut in the app. The key handlers in Editor, Present and Viewer must match this list. */
export function shortcutGroups(): ShortcutGroup[] {
  return [
    {
      title: "Project",
      items: [
        { keys: ["←", "→"], action: "Previous / next photo (↑ ↓ also work)" },
        ...zoomKeys,
        focusKey,
        { keys: ["R"], action: "Review mode on / off" },
        { keys: ["I"], action: "Choose what shows on the photo" },
        { keys: ["V"], action: "Camera data horizontal / vertical" },
        { keys: ["P"], action: "Present" },
        { keys: ["Delete"], action: "Remove this photo from the project" },
        { keys: ["?"], action: "Show keyboard shortcuts" },
      ],
    },
    {
      title: "Presentation",
      items: [
        { keys: ["←", "→"], action: "Previous / next photo" },
        { keys: ["Home", "End"], action: "First / last photo" },
        ...zoomKeys,
        focusKey,
        { keys: ["O"], action: "Overlay on / off" },
        { keys: ["I"], action: "Choose what shows on the photo" },
        { keys: ["V"], action: "Camera data horizontal / vertical" },
        { keys: ["F"], action: "Fullscreen on / off" },
        { keys: ["Esc"], action: "Fit to screen, then leave the presentation" },
        { keys: ["?"], action: "Show keyboard shortcuts" },
      ],
    },
    {
      title: "Viewing a folder",
      items: [
        { keys: ["←", "→"], action: "Previous / next photo in the folder (↑ ↓ also work)" },
        { keys: ["Home", "End"], action: "First / last photo" },
        ...zoomKeys,
        focusKey,
        { keys: ["O"], action: "Camera data on / off" },
        { keys: ["V"], action: "Camera data horizontal / vertical" },
        { keys: ["F"], action: "Fullscreen on / off" },
        { keys: ["Esc"], action: "Fit to screen, then leave fullscreen" },
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
