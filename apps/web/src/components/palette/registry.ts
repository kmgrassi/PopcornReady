import { homeCommands } from "../../routes/home/commands";
import { libraryCommands } from "../../routes/library/commands";
import {
  adminSettingsCommands,
  settingsCommands,
} from "../../routes/settings/commands";
import type { PaletteCommand } from "./Palette";

export interface PaletteRegistryOptions {
  showAdminCommands?: boolean;
}

export function getPaletteCommands({
  showAdminCommands = false,
}: PaletteRegistryOptions = {}): PaletteCommand[] {
  return [
    ...homeCommands,
    ...libraryCommands,
    ...settingsCommands,
    ...(showAdminCommands ? adminSettingsCommands : []),
  ];
}
