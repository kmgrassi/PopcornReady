import type { PaletteCommand } from "../../components/palette/Palette";

function go(to: string): PaletteCommand["run"] {
  return (navigate) => navigate(to);
}

export const libraryCommands: PaletteCommand[] = [
  {
    id: "library.projects",
    title: "Projects",
    subtitle: "Browse workspace projects",
    keywords: ["library", "cuts", "storyboard"],
    run: go("/projects"),
  },
  {
    id: "library.assets",
    title: "Assets",
    subtitle: "Browse uploaded and generated assets",
    keywords: ["library", "uploads", "images", "video", "audio"],
    run: go("/assets"),
  },
];
