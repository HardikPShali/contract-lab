import type { ContractState, Schema } from "./types.ts";

const MIN = 60_000;

const lineItem: Schema = {
  type: "object",
  required: ["sku", "qty"],
  properties: { sku: { type: "string" }, qty: { type: "integer", minimum: 1 } },
};

const address: Schema = {
  type: "object",
  properties: { line1: { type: "string" }, city: { type: "string" }, postcode: { type: "string" } },
};

const orderV1: Schema = {
  type: "object",
  required: ["id", "status", "total", "items"],
  properties: {
    id: { type: "string", example: "ord_9812" },
    status: { type: "string", enum: ["pending", "confirmed", "shipped", "cancelled"] },
    total: { type: "number" },
    items: { type: "array", items: lineItem },
    shippingAddress: address,
  },
};

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function createSeed(now: Date = new Date()): ContractState {
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
  const user = "Hardik Shali";

  const orderV2 = clone(orderV1);
  orderV2.properties!.currency = { type: "string", enum: ["EUR", "USD"] };

  return {
    schema: 1,
    project: { name: "Northstar API", service: "orders-service", branch: "feature/order-v2", baseVersion: "v1.8.2", user },
    endpoints: [
      {
        id: "create-order", method: "POST", path: "/v1/orders", label: "Create order",
        current: {
          status: 201,
          request: {
            type: "object",
            required: ["customerId", "items"],
            properties: {
              customerId: { type: "string" },
              items: { type: "array", items: lineItem },
              couponCode: { type: "string" },
              notes: { type: "string", maxLength: 500 },
            },
          },
          response: orderV1,
        },
        proposed: {
          status: 201,
          request: {
            type: "object",
            required: ["customerId", "items", "currency"],
            properties: {
              customerId: { type: "string", format: "uuid" },
              items: { type: "array", minItems: 1, items: lineItem },
              currency: { type: "string", enum: ["EUR", "USD"] },
              notes: { type: "string", maxLength: 500 },
              metadata: { type: "object" },
            },
          },
          response: orderV2,
        },
      },
      {
        id: "get-order", method: "GET", path: "/v1/orders/{id}", label: "Get order",
        current: { status: 200, response: orderV1 },
        proposed: { status: 200, response: orderV2 },
      },
      {
        id: "update-order", method: "PATCH", path: "/v1/orders/{id}", label: "Update order",
        current: {
          status: 200,
          request: { type: "object", properties: { status: { type: "string", enum: ["confirmed", "shipped", "cancelled"] }, shippingAddress: address } },
          response: orderV1,
        },
        proposed: {
          status: 200,
          request: { type: "object", properties: { status: { type: "string", enum: ["confirmed", "cancelled"] }, deliveryAddress: address } },
          response: (() => {
            const r = clone(orderV2);
            delete r.properties!.shippingAddress;
            r.properties!.deliveryAddress = address;
            return r;
          })(),
        },
      },
      {
        id: "list-customers", method: "GET", path: "/v1/customers", label: "List customers",
        current: {
          status: 200,
          response: {
            type: "object", required: ["data"],
            properties: { data: { type: "array", items: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, email: { type: "string", format: "email" } } } }, nextCursor: { type: "string" } },
          },
        },
        proposed: {
          status: 200,
          response: {
            type: "object", required: ["data"],
            properties: { data: { type: "array", items: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, email: { type: "string", format: "email" }, tier: { type: "string", enum: ["standard", "plus"] } } } }, nextCursor: { type: "string" } },
          },
        },
      },
      {
        id: "create-refund", method: "POST", path: "/v1/refunds", label: "Create refund",
        current: {
          status: 201,
          request: { type: "object", required: ["orderId", "amount"], properties: { orderId: { type: "string" }, amount: { type: "number", minimum: 0.01, maximum: 500 }, reason: { type: "string", enum: ["duplicate", "damaged"] } } },
          response: { type: "object", required: ["id", "status"], properties: { id: { type: "string", example: "rf_10892" }, status: { type: "string", enum: ["accepted", "pending_review"] } } },
        },
        proposed: {
          status: 201,
          request: { type: "object", required: ["orderId", "amount"], properties: { orderId: { type: "string" }, amount: { type: "number", minimum: 0.01, maximum: 1000 }, reason: { type: "string", enum: ["duplicate", "damaged", "fraud"] } } },
          response: { type: "object", required: ["id", "status"], properties: { id: { type: "string", example: "rf_10892" }, status: { type: "string", enum: ["accepted", "pending_review"] } } },
        },
      },
      {
        id: "get-invoice", method: "GET", path: "/v1/invoices/{id}", label: "Get invoice",
        current: { status: 200, response: { type: "object", required: ["id", "amount"], properties: { id: { type: "string" }, amount: { type: "number" }, pdfUrl: { type: "string", format: "uri" } } } },
        proposed: { status: 200, response: { type: "object", required: ["id", "amount"], properties: { id: { type: "string" }, amount: { type: "number" }, pdfUrl: { type: "string", format: "uri" } } } },
      },
    ],
    consumers: [
      {
        id: "checkout-web", name: "checkout-web", owner: "Payments UI", lastCall: ago(47_000),
        uses: [
          { endpointId: "create-order", sends: ["customerId", "items", "couponCode"], reads: ["id", "status", "total"] },
          { endpointId: "get-order", sends: [], reads: ["status", "total", "items"] },
        ],
      },
      {
        id: "mobile-app", name: "mobile-app", owner: "Mobile", lastCall: ago(3 * MIN),
        uses: [
          { endpointId: "create-order", sends: ["customerId", "items", "notes"], reads: ["id", "status"] },
          { endpointId: "update-order", sends: ["status", "shippingAddress"], reads: ["status", "shippingAddress"] },
        ],
      },
      {
        id: "warehouse-sync", name: "warehouse-sync", owner: "Fulfilment", lastCall: ago(12 * MIN),
        uses: [
          { endpointId: "update-order", sends: ["status"], reads: ["status"] },
          { endpointId: "get-order", sends: [], reads: ["items", "shippingAddress"] },
        ],
      },
      {
        id: "support-console", name: "support-console", owner: "Support tools", lastCall: ago(2 * 3_600_000),
        uses: [
          { endpointId: "list-customers", sends: [], reads: ["data[].name", "data[].email"] },
          { endpointId: "create-refund", sends: ["orderId", "amount", "reason"], reads: ["id", "status"] },
          { endpointId: "get-invoice", sends: [], reads: ["pdfUrl"] },
        ],
      },
    ],
    acks: {},
    notified: {},
    history: [
      { id: "h1", at: ago(25 * MIN), actor: "Leo Park", kind: "edit", summary: "Leo edited POST /v1/orders", detail: "Request schema: currency required, customerId must be a UUID" },
      { id: "h2", at: ago(70 * MIN), actor: "Leo Park", kind: "edit", summary: "Leo edited PATCH /v1/orders/{id}", detail: "Renamed shippingAddress to deliveryAddress" },
      { id: "h3", at: ago(26 * 3_600_000), actor: "Maya Chen", kind: "merge", summary: "Maya merged release v1.8.2", detail: "3 endpoints changed, no breaking changes" },
    ],
    requests: [],
  };
}
