import {
  findOrderByOrderId,
  findMostRecentOrderForCustomer,
  searchOrdersForCustomer as searchOrdersForCustomerRepo,
  type OrderForCustomer,
  type OrderSearchFilters,
} from "./repository";

export type OrderStatusResult = { found: true; order: OrderForCustomer } | { found: false };

// customerId is required here, not optional — "which customer is asking"
// is a precondition this function assumes already resolved. Deciding what
// to do when a conversation has no identified customer yet is a
// conversational-UX concern (tool.ts's job, since it shapes what the model
// sees), not a business rule this service should encode — a future caller
// with a customer already logged in (e.g. a self-service order tracking
// page) always has one, and shouldn't need to route around a null-handling
// branch that only makes sense for a chat conversation.
export async function getOrderStatusForCustomer(
  shopId: number,
  customerId: number,
  orderId?: string
): Promise<OrderStatusResult> {
  const order = orderId
    ? await findOrderByOrderId(shopId, customerId, orderId)
    : await findMostRecentOrderForCustomer(shopId, customerId);

  return order ? { found: true, order } : { found: false };
}

// Caps results at a small, fixed count — same reasoning as
// tools/products/service.ts's DEFAULT_SEARCH_RESULT_LIMIT: every order this
// returns is serialized into the next prompt, and a long list is no more
// useful to a customer in a chat than a short one.
export const DEFAULT_ORDER_SEARCH_LIMIT = 5;

export async function searchOrdersForCustomer(
  shopId: number,
  customerId: number,
  filters: OrderSearchFilters
): Promise<{ orders: OrderForCustomer[] }> {
  const orders = await searchOrdersForCustomerRepo(shopId, customerId, filters, DEFAULT_ORDER_SEARCH_LIMIT);
  return { orders };
}
