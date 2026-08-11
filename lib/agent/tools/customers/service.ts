import { getCustomerStats, type CustomerStats } from "./repository";

export type CustomerStatsResult = { found: true; stats: CustomerStats } | { found: false };

// customerId is required here, not optional — same reasoning as
// tools/orders/service.ts's getOrderStatusForCustomer: "which customer" is
// a precondition this function assumes already resolved, not a business
// rule it encodes itself.
export async function getCustomerStatsForCustomer(shopId: number, customerId: number): Promise<CustomerStatsResult> {
  const stats = await getCustomerStats(shopId, customerId);

  return stats ? { found: true, stats } : { found: false };
}
