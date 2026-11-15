export const RETURN_STATUSES = Object.freeze([
  'requested', 'under_review', 'approved', 'rejected', 'received', 'completed', 'cancelled'
]);

const transitions = Object.freeze({
  requested: new Set(['under_review', 'approved', 'rejected', 'cancelled']),
  under_review: new Set(['approved', 'rejected', 'cancelled']),
  approved: new Set(['received', 'cancelled']),
  received: new Set(['completed']),
  rejected: new Set(),
  completed: new Set(),
  cancelled: new Set()
});

export function canTransitionReturnStatus(from, to) {
  return Boolean(transitions[from]?.has(to));
}

export function validateReturnItems(requestedItems, orderItems, requestType) {
  if (!Array.isArray(requestedItems) || requestedItems.length < 1 || requestedItems.length > 20) {
    throw new TypeError('Select between 1 and 20 order items');
  }
  if (!['return', 'exchange'].includes(requestType)) throw new TypeError('Invalid request type');
  const byId = new Map(orderItems.map(item => [item.id, item]));
  const seen = new Set();
  return requestedItems.map(item => {
    if (!item || typeof item.order_item_id !== 'string' || seen.has(item.order_item_id)) {
      throw new TypeError('Each selected order item must be unique and valid');
    }
    seen.add(item.order_item_id);
    const original = byId.get(item.order_item_id);
    if (!original) throw new TypeError('Selected item does not belong to this order');
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > Number(original.quantity)) {
      throw new RangeError('Requested quantity exceeds the purchased quantity');
    }
    const requestedSize = String(item.requested_size || '').trim();
    if (requestType === 'exchange' && !requestedSize) throw new TypeError('Enter the requested exchange size');
    if (requestedSize.length > 40) throw new TypeError('Requested size is too long');
    return { order_item_id: original.id, quantity: item.quantity, requested_size: requestType === 'exchange' ? requestedSize : '' };
  });
}

export const RETURN_WINDOW_MS = 24 * 60 * 60 * 1000;

export function isWithinReturnWindow(deliveredAt, now = Date.now()) {
  const deliveredTime = new Date(deliveredAt).getTime();
  const currentTime = Number(now);
  return Number.isFinite(deliveredTime) &&
    Number.isFinite(currentTime) &&
    currentTime >= deliveredTime &&
    currentTime <= deliveredTime + RETURN_WINDOW_MS;
}
