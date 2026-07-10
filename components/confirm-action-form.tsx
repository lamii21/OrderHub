"use client";

import type { ReactNode } from "react";
import { SubmitButton } from "@/components/submit-button";

// The one piece of this that needs to be a Client Component: a plain
// <form action={...}> can't ask "are you sure?" on its own. A native
// confirm() dialog keeps that to a few lines with no new UI library and no
// client-side fetching — the action itself still runs entirely as a Server
// Action. Generalized from a Delete-only version once Disconnect needed the
// exact same confirm-then-submit shape with just different wording.
//
// "children" is optional and only used by Regenerate Spreadcheet (Store
// Settings), which needs one extra input (the owner email to share the new
// sheet with) before the confirm+submit button — every other caller omits
// it and is unaffected. HTML's own "required" validation on that input still
// runs before onSubmit, so an empty field blocks submission before the
// confirm() dialog would even show.
export function ConfirmActionForm({
  shopId,
  confirmMessage,
  buttonLabel,
  pendingLabel,
  action,
  children,
}: {
  shopId: number;
  confirmMessage: string;
  buttonLabel: string;
  pendingLabel: string;
  action: (formData: FormData) => void | Promise<void>;
  children?: ReactNode;
}) {
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!window.confirm(confirmMessage)) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="shop_id" value={shopId} />
      {children}
      <SubmitButton variant="secondary" pendingLabel={pendingLabel}>
        {buttonLabel}
      </SubmitButton>
    </form>
  );
}
