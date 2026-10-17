import { useCallback, useEffect, useState } from "react";

const KEY = "framenote.showFocus";
const EVENT = "framenote:focus-toggle";

/** Whether focus points are drawn. Off by default; one setting shared by every screen and remembered between sessions. */
export function useFocusPoints(): [boolean, () => void] {
  const [on, setOn] = useState(() => localStorage.getItem(KEY) === "1");
  useEffect(() => {
    const sync = () => setOn(localStorage.getItem(KEY) === "1");
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  const toggle = useCallback(() => {
    localStorage.setItem(KEY, localStorage.getItem(KEY) === "1" ? "0" : "1");
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [on, toggle];
}
