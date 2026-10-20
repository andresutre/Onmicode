import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadArchivedProjects,
  loadRecents,
} from "../../projects/model/recents";
import {
  loadWelcomeCompleted,
  OPEN_WELCOME_EVENT,
  saveWelcomeCompleted,
  shouldShowWelcomeAtBoot,
} from "../model/welcome";

/**
 * Whether the welcome is open. Decided during the first render, before the
 * workspace's startup effects remember a project from the launch directory.
 */
export function useWelcome(boot: {
  transferred: boolean;
  resumed: boolean;
  sessions: number;
}) {
  const [open, setOpen] = useState(() =>
    shouldShowWelcomeAtBoot({
      ...boot,
      completed: loadWelcomeCompleted(),
      projects: loadRecents().length + loadArchivedProjects().length,
    }),
  );
  const shownAtBoot = useRef(open);

  useEffect(() => {
    // An existing user never gets it later, even after removing every project.
    if (!shownAtBoot.current && !loadWelcomeCompleted()) saveWelcomeCompleted();
  }, []);

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_WELCOME_EVENT, show);
    return () => window.removeEventListener(OPEN_WELCOME_EVENT, show);
  }, []);

  const close = useCallback(() => {
    saveWelcomeCompleted();
    setOpen(false);
  }, []);

  return { open, close };
}
