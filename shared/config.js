export const PORTS = { gateway: 4000, user: 4001, order: 4002, product: 4003 };
export const urlOf = (name) => `http://localhost:${PORTS[name]}`;
export const SERVICE_URLS = { user: urlOf('user'), order: urlOf('order'), product: urlOf('product') };
