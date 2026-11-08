import { createFileRoute, redirect } from "@tanstack/react-router";

// The single-child parent screen grew into /family (several children, trip
// status, notices, notifications). Old links and installed shortcuts keep working.
export const Route = createFileRoute("/me")({
  beforeLoad: () => {
    throw redirect({ to: "/family" });
  },
});
