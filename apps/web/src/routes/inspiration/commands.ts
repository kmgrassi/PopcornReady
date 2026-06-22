import type { PaletteCommand } from "../../components/palette/Palette";

function go(to: string): PaletteCommand["run"] {
  return (navigate) => navigate(to);
}

export const inspirationCommands: PaletteCommand[] = [
  {
    id: "inspiration.open",
    title: "Inspiration",
    subtitle: "Random story generator",
    keywords: ["story", "plot", "theme", "generator"],
    run: go("/inspiration"),
  },
];
