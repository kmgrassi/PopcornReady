import type { PaletteCommand } from "../../components/palette/Palette";
import { newStudioDraftPath } from "../../lib/studioRoutes";

function go(to: string): PaletteCommand["run"] {
  return (navigate) => navigate(to);
}

function startNewStudioDraft(): PaletteCommand["run"] {
  return (navigate) => navigate(newStudioDraftPath());
}

export const homeCommands: PaletteCommand[] = [
  {
    id: "home.open",
    title: "Open Home",
    subtitle: "Dashboard launchpad",
    keywords: ["dashboard", "launchpad", "next action"],
    run: go("/dashboard"),
  },
  {
    id: "home.new-video",
    title: "New video",
    subtitle: "Start the guided Studio flow",
    keywords: ["create", "studio", "start", "rough cut"],
    run: startNewStudioDraft(),
  },
];
