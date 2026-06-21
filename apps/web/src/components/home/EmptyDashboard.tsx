import type { NextAction } from "../../lib/nextAction";
import { HeroCard } from "./HeroCard";

export function EmptyDashboard({ action }: { action: NextAction }) {
  return <HeroCard action={action} />;
}
