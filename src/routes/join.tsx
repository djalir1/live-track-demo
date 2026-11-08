import { createFileRoute, redirect } from "@tanstack/react-router";

// The old invite-code + PIN flow is replaced by phone + activation code on
// /parent ("First time here?"). Old links keep working.
export const Route = createFileRoute("/join")({
  beforeLoad: () => {
    throw redirect({ to: "/parent", search: { tab: "activate" } });
  },
});
