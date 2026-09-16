import { db } from './index.ts';
import { merchants, products, orders, conversations, policyAuditLogs } from './schema.ts';
import { eq, desc } from 'drizzle-orm';

// Synchronize or get merchant record
export async function getOrCreateMerchant(uid: string, email: string, storeName?: string) {
  try {
    const existing = await db.select().from(merchants).where(eq(merchants.uid, uid)).limit(1);
    if (existing && existing.length > 0) {
      return existing[0];
    }
    const inserted = await db.insert(merchants).values({
      uid,
      email,
      storeName: storeName || 'Enterprise Commerce Store',
      activeFloorDiscountPct: 0.15,
    }).returning();
    return inserted[0];
  } catch (error) {
    console.error('Error in getOrCreateMerchant:', error);
    throw new Error('Failed to synchronize merchant', { cause: error });
  }
}

// Update merchant credentials (Shopify, Razorpay, WhatsApp)
export async function updateMerchantSettings(uid: string, updateData: Partial<typeof merchants.$inferInsert>) {
  try {
    const updated = await db.update(merchants)
      .set({ ...updateData, updatedAt: new Date() })
      .where(eq(merchants.uid, uid))
      .returning();
    return updated[0];
  } catch (error) {
    console.error('Error in updateMerchantSettings:', error);
    throw new Error('Failed to update merchant configuration', { cause: error });
  }
}

// Seed or fetch catalog products for a merchant
export async function getMerchantProducts(merchantUid: string) {
  try {
    const prods = await db.select().from(products).where(eq(products.merchantUid, merchantUid));
    return prods;
  } catch (error) {
    console.error('Error fetching merchant products:', error);
    throw new Error('Failed to fetch catalog', { cause: error });
  }
}

// Save or update an order
export async function saveOrderRecord(orderData: typeof orders.$inferInsert) {
  try {
    const inserted = await db.insert(orders)
      .values(orderData)
      .onConflictDoUpdate({
        target: orders.orderId,
        set: {
          status: orderData.status,
          razorpayOrderId: orderData.razorpayOrderId,
          razorpayPaymentId: orderData.razorpayPaymentId,
          razorpaySignature: orderData.razorpaySignature,
          paymentVerification: orderData.paymentVerification,
          updatedAt: new Date(),
        }
      })
      .returning();
    return inserted[0];
  } catch (error) {
    console.error('Error saving order record:', error);
    throw new Error('Failed to record order', { cause: error });
  }
}

// Fetch merchant orders
export async function getMerchantOrders(merchantUid: string) {
  try {
    return await db.select().from(orders).where(eq(orders.merchantUid, merchantUid)).orderBy(desc(orders.createdAt)).limit(50);
  } catch (error) {
    console.error('Error fetching merchant orders:', error);
    throw new Error('Failed to fetch orders', { cause: error });
  }
}

// Log a financial policy audit
export async function logPolicyAudit(auditData: typeof policyAuditLogs.$inferInsert) {
  try {
    const inserted = await db.insert(policyAuditLogs).values(auditData).returning();
    return inserted[0];
  } catch (error) {
    console.error('Error logging policy audit:', error);
    // Non-blocking log write
    return null;
  }
}

// Save or update conversation state
export async function saveConversation(convData: typeof conversations.$inferInsert) {
  try {
    const saved = await db.insert(conversations)
      .values(convData)
      .onConflictDoUpdate({
        target: conversations.sessionId,
        set: {
          messages: convData.messages,
          currentState: convData.currentState,
          updatedAt: new Date(),
        }
      })
      .returning();
    return saved[0];
  } catch (error) {
    console.error('Error saving conversation:', error);
    return null;
  }
}
