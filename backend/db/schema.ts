import { pgTable, serial, text, timestamp, doublePrecision, integer, boolean, jsonb } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Merchants / Store owners
export const merchants = pgTable('merchants', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(), // Firebase Auth UID
  email: text('email').notNull(),
  storeName: text('store_name').default('Default Store'),
  shopifyShopDomain: text('shopify_shop_domain'),
  shopifyAccessToken: text('shopify_access_token'),
  razorpayKeyId: text('razorpay_key_id'),
  razorpayKeySecret: text('razorpay_key_secret'),
  webhookSecret: text('webhook_secret'),
  whatsappPhoneNumberId: text('whatsapp_phone_number_id'),
  whatsappAccessToken: text('whatsapp_access_token'),
  activeFloorDiscountPct: doublePrecision('active_floor_discount_pct').default(0.15),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Products / Inventory
export const products = pgTable('products', {
  id: serial('id').primaryKey(),
  merchantUid: text('merchant_uid').notNull(),
  productId: text('product_id').notNull(),
  name: text('name').notNull(),
  description: text('description').default(''),
  category: text('category').default('General'),
  price: doublePrecision('price').notNull(),
  currency: text('currency').default('INR'),
  stock: integer('stock').default(10),
  tags: jsonb('tags').$type<string[]>().default([]),
  createdAt: timestamp('created_at').defaultNow(),
});

// Orders & cryptographic audit trails
export const orders = pgTable('orders', {
  id: serial('id').primaryKey(),
  orderId: text('order_id').notNull().unique(),
  merchantUid: text('merchant_uid').notNull(),
  customerEmail: text('customer_email'),
  channel: text('channel').default('web'),
  itemId: text('item_id').notNull(),
  itemName: text('item_name').notNull(),
  amount: doublePrecision('amount').notNull(),
  currency: text('currency').default('INR'),
  status: text('status').notNull().default('PENDING_PAYMENT'), // PENDING_PAYMENT, PAID, CANCELLED, FAILED
  razorpayOrderId: text('razorpay_order_id'),
  razorpayPaymentId: text('razorpay_payment_id'),
  razorpaySignature: text('razorpay_signature'),
  decisionProofHash: text('decision_proof_hash'),
  intentContract: jsonb('intent_contract'),
  paymentVerification: jsonb('payment_verification'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Conversations / Chat History per customer session
export const conversations = pgTable('conversations', {
  id: serial('id').primaryKey(),
  sessionId: text('session_id').notNull().unique(),
  merchantUid: text('merchant_uid').notNull(),
  customerIdentity: text('customer_identity'),
  channel: text('channel').default('web'), // web, whatsapp, shopify
  messages: jsonb('messages').$type<Array<{ sender: string; text: string; timestamp: string }>>().default([]),
  currentState: jsonb('current_state'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Policy Audit Trails (Financial Guardrail executions)
export const policyAuditLogs = pgTable('policy_audit_logs', {
  id: serial('id').primaryKey(),
  merchantUid: text('merchant_uid').notNull(),
  sessionId: text('session_id'),
  action: text('action').notNull(), // PRICE_ACCEPTED, DISCOUNT_CAPPED, BUNDLE_CROSS_SOLD, BELOW_FLOOR_REJECTED
  requestedPrice: doublePrecision('requested_price'),
  floorPrice: doublePrecision('floor_price'),
  finalPrice: doublePrecision('final_price'),
  hashProof: text('hash_proof'),
  signatures: jsonb('signatures').$type<Array<{ guardian: string; signature: string }>>(),
  createdAt: timestamp('created_at').defaultNow(),
});

// Relations
export const merchantsRelations = relations(merchants, ({ many }) => ({
  products: many(products),
  orders: many(orders),
  conversations: many(conversations),
  auditLogs: many(policyAuditLogs),
}));
