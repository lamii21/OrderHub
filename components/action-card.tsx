import type { ReactNode } from "react";
import { SubmitButton } from "@/components/submit-button";

export function ActionCard({
  title,
  children,
  action,
  shopId,
  buttonLabel,
  pendingLabel,
  redirectTo,
}: {
  title: string;
  children?: ReactNode;
  action: (formData: FormData) => void | Promise<void>;
  shopId: number;
  buttonLabel: string;
  pendingLabel: string;
  // Where the action should redirect back to after running. Omitted on
  // /shops/connect (that action's own default); passed on /shops/[id] so the
  // same action lands the user back on the page it was triggered from.
  redirectTo?: string;
}) {
  return (
    <div className="rounded-lg border bg-white p-6">
      <h2 className="mb-2 text-lg font-semibold">{title}</h2>
      {children}
      <form action={action}>
        <input type="hidden" name="shop_id" value={shopId} />
        {redirectTo && <input type="hidden" name="redirect_to" value={redirectTo} />}
        <SubmitButton variant="secondary" pendingLabel={pendingLabel}>
          {buttonLabel}
        </SubmitButton>
      </form>
    </div>
  );
}
