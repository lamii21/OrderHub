import { findOrderByOrderId, findMostRecentOrderForCustomer, type OrderForCustomer } from "./repository";

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
