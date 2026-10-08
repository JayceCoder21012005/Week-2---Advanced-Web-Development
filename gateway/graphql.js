import { createSchema, createYoga } from 'graphql-yoga';
import DataLoader from 'dataloader';
import { createClients } from './clients.js';
import { httpError } from '../shared/contract.js';

const typeDefs = /* GraphQL */ `
  type Query { user(id: ID!): User }
  type User { id: ID! name: String! email: String! orders: [Order!]! }
  type Order { id: ID! qty: Int! unitPrice: Float! status: String! createdAt: String! product: Product }
  type Product { id: ID! name: String! price: Float! thumbnail: String! }
`;

/** mode: 'naive' (tái hiện N+1) | 'loader' (DataLoader: batch + dedup trong 1 request). */
export function createGraphQL({ urls, mode }) {
  const resolvers = {
    Query: {
      user: async (_, { id }, ctx) => {
        try { return await ctx.clients.getUser(id); }
        catch (e) { if (e.status === 404) return null; throw e; }
      },
    },
    User: {
      orders: (user, _, ctx) => ctx.clients.getOrdersByUser(user.id),
    },
    Order: {
      product: (order, _, ctx) => (mode === 'naive'
        ? ctx.clients.getProduct(order.productId)        // N đơn → N call
        : ctx.productLoader.load(order.productId)),      // N đơn → 1 call
    },
  };

  return createYoga({
    schema: createSchema({ typeDefs, resolvers }),
    maskedErrors: false, // giữ message thật ("/products → HTTP 503") để đánh dấu lỗi
    context: ({ request }) => {
      const clients = createClients(request.headers.get('x-request-id'), urls);
      // Loader mới cho MỖI request: dedup/cache chỉ sống trong request này.
      const productLoader = new DataLoader(async (ids) => {
        const byId = new Map((await clients.getProductsByIds(ids)).map((p) => [p.id, p]));
        // Error trong mảng kết quả → chỉ load() của id đó bị reject (giống 404 của naive/baseline).
        return ids.map((id) => byId.get(id) ?? httpError(`/products/${id}`, 404));
      });
      return { clients, productLoader };
    },
  });
}
