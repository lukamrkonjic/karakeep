import { VranaMark } from "./VranaMark";

/**
 * Fork: the app is "vrana" — its blue square with the crow, as tall as the
 * name's type, then the name. Kept under its upstream name so the places
 * that show it stay untouched.
 */
export default function KarakeepLogo({ height }: { height: number }) {
  return (
    <span
      className="flex items-center gap-[0.3em] font-semibold tracking-tight text-foreground"
      style={{ fontSize: Math.round(height * 0.64), lineHeight: 1 }}
    >
      <VranaMark className="size-[1em] shrink-0" />
      <span className="-mt-[0.08em]">vrana</span>
    </span>
  );
}
