import { Link } from "@tanstack/react-router";
import { Clock, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";

// Shown in place of a page whose feature switch (src/lib/features.ts) is off.
export function ComingSoon({ title, description }: { title: string; description: string }) {
  return (
    <div className="min-h-[100dvh] bg-background grid place-items-center px-4">
      <div className="max-w-sm w-full rounded-2xl bg-gradient-card border border-border/60 shadow-soft p-6 text-center space-y-4">
        <span className="mx-auto h-12 w-12 grid place-items-center rounded-xl bg-primary/15 text-primary">
          <Clock className="h-6 w-6" />
        </span>
        <div className="space-y-1.5">
          <h1 className="font-display text-xl font-bold">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <Button asChild className="w-full bg-gradient-primary shadow-glow">
          <Link to="/">
            <MapPin className="h-4 w-4 mr-1.5" />
            Back to Live Track
          </Link>
        </Button>
      </div>
    </div>
  );
}
