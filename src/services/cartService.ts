/**
 * Multi-Item Shopping Cart Service
 * Manages customer session carts, line items, price calculation, bundle discounts, and conversion to IntentContract.
 */

import fs from "fs";
import path from "path";

export interface CartItem {
  product_id: string;
  name: string;
  price: number;
  quantity: number;
  image_url?: string;
  category?: string;
}

export interface CartSummary {
  session_id: string;
  items: CartItem[];
  subtotal: number;
  discount_amount: number;
  discount_label: string | null;
  delivery_charge: number;
  total_amount: number;
  currency: string;
  item_count: number;
}

const CARTS_FILE = path.resolve(process.cwd(), "carts.json");

// Persistent cart store per session
let carts: Record<string, CartItem[]> = {};

function loadCarts(): void {
  try {
    if (fs.existsSync(CARTS_FILE)) {
      const data = fs.readFileSync(CARTS_FILE, "utf-8");
      carts = JSON.parse(data);
    }
  } catch (err) {
    console.warn("Could not load carts.json, starting with empty store:", err);
    carts = {};
  }
}

function saveCarts(): void {
  try {
    fs.writeFileSync(CARTS_FILE, JSON.stringify(carts, null, 2), "utf-8");
  } catch (err) {
    console.error("Failed to save carts.json:", err);
  }
}

// Initial load
loadCarts();

export function getCart(sessionId: string): CartSummary {
  const items = carts[sessionId] || [];
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  // Advanced system design: Multi-item bundle discount rule (5% for 2+ items, 10% for 3+ items)
  let discount_amount = 0;
  let discount_label: string | null = null;
  if (itemCount >= 3) {
    discount_amount = Math.round(subtotal * 0.10);
    discount_label = "Autonomous Ecosystem Multi-Item Discount (10%)";
  } else if (itemCount >= 2) {
    discount_amount = Math.round(subtotal * 0.05);
    discount_label = "Bundle Pair Discount (5%)";
  }

  const delivery_charge = 0; // Free nationwide shipping
  const total_amount = Math.max(0, subtotal - discount_amount + delivery_charge);

  return {
    session_id: sessionId,
    items,
    subtotal,
    discount_amount,
    discount_label,
    delivery_charge,
    total_amount,
    currency: "INR",
    item_count: itemCount
  };
}

export function addToCart(
  sessionId: string,
  product: { product_id: string; name: string; price: number; image_url?: string; category?: string },
  quantity: number = 1,
  exactQuantity: boolean = false
): CartSummary {
  if (!carts[sessionId]) {
    carts[sessionId] = [];
  }

  const existing = carts[sessionId].find(i => i.product_id === product.product_id);
  if (existing) {
    if (exactQuantity) {
      existing.quantity = Math.max(1, quantity);
    } else {
      existing.quantity += quantity;
    }
    if (product.price && product.price > 0) {
      existing.price = product.price;
    }
  } else {
    carts[sessionId].push({
      product_id: product.product_id,
      name: product.name,
      price: product.price,
      quantity: Math.max(1, quantity),
      image_url: product.image_url,
      category: product.category
    });
  }

  saveCarts();
  return getCart(sessionId);
}

export function updateCartItemQuantity(
  sessionId: string,
  productId: string,
  quantity: number
): CartSummary {
  if (!carts[sessionId]) return getCart(sessionId);

  if (quantity <= 0) {
    carts[sessionId] = carts[sessionId].filter(i => i.product_id !== productId);
  } else {
    const item = carts[sessionId].find(i => i.product_id === productId);
    if (item) {
      item.quantity = quantity;
    }
  }

  saveCarts();
  return getCart(sessionId);
}

export function clearCart(sessionId: string): void {
  delete carts[sessionId];
  saveCarts();
}
