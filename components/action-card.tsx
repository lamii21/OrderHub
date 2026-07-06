import type { ReactNode } from "react";
import { SubmitButton } from "@/components/submit-button";

export function ActionCard({
  title,
  children,
  action,
  shopId,
  buttonLabel,
  pendingLabel,
}: {
  title: string;
  children?: ReactNode;
  action: (formData: FormData) => void | Promise<void>;
  shopId: number;
  buttonLabel: string;
  pendingLabel: string;
}) {
  return (
    <div className="rounded-lg border bg-white p-6">
      <h2 className="mb-2 text-lg font-semibold">{title}</h2>
      {children}
      <form action={action}>
        <input type="hidden" name="shop_id" value={shopId} />
        <SubmitButton variant="secondary" pendingLabel={pendingLabel}>
          {buttonLabel}
        </SubmitButton>
      </form>
    </div>
  );
}
