import { VranaMark } from "@/components/VranaMark";

export default function GuestShareNotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
      <VranaMark className="size-12" />
      <h1 className="text-2xl font-semibold">This link doesn&apos;t work</h1>
      <p className="max-w-sm text-muted-foreground">
        It may have been reset or deleted. Ask whoever sent it for a new one.
      </p>
    </div>
  );
}
