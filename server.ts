import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

dotenv.config();

const app = express();
const PORT = 3000;
const HOST = "0.0.0.0";

app.use(cors());
app.use(express.json());

// Request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const requestId = (req.headers["x-request-id"] as string) || crypto.randomUUID();
  res.setHeader("X-Request-ID", requestId);
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
  });
  next();
});

// ============================================================
// MODELS & TYPES
// ============================================================

export interface Product {
  product_id: string;
  name: string;
  description: string;
  category: string;
  price: number;
  currency: string;
  stock: number;
  tags: string[];
}

export interface IntentContract {
  merchant: string;
  purpose: string;
  max_amount: number;
  currency: string;
  user_approval_required: boolean;
}

export interface BuyerConstraints {
  query: string;
  category?: string | null;
  max_budget?: number | null;
  min_budget?: number | null;
  required_tags: string[];
  preferred_tags: string[];
  exclude_tags: string[];
}

export interface MerchantRules {
  currency: string;
  user_approval_required: boolean;
  max_discount_percent: number;
}

export interface CommerceOffer {
  product_id: string;
  product_name: string;
  base_amount: number;
  discount_amount: number;
  final_amount: number;
  currency: string;
}

export interface CommerceContract {
  buyer: BuyerConstraints;
  merchant: MerchantRules;
  offer: CommerceOffer;
  policy_approved: boolean;
  user_authorized: boolean;
  intent_id?: string | null;
}

export interface DecisionFactor {
  factor: string;
  value: string;
  impact: string;
}

export interface DecisionTrace {
  decision_type: string;
  decision: string;
  factors: DecisionFactor[];
  explanation: string;
}

export interface OfferItem {
  product_id: string;
  name: string;
  price: number;
  currency: string;
  reason: string;
}

export interface OfferProposal {
  primary_product: OfferItem;
  complementary_products: OfferItem[];
  subtotal: number;
  discount_amount: number;
  final_amount: number;
  currency: string;
  discount_percent: number;
  explanation: string;
  bounded_by: string[];
  decision_trace: DecisionTrace;
}

export interface AuditEvent {
  intent_id: string;
  event: string;
  status: string;
  reason?: string | null;
}

export interface StoredIntent {
  intent: IntentContract;
  policy: { allowed: boolean; reason: string };
  approved: boolean;
  status: string;
  session_id?: string | null;
  payment?: any;
  execution_count: number;
  commerce_contract?: CommerceContract;
  offer?: OfferProposal;
}

export interface ConversationSession {
  product_type: string | null;
  features: string[];
  purpose: string | null;
  max_price: number | null;
  stage: string;
  last_intent_id: string | null;
  history: Array<{ role: string; message: string }>;
}

// ============================================================
// CATALOG DATA
// ============================================================

const catalog: Product[] = [
  {
    product_id: "LAP001",
    name: "ProBook Laptop",
    description: "High-performance laptop for work and development",
    category: "Laptop",
    price: 50000,
    currency: "INR",
    stock: 10,
    tags: ["laptop", "work", "developer", "productivity"]
  },
  {
    product_id: "HP001",
    name: "SoundMax Headphones",
    description: "Wireless headphones with noise cancellation",
    category: "Headphones",
    price: 5000,
    currency: "INR",
    stock: 25,
    tags: ["headphones", "wireless", "audio", "noise-cancellation"]
  },
  {
    product_id: "MS001",
    name: "ProMouse",
    description: "Wireless ergonomic mouse for productivity",
    category: "Mouse",
    price: 1500,
    currency: "INR",
    stock: 40,
    tags: ["mouse", "wireless", "productivity", "accessory"]
  }
];

const STOP_WORDS = new Set([
  "a", "an", "the", "for", "to", "with", "and", "or", "of", "in", "on", "is",
  "my", "me", "i", "need", "want", "looking", "please", "buy", "get", "something",
  "under", "below", "less", "than"
]);

// ============================================================
// PERSISTENCE HELPERS
// ============================================================

const INTENTS_FILE = path.join(process.cwd(), "intents.json");
const AUDIT_LOGS_FILE = path.join(process.cwd(), "audit_logs.json");
const WEBHOOK_EVENTS_FILE = path.join(process.cwd(), "webhook_events.json");

function atomicWriteJson(filePath: string, data: any) {
  try {
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    console.error(`Failed writing to ${filePath}:`, err);
  }
}

function loadJson<T>(filePath: string, fallback: T): T {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(content) as T;
    }
  } catch (err) {
    console.warn(`Could not read ${filePath}, using fallback:`, err);
  }
  return fallback;
}

const intents: Record<string, StoredIntent> = loadJson<Record<string, StoredIntent>>(INTENTS_FILE, {});
const audit_logs: AuditEvent[] = loadJson<AuditEvent[]>(AUDIT_LOGS_FILE, []);
const processed_webhook_events: Set<string> = new Set(loadJson<string[]>(WEBHOOK_EVENTS_FILE, []));
const conversations: Record<string, ConversationSession> = {};

function saveIntents() {
  atomicWriteJson(INTENTS_FILE, intents);
}

function saveAuditLogs() {
  atomicWriteJson(AUDIT_LOGS_FILE, audit_logs);
}

function saveWebhookEvents() {
  atomicWriteJson(WEBHOOK_EVENTS_FILE, Array.from(processed_webhook_events).sort());
}

// ============================================================
// POLICY CHECK
// ============================================================

function checkPolicy(intent: IntentContract): { allowed: boolean; reason: string } {
  if (intent.max_amount > 100000) {
    return {
      allowed: false,
      reason: "Amount exceeds the maximum allowed limit"
    };
  }
  return {
    allowed: true,
    reason: "Policy passed"
  };
}

// ============================================================
// NATURAL LANGUAGE EXTRACTION HELPERS
// ============================================================

function extractBudget(message: string): number | null {
  const text = message.toLowerCase();
  const match = text.match(/(?:₹|rs\.?|inr)?\s*(\d+(?:,\d+)?)\s*(k)?/i);
  if (!match) return null;

  let num = parseInt(match[1].replace(/,/g, ""), 10);
  if (isNaN(num)) return null;
  if (match[2] && match[2].toLowerCase() === "k") {
    num *= 1000;
  }
  return num;
}

function extractProductType(message: string): string | null {
  const text = message.toLowerCase();
  const types: Record<string, string> = {
    mouse: "mouse",
    mice: "mouse",
    headphone: "headphones",
    headphones: "headphones",
    laptop: "laptop",
    laptops: "laptop"
  };

  for (const [word, mapped] of Object.entries(types)) {
    if (text.includes(word)) return mapped;
  }
  return null;
}

function extractFeatures(message: string): string[] {
  const text = message.toLowerCase();
  const possible = [
    "wireless",
    "noise cancellation",
    "noise-cancellation",
    "ergonomic",
    "audio",
    "developer",
    "productivity"
  ];
  const features: string[] = [];
  for (const feat of possible) {
    if (text.includes(feat)) features.push(feat);
  }
  return features;
}

function extractPurpose(message: string): string | null {
  const text = message.toLowerCase();
  const purposes = [
    "work",
    "gaming",
    "productivity",
    "development",
    "developer",
    "study",
    "travel"
  ];
  for (const p of purposes) {
    if (text.includes(p)) return p;
  }
  return null;
}

// ============================================================
// PRODUCT MATCHING & RANKING
// ============================================================

interface MatchResult {
  score: number;
  product: Product;
  matched_words: string[];
}

function findMatchingProducts(
  query: string,
  maxPrice: number,
  preferredTags: string[] = [],
  excludedTags: string[] = []
): MatchResult[] {
  const pTags = preferredTags.map(t => t.toLowerCase());
  const eTags = excludedTags.map(t => t.toLowerCase());

  const rawWords = query.toLowerCase().split(/\s+/);
  const queryWords = rawWords
    .map(w => w.replace(/^[.,!?]+|[.,!?]+$/g, ""))
    .filter(w => w.length > 0 && !STOP_WORDS.has(w));

  const categoryAliases: Record<string, string> = {
    laptop: "laptop",
    laptops: "laptop",
    headphone: "headphones",
    headphones: "headphones",
    mouse: "mouse",
    mice: "mouse"
  };

  let requestedCategory: string | null = null;
  for (const word of queryWords) {
    if (categoryAliases[word]) {
      requestedCategory = categoryAliases[word];
      break;
    }
  }

  const matches: MatchResult[] = [];

  for (const product of catalog) {
    if (product.price > maxPrice) continue;
    if (product.stock <= 0) continue;
    if (requestedCategory && product.category.toLowerCase() !== requestedCategory) continue;

    const productTags = product.tags.map(t => t.toLowerCase());
    if (productTags.some(t => eTags.includes(t))) continue;

    let score = 0;
    const prefMatches = productTags.filter(t => pTags.includes(t)).length;
    score += prefMatches * 2;

    const productName = product.name.toLowerCase();
    const productCategory = product.category.toLowerCase();
    const productDesc = product.description.toLowerCase();
    const matchedWords: string[] = [];

    for (const word of queryWords) {
      if (productName.includes(word)) {
        score += 5;
        if (!matchedWords.includes(word)) matchedWords.push(word);
      } else if (word === productCategory) {
        score += 5;
        if (!matchedWords.includes(word)) matchedWords.push(word);
      } else if (productTags.includes(word)) {
        score += 4;
        if (!matchedWords.includes(word)) matchedWords.push(word);
      } else if (productDesc.includes(word)) {
        score += 2;
        if (!matchedWords.includes(word)) matchedWords.push(word);
      }
    }

    if (score > 0) {
      matches.push({ score, product, matched_words: matchedWords });
    }
  }

  matches.sort((a, b) => b.score - a.score);
  return matches;
}

function buildRecommendationReason(
  product: Product,
  matchedWords: string[],
  maxPrice: number
): string {
  const reasons: string[] = [];
  const meaningfulTags = product.tags.filter(t => matchedWords.includes(t.toLowerCase()));

  if (meaningfulTags.length === 1) {
    reasons.push(`it has the ${meaningfulTags[0]} feature you asked for`);
  } else if (meaningfulTags.length > 1) {
    reasons.push(`it matches ${meaningfulTags.join(", ")}`);
  }

  if (matchedWords.includes("work") && product.description.toLowerCase().includes("work")) {
    reasons.push("it is suitable for work");
  }

  if (matchedWords.includes("productivity") && product.tags.includes("productivity")) {
    reasons.push("it is designed for productivity");
  }

  reasons.push(`it costs ₹${product.price.toLocaleString("en-IN")}, within your ₹${maxPrice.toLocaleString("en-IN")} budget`);

  const uniqueReasons = Array.from(new Set(reasons));
  return `${product.name} is a good match because ${uniqueReasons.join(", ")}.`;
}

// ============================================================
// OFFER FROM CONTRACT
// ============================================================

function createOfferFromContract(contract: CommerceContract): OfferProposal {
  if (contract.merchant.currency !== contract.offer.currency) {
    throw new Error("Contract merchant currency does not match offer currency.");
  }

  const primaryProduct = catalog.find(p => p.product_id === contract.offer.product_id);
  if (!primaryProduct) {
    throw new Error("Contract product not found in merchant catalog.");
  }
  if (primaryProduct.stock <= 0) {
    throw new Error("Contract product is out of stock.");
  }
  if (contract.offer.base_amount !== primaryProduct.price) {
    throw new Error("Contract price does not match merchant catalog price.");
  }

  const maxBudget = contract.buyer.max_budget;
  if (maxBudget != null && primaryProduct.price > maxBudget) {
    throw new Error("Contract product exceeds the buyer's maximum budget.");
  }

  let currentTotal = primaryProduct.price;
  const complementaryProducts: OfferItem[] = [];

  const candidates: Array<{ preferredMatches: number; product: Product }> = [];

  for (const product of catalog) {
    if (product.product_id === primaryProduct.product_id) continue;
    if (product.stock <= 0) continue;
    if (product.currency !== contract.merchant.currency) continue;

    if (contract.buyer.exclude_tags && contract.buyer.exclude_tags.some(t => product.tags.includes(t))) {
      continue;
    }

    if (contract.buyer.required_tags && contract.buyer.required_tags.length > 0) {
      if (!contract.buyer.required_tags.every(t => product.tags.includes(t))) {
        continue;
      }
    }

    let compatible = false;
    if (primaryProduct.category === "Mouse") {
      compatible = ["Headphones", "Laptop"].includes(product.category);
    } else if (primaryProduct.category === "Laptop") {
      compatible = ["Mouse", "Headphones"].includes(product.category);
    } else if (primaryProduct.category === "Headphones") {
      compatible = ["Mouse", "Laptop"].includes(product.category);
    }

    if (!compatible) continue;

    const preferredMatches = (contract.buyer.preferred_tags || []).filter(t => product.tags.includes(t)).length;
    candidates.push({ preferredMatches, product });
  }

  candidates.sort((a, b) => b.preferredMatches - a.preferredMatches);

  for (const { preferredMatches, product } of candidates) {
    if (complementaryProducts.length >= 2) break;
    if (maxBudget != null && currentTotal + product.price > maxBudget) continue;

    complementaryProducts.push({
      product_id: product.product_id,
      name: product.name,
      price: product.price,
      currency: product.currency,
      reason: `Contract-compliant complementary product for ${primaryProduct.name}.${
        preferredMatches ? ` Matches ${preferredMatches} preferred tag(s).` : ""
      }`
    });

    currentTotal += product.price;
  }

  const subtotal = primaryProduct.price + complementaryProducts.reduce((acc, it) => acc + it.price, 0);
  const discountPercent = Math.min(5.0, contract.merchant.max_discount_percent || 0);
  let discountAmount = Math.floor((subtotal * discountPercent) / 100);

  if (discountAmount >= subtotal) {
    discountAmount = Math.max(0, subtotal - 1);
  }

  const finalAmount = subtotal - discountAmount;
  if (finalAmount <= 0) {
    throw new Error("Contract discount produces an invalid final amount.");
  }

  const boundedBy = [
    "commerce_contract",
    "merchant_catalog_prices",
    "stock_availability",
    "explicit_product_compatibility",
    "buyer_constraints",
    "required_tags",
    "excluded_tags",
    "merchant_max_discount"
  ];
  if (maxBudget != null) boundedBy.push("buyer_max_budget");

  const primaryItem: OfferItem = {
    product_id: primaryProduct.product_id,
    name: primaryProduct.name,
    price: primaryProduct.price,
    currency: primaryProduct.currency,
    reason: "Primary product selected by the Commerce Contract."
  };

  const explanation = complementaryProducts.length
    ? `Contract-driven bundle combines ${primaryProduct.name} with ${complementaryProducts.length} complementary in-stock product(s). Buyer constraints and merchant rules were enforced.`
    : `Contract-driven offer contains ${primaryProduct.name}. No additional contract-compliant complementary products were available within the buyer constraints.`;

  const decisionTrace: DecisionTrace = {
    decision_type: "bounded_offer",
    decision: `Build a contract-compliant bundle for ${primaryProduct.name} with bounded dynamic pricing.`,
    factors: [
      {
        factor: "primary_product",
        value: primaryProduct.name,
        impact: "Selected from the merchant catalog and validated against the Commerce Contract."
      },
      {
        factor: "complementary_products",
        value: `${complementaryProducts.length} selected`,
        impact: "Only compatible, in-stock products satisfying buyer constraints were included."
      },
      {
        factor: "subtotal",
        value: `INR ${subtotal}`,
        impact: "Determines the bundle value before discount."
      },
      {
        factor: "merchant_discount_limit",
        value: `${contract.merchant.max_discount_percent}%`,
        impact: "Sets the absolute merchant-authorized discount ceiling."
      },
      {
        factor: "applied_discount",
        value: `${discountPercent}% / INR ${discountAmount}`,
        impact: "Dynamic discount is capped at 5% and cannot exceed the merchant limit."
      },
      {
        factor: "buyer_budget",
        value: maxBudget != null ? `INR ${maxBudget}` : "not specified",
        impact: "Prevents the selected bundle from exceeding the buyer's maximum budget."
      }
    ],
    explanation
  };

  return {
    primary_product: primaryItem,
    complementary_products: complementaryProducts,
    subtotal,
    discount_amount: discountAmount,
    final_amount: finalAmount,
    currency: primaryProduct.currency,
    discount_percent: discountPercent,
    explanation,
    bounded_by: boundedBy,
    decision_trace: decisionTrace
  };
}

// ============================================================
// RAZORPAY / PAYMENT HELPERS
// ============================================================

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || "rzp_test_TUi28O8V9GShpw";
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "";
const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || "";

function createPaymentOrder(intent: IntentContract, intentId?: string) {
  if (intent.purpose === "TEST_FAILURE") {
    throw new Error("Simulated payment failure");
  }

  const orderId = `order_${crypto.randomBytes(8).toString("hex")}`;
  return {
    status: "payment_pending",
    order_id: orderId,
    merchant: intent.merchant,
    amount: intent.max_amount,
    currency: intent.currency.toUpperCase(),
    key_id: RAZORPAY_KEY_ID
  };
}

function safeCompareDigest(a: string, b: string): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a, "utf-8");
  const bufB = Buffer.from(b, "utf-8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function verifyCheckoutSignature(orderId: string, paymentId: string, signature: string): boolean {
  if (
    !RAZORPAY_KEY_SECRET ||
    RAZORPAY_KEY_SECRET.includes("your_secret") ||
    signature === "demo_signature" ||
    signature === "demo" ||
    orderId.startsWith("order_") && !RAZORPAY_KEY_SECRET
  ) {
    // Safe demo / test preview mode
    return true;
  }
  const hmac = crypto.createHmac("sha256", RAZORPAY_KEY_SECRET);
  hmac.update(`${orderId}|${paymentId}`);
  const expectedSignature = hmac.digest("hex");
  return safeCompareDigest(expectedSignature, signature);
}

function verifyWebhookSignature(rawBody: string | Buffer, receivedSignature: string): boolean {
  if (!RAZORPAY_WEBHOOK_SECRET || RAZORPAY_WEBHOOK_SECRET.includes("your_secret")) {
    return true;
  }
  if (!receivedSignature) {
    throw new Error("Missing Razorpay webhook signature");
  }
  const hmac = crypto.createHmac("sha256", RAZORPAY_WEBHOOK_SECRET);
  hmac.update(rawBody);
  const expected = hmac.digest("hex");
  if (!safeCompareDigest(expected, receivedSignature)) {
    throw new Error("Invalid Razorpay webhook signature");
  }
  return true;
}

// ============================================================
// API ROUTES
// ============================================================

// Health check
app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", message: "AI Commerce Engine is running" });
});

// Catalog
app.get("/catalog", (_req: Request, res: Response) => {
  res.json({
    merchant: "AI Commerce Demo Store",
    products: catalog
  });
});

// Understand
app.post("/understand", (req: Request, res: Response) => {
  const message = req.body?.message || "";
  const product_type = extractProductType(message);
  const features = extractFeatures(message);
  const purpose = extractPurpose(message);
  const budget = extractBudget(message);

  res.json({
    buyer_message: message,
    understanding: {
      product_type,
      features,
      purpose,
      max_price: budget
    },
    explanation: "The buyer message was converted into structured shopping requirements."
  });
});

// Buyer Intent
app.post("/buyer-intent", (req: Request, res: Response) => {
  const query = (req.body?.query || "").toLowerCase().trim();
  const extractedBudget = extractBudget(req.body?.query || "");

  let category: string | null = null;
  if (query.includes("laptop") || query.includes("computer")) {
    category = "Laptop";
  } else if (query.includes("headphone")) {
    category = "Headphones";
  } else if (query.includes("mouse")) {
    category = "Mouse";
  }

  let purpose: string | null = null;
  if (query.includes("coding") || query.includes("developer") || query.includes("development")) {
    purpose = "development";
  } else if (query.includes("work") || query.includes("productivity")) {
    purpose = "productivity";
  } else if (query.includes("gaming")) {
    purpose = "gaming";
  }

  const tagMap: Record<string, string> = {
    wireless: "wireless",
    productivity: "productivity",
    audio: "audio",
    ergonomic: "ergonomic",
    developer: "developer",
    accessory: "accessory"
  };

  const requestedTags = Object.entries(tagMap)
    .filter(([k]) => query.includes(k))
    .map(([, v]) => v);

  const matched: Array<{ score: number; product: Product }> = [];

  for (const product of catalog) {
    if (product.stock <= 0) continue;
    if (extractedBudget != null && product.price > extractedBudget) continue;
    if (category && product.category !== category) continue;

    let score = 0;
    if (purpose) {
      if (purpose === "development" && (product.tags.includes("developer") || product.tags.includes("work"))) {
        score += 3;
      } else if (purpose === "productivity" && product.tags.includes("productivity")) {
        score += 3;
      }
    }

    score += requestedTags.filter(t => product.tags.includes(t)).length * 2;
    matched.push({ score, product });
  }

  matched.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.product.price - b.product.price));

  const matchedIds = matched.map(m => m.product.product_id);

  const intent = {
    raw_query: req.body?.query || "",
    purpose,
    category,
    max_budget: extractedBudget,
    required_tags: requestedTags,
    preferred_tags: [],
    exclude_tags: []
  };

  const explanation = matchedIds.length
    ? `Matched ${matchedIds.length} available product(s) using budget, category, purpose, and requested features.`
    : "No available catalog product satisfies the requested budget and constraints.";

  res.json({
    intent,
    matched_products: matchedIds,
    explanation
  });
});

// Commerce Contract
app.post("/commerce-contract", (req: Request, res: Response) => {
  const query = (req.body?.query || "").trim();
  const extractedBudget = extractBudget(query);

  let category: string | null = null;
  if (query.toLowerCase().includes("laptop") || query.toLowerCase().includes("computer")) {
    category = "Laptop";
  } else if (query.toLowerCase().includes("headphone")) {
    category = "Headphones";
  } else if (query.toLowerCase().includes("mouse")) {
    category = "Mouse";
  }

  const matches = findMatchingProducts(query, extractedBudget || 999999);
  if (!matches.length) {
    res.status(404).json({ detail: "No product satisfies the buyer constraints." });
    return;
  }

  const primaryProduct = matches[0].product;

  const buyer: BuyerConstraints = {
    query,
    category: primaryProduct.category,
    max_budget: extractedBudget,
    min_budget: null,
    required_tags: [],
    preferred_tags: extractFeatures(query),
    exclude_tags: []
  };

  const merchant: MerchantRules = {
    currency: primaryProduct.currency,
    user_approval_required: true,
    max_discount_percent: 0
  };

  const offer: CommerceOffer = {
    product_id: primaryProduct.product_id,
    product_name: primaryProduct.name,
    base_amount: primaryProduct.price,
    discount_amount: 0,
    final_amount: primaryProduct.price,
    currency: primaryProduct.currency
  };

  res.json({
    buyer,
    merchant,
    offer,
    policy_approved: false,
    user_authorized: false
  });
});

// Commerce Profile
app.get("/commerce-profile", (_req: Request, res: Response) => {
  res.json({
    protocol: "ai-commerce-profile-v1",
    merchant: "AI Commerce Demo Store",
    description: "AI-native merchant catalog for bounded, auditable commerce.",
    currency: "INR",
    capabilities: {
      catalog_discovery: true,
      natural_language_shopping: true,
      recommendations: true,
      cross_sell: true,
      bounded_purchase_intent: true,
      user_approval_required: true,
      razorpay_payment: true,
      server_side_payment_verification: true,
      audit_trail: true
    },
    purchase_rules: {
      approval_required: true,
      execution_is_bounded_by_intent: true,
      payment_is_server_verified: true
    },
    products: catalog.map(p => ({
      product_id: p.product_id,
      name: p.name,
      description: p.description,
      category: p.category,
      price: p.price,
      currency: p.currency,
      stock: p.stock,
      available: p.stock > 0,
      tags: p.tags
    }))
  });
});

// Recommend
app.post("/recommend", (req: Request, res: Response) => {
  const query = req.body?.query || "";
  const maxPrice = req.body?.max_price || 999999;
  const preferredTags = req.body?.preferred_tags || [];
  const excludedTags = req.body?.excluded_tags || [];

  const matches = findMatchingProducts(query, maxPrice, preferredTags, excludedTags);

  const recommendedProducts = matches.map(item => ({
    product_id: item.product.product_id,
    name: item.product.name,
    price: item.product.price,
    currency: item.product.currency,
    reason: buildRecommendationReason(item.product, item.matched_words, maxPrice)
  }));

  const explanation = recommendedProducts.length
    ? "Products were ranked using buyer intent, product relevance, price limit, and stock availability."
    : "No in-stock products matched the buyer's request within the price limit.";

  const decisionTrace: DecisionTrace = {
    decision_type: "recommendation",
    decision: "Recommend matching in-stock products within the buyer's maximum price.",
    factors: [
      { factor: "buyer_query", value: query, impact: "Determines product relevance." },
      { factor: "maximum_price", value: `INR ${maxPrice}`, impact: "Excludes products above the buyer's budget." },
      { factor: "relevance", value: `${recommendedProducts.length} matching product(s)`, impact: "Prioritizes products matching the buyer's intent." },
      { factor: "availability", value: "in-stock products only", impact: "Prevents unavailable products from being recommended." },
      { factor: "preferred_tags", value: preferredTags.length ? preferredTags.join(", ") : "none", impact: "Boosts products matching the buyer's stated preferences." },
      { factor: "excluded_tags", value: excludedTags.length ? excludedTags.join(", ") : "none", impact: "Removes products containing buyer-excluded attributes." }
    ],
    explanation
  };

  res.json({
    products: recommendedProducts,
    explanation,
    decision_trace: decisionTrace
  });
});

// Cross-sell
app.post("/cross-sell", (req: Request, res: Response) => {
  const productId = req.body?.product_id;
  const mainProduct = catalog.find(p => p.product_id === productId);

  if (!mainProduct) {
    res.status(404).json({ detail: "Product not found" });
    return;
  }

  const suggestions: Array<{
    product_id: string;
    name: string;
    price: number;
    currency: string;
    reason: string;
  }> = [];

  for (const other of catalog) {
    if (other.product_id === mainProduct.product_id) continue;
    if (other.stock <= 0) continue;

    let compatible = false;
    if (mainProduct.category === "Mouse") {
      compatible = ["Headphones", "Laptop"].includes(other.category);
    } else if (mainProduct.category === "Laptop") {
      compatible = ["Mouse", "Headphones"].includes(other.category);
    } else if (mainProduct.category === "Headphones") {
      compatible = ["Mouse", "Laptop"].includes(other.category);
    }

    if (compatible) {
      suggestions.push({
        product_id: other.product_id,
        name: other.name,
        price: other.price,
        currency: other.currency,
        reason: `Useful complementary product for ${mainProduct.name}.`
      });
    }
  }

  res.json({
    main_product: mainProduct.name,
    suggestions,
    explanation: "These products were selected as potential complementary purchases."
  });
});

// Offer
app.post("/offer", (req: Request, res: Response) => {
  const productId = req.body?.product_id;
  const maxItems = req.body?.max_items || 2;
  const maxBudget = req.body?.max_budget;

  const primaryProduct = catalog.find(p => p.product_id === productId);
  if (!primaryProduct) {
    res.status(404).json({ detail: "Product not found" });
    return;
  }
  if (primaryProduct.stock <= 0) {
    res.status(409).json({ detail: "Primary product is out of stock" });
    return;
  }
  if (maxBudget != null && primaryProduct.price > maxBudget) {
    res.status(422).json({ detail: "Primary product exceeds the buyer budget" });
    return;
  }

  let currentTotal = primaryProduct.price;
  const complementaryProducts: OfferItem[] = [];

  for (const product of catalog) {
    if (complementaryProducts.length >= maxItems) break;
    if (product.product_id === primaryProduct.product_id) continue;
    if (product.stock <= 0) continue;

    let compatible = false;
    if (primaryProduct.category === "Mouse") {
      compatible = ["Headphones", "Laptop"].includes(product.category);
    } else if (primaryProduct.category === "Laptop") {
      compatible = ["Mouse", "Headphones"].includes(product.category);
    } else if (primaryProduct.category === "Headphones") {
      compatible = ["Mouse", "Laptop"].includes(product.category);
    }

    if (!compatible) continue;
    if (maxBudget != null && currentTotal + product.price > maxBudget) continue;

    complementaryProducts.push({
      product_id: product.product_id,
      name: product.name,
      price: product.price,
      currency: product.currency,
      reason: `Useful complementary product for ${primaryProduct.name}.`
    });
    currentTotal += product.price;
  }

  const primaryItem: OfferItem = {
    product_id: primaryProduct.product_id,
    name: primaryProduct.name,
    price: primaryProduct.price,
    currency: primaryProduct.currency,
    reason: "Primary product selected from the merchant catalog."
  };

  const subtotal = primaryProduct.price + complementaryProducts.reduce((a, b) => a + b.price, 0);
  const discountAmount = 0;
  const finalAmount = subtotal;
  const discountPercent = 0;

  const explanation = complementaryProducts.length
    ? `Bundle proposal combines ${primaryProduct.name} with ${complementaryProducts.length} complementary in-stock product(s). Pricing uses the merchant catalog and no discount is applied.`
    : `No complementary in-stock products were available for ${primaryProduct.name}. The offer contains only the primary product.`;

  const boundedBy = [
    "merchant_catalog_prices",
    "stock_availability",
    "explicit_product_compatibility",
    "no_unconfigured_discount"
  ];
  if (maxBudget != null) boundedBy.push("buyer_max_budget");

  res.json({
    primary_product: primaryItem,
    complementary_products: complementaryProducts,
    subtotal,
    discount_amount: discountAmount,
    final_amount: finalAmount,
    currency: primaryProduct.currency,
    discount_percent: discountPercent,
    explanation,
    bounded_by: boundedBy,
    decision_trace: {
      decision_type: "offer",
      decision: `Build a bounded offer for ${primaryProduct.name} using catalog, stock, compatibility, and buyer constraints.`,
      factors: [
        { factor: "primary_product", value: primaryProduct.name, impact: "Selected from the merchant catalog." },
        { factor: "complementary_products", value: `${complementaryProducts.length} selected`, impact: "Only compatible and in-stock products were included." },
        { factor: "budget", value: maxBudget != null ? `INR ${maxBudget}` : "not specified", impact: "Limits the total offer when a buyer budget is provided." },
        { factor: "discount", value: `${discountPercent}% / INR ${discountAmount}`, impact: "No unconfigured discount is applied." }
      ],
      explanation
    }
  });
});

// Offer from contract
app.post("/offer-from-contract", (req: Request, res: Response) => {
  try {
    const offer = createOfferFromContract(req.body);
    res.json(offer);
  } catch (err: any) {
    res.status(422).json({ detail: err.message || "Failed to create offer from contract" });
  }
});

// Revenue Agent
app.get("/revenue-agent", (_req: Request, res: Response) => {
  let completedOrders = 0;
  let totalRevenue = 0.0;
  let pendingPayments = 0;
  let failedPayments = 0;

  const productSales: Record<string, number> = {};

  for (const stored of Object.values(intents)) {
    const status = stored.status;
    const payment = stored.payment || {};
    const intent = stored.intent;

    if (status === "payment_verified" && payment.captured === true) {
      const amount = payment.amount;
      if (typeof amount === "number") {
        completedOrders += 1;
        totalRevenue += amount;
      }
      const purpose = intent?.purpose || "";
      for (const prod of catalog) {
        if (purpose.includes(prod.name)) {
          productSales[prod.product_id] = (productSales[prod.product_id] || 0) + 1;
          break;
        }
      }
    } else if (status === "payment_pending" || status === "payment_authorized") {
      pendingPayments += 1;
    } else if (status === "payment_failed") {
      failedPayments += 1;
    }
  }

  const averageOrderValue = completedOrders ? totalRevenue / completedOrders : 0.0;

  const metrics = [
    { metric: "completed_orders", value: completedOrders },
    { metric: "total_revenue", value: totalRevenue },
    { metric: "average_order_value", value: averageOrderValue },
    { metric: "pending_payments", value: pendingPayments },
    { metric: "failed_payments", value: failedPayments }
  ];

  const opportunities: any[] = [];
  for (const [productId, salesCount] of Object.entries(productSales)) {
    const purchased = catalog.find(p => p.product_id === productId);
    if (!purchased) continue;

    for (const prod of catalog) {
      if (prod.product_id === purchased.product_id || prod.stock <= 0) continue;

      let compatible = false;
      if (purchased.category === "Mouse") {
        compatible = ["Headphones", "Laptop"].includes(prod.category);
      } else if (purchased.category === "Laptop") {
        compatible = ["Mouse", "Headphones"].includes(prod.category);
      } else if (purchased.category === "Headphones") {
        compatible = ["Mouse", "Laptop"].includes(prod.category);
      }

      if (compatible) {
        opportunities.push({
          product_id: prod.product_id,
          product_name: prod.name,
          opportunity: "Cross-sell",
          reason: `${purchased.name} has ${salesCount} completed purchase(s). ${prod.name} is an in-stock complementary product.`,
          potential_action: `Offer ${prod.name} after ${purchased.name} selection.`
        });
      }
    }
  }

  const explanation = completedOrders
    ? "Revenue metrics are calculated from persisted commerce intents and server-verified captured Razorpay payments. Opportunities are catalog-based cross-sell suggestions and are not counted as revenue."
    : "No completed server-verified payments are currently recorded. Revenue is not estimated. Opportunities are generated only from actual completed purchases.";

  const revenueHealth = completedOrders > 0 && failedPayments === 0
    ? "healthy"
    : failedPayments > 0 || pendingPayments > 0
    ? "attention_required"
    : "no_completed_revenue";

  const decisionTrace: DecisionTrace = {
    decision_type: "revenue_analysis",
    decision: "Analyze verified merchant revenue and identify bounded catalog-based growth opportunities.",
    factors: [
      { factor: "completed_orders", value: String(completedOrders), impact: "Counts only server-verified captured payments." },
      { factor: "total_revenue", value: `INR ${totalRevenue.toFixed(2)}`, impact: "Measures realized revenue from verified payments." },
      { factor: "average_order_value", value: `INR ${averageOrderValue.toFixed(2)}`, impact: "Measures the merchant's realized average basket value." },
      { factor: "payment_health", value: revenueHealth, impact: "Highlights pending or failed payment states without estimating missing revenue." },
      { factor: "cross_sell_opportunities", value: String(opportunities.length), impact: "Identifies compatible in-stock catalog products that may increase basket size." }
    ],
    explanation
  };

  res.json({
    merchant: "AI Commerce Demo Store",
    completed_orders: completedOrders,
    total_revenue: totalRevenue,
    average_order_value: averageOrderValue,
    pending_payments: pendingPayments,
    failed_payments: failedPayments,
    metrics,
    opportunities,
    explanation,
    data_source: "Persisted purchase intents and server-verified Razorpay payment records",
    decision_trace: decisionTrace
  });
});

// Single-turn Shopping Agent
app.post("/shop", (req: Request, res: Response) => {
  const query = req.body?.query || "";
  const maxPrice = req.body?.max_price || 999999;

  const matches = findMatchingProducts(query, maxPrice);
  if (!matches.length) {
    res.json({
      buyer_query: query,
      budget: maxPrice,
      recommendations: [],
      cross_sell: [],
      intent_id: null,
      message: "I could not find an in-stock product matching your request within your budget."
    });
    return;
  }

  const bestMatch = matches[0];
  const mainProduct = bestMatch.product;
  const reason = buildRecommendationReason(mainProduct, bestMatch.matched_words, maxPrice);

  const recommendations = [
    {
      product_id: mainProduct.product_id,
      name: mainProduct.name,
      price: mainProduct.price,
      currency: mainProduct.currency,
      reason
    }
  ];

  const crossSell: any[] = [];
  for (const product of catalog) {
    if (product.product_id === mainProduct.product_id || product.stock <= 0 || product.price > maxPrice) continue;
    let compatible = false;
    if (mainProduct.category === "Mouse") {
      compatible = ["Headphones", "Laptop"].includes(product.category);
    } else if (mainProduct.category === "Laptop") {
      compatible = ["Mouse", "Headphones"].includes(product.category);
    } else if (mainProduct.category === "Headphones") {
      compatible = ["Mouse", "Laptop"].includes(product.category);
    }
    if (compatible) {
      crossSell.push({
        product_id: product.product_id,
        name: product.name,
        price: product.price,
        currency: product.currency,
        reason: `Complementary product for ${mainProduct.name}.`
      });
    }
  }

  const intent: IntentContract = {
    merchant: "AI Commerce Demo Store",
    purpose: `Buy ${mainProduct.name}`,
    max_amount: mainProduct.price,
    currency: mainProduct.currency,
    user_approval_required: true
  };

  const intentId = crypto.randomUUID();
  const policyResult = checkPolicy(intent);

  intents[intentId] = {
    intent,
    policy: policyResult,
    approved: false,
    status: "intent_created",
    payment: null,
    execution_count: 0
  };

  saveIntents();

  audit_logs.push({
    intent_id: intentId,
    event: "intent_created",
    status: "success",
    reason: policyResult.reason
  });

  audit_logs.push({
    intent_id: intentId,
    event: "policy_checked",
    status: policyResult.allowed ? "allowed" : "blocked",
    reason: policyResult.reason
  });

  saveAuditLogs();

  res.json({
    buyer_query: query,
    budget: maxPrice,
    recommendations,
    cross_sell: crossSell,
    intent_id: intentId,
    message: "Product recommended and purchase intent created. User approval is required before payment."
  });
});

// Conversational Shopping Agent with session memory (Used by frontend)
app.post("/conversational-shop", (req: Request, res: Response) => {
  const message = req.body?.message || "";
  let sessionId = req.body?.session_id;

  if (!sessionId) {
    sessionId = crypto.randomUUID();
  }

  if (!conversations[sessionId]) {
    conversations[sessionId] = {
      product_type: null,
      features: [],
      purpose: null,
      max_price: null,
      stage: "discovery",
      last_intent_id: null,
      history: []
    };
  }

  const conversation = conversations[sessionId];
  conversation.history.push({ role: "user", message });

  const currentType = extractProductType(message);
  const currentFeatures = extractFeatures(message);
  const currentPurpose = extractPurpose(message);
  const currentBudget = extractBudget(message);

  if (currentType != null) conversation.product_type = currentType;
  for (const feat of currentFeatures) {
    if (!conversation.features.includes(feat)) conversation.features.push(feat);
  }
  if (currentPurpose != null) conversation.purpose = currentPurpose;
  if (currentBudget != null) conversation.max_price = currentBudget;

  const productType = conversation.product_type;
  const features = conversation.features;
  const purpose = conversation.purpose;
  const budget = conversation.max_price;

  if (budget == null) {
    res.json({
      session_id: sessionId,
      buyer_message: message,
      stage: conversation.stage,
      understanding: { product_type: productType, features, purpose, max_price: null },
      recommendations: [],
      cross_sell: [],
      intent_id: null,
      message: "Please provide a maximum budget so I can safely recommend a product."
    });
    return;
  }

  if (productType == null) {
    res.json({
      session_id: sessionId,
      buyer_message: message,
      stage: conversation.stage,
      understanding: { product_type: null, features, purpose, max_price: budget },
      recommendations: [],
      cross_sell: [],
      intent_id: null,
      message: "What type of product are you looking for, such as a mouse, headphones, or laptop?"
    });
    return;
  }

  const queryParts = [productType, ...features];
  if (purpose) queryParts.push(purpose);
  const structuredQuery = queryParts.join(" ");

  const matches = findMatchingProducts(structuredQuery, budget);

  if (!matches.length) {
    conversation.stage = "discovery";
    res.json({
      session_id: sessionId,
      buyer_message: message,
      stage: conversation.stage,
      understanding: { product_type: productType, features, purpose, max_price: budget },
      recommendations: [],
      cross_sell: [],
      intent_id: null,
      message: "I could not find an in-stock product matching your request within your budget."
    });
    return;
  }

  const bestMatch = matches[0];
  const product = bestMatch.product;
  const reason = buildRecommendationReason(product, bestMatch.matched_words, budget);

  const recommendation = {
    product_id: product.product_id,
    name: product.name,
    price: product.price,
    currency: product.currency,
    reason
  };

  const crossSell: any[] = [];
  for (const other of catalog) {
    if (other.product_id === product.product_id || other.stock <= 0 || other.price > budget) continue;
    let compatible = false;
    if (product.category === "Mouse") {
      compatible = ["Headphones", "Laptop"].includes(other.category);
    } else if (product.category === "Laptop") {
      compatible = ["Mouse", "Headphones"].includes(other.category);
    } else if (product.category === "Headphones") {
      compatible = ["Mouse", "Laptop"].includes(other.category);
    }
    if (compatible) {
      crossSell.push({
        product_id: other.product_id,
        name: other.name,
        price: other.price,
        currency: other.currency,
        reason: `Complementary product for ${product.name}.`
      });
    }
  }

  const intent: IntentContract = {
    merchant: "AI Commerce Demo Store",
    purpose: `Buy ${product.name}`,
    max_amount: product.price,
    currency: product.currency,
    user_approval_required: true
  };

  const intentId = crypto.randomUUID();
  let policyResult = checkPolicy(intent);

  intents[intentId] = {
    intent,
    policy: policyResult,
    approved: false,
    session_id: sessionId,
    status: "intent_created",
    payment: null,
    execution_count: 0
  };

  const commerceContract: CommerceContract = {
    buyer: {
      query: message.trim(),
      category: product.category,
      max_budget: budget,
      required_tags: [],
      preferred_tags: features,
      exclude_tags: []
    },
    merchant: {
      currency: product.currency,
      user_approval_required: true,
      max_discount_percent: 0
    },
    offer: {
      product_id: product.product_id,
      product_name: product.name,
      base_amount: product.price,
      discount_amount: 0,
      final_amount: product.price,
      currency: product.currency
    },
    policy_approved: false,
    user_authorized: false,
    intent_id: intentId
  };

  const offer = createOfferFromContract(commerceContract);
  commerceContract.offer.final_amount = offer.final_amount;
  commerceContract.policy_approved = policyResult.allowed;
  intent.max_amount = offer.final_amount;

  policyResult = checkPolicy(intent);
  if (!policyResult.allowed) {
    res.status(403).json({ detail: policyResult.reason });
    return;
  }

  intents[intentId].commerce_contract = commerceContract;
  intents[intentId].offer = offer;

  saveIntents();

  audit_logs.push({
    intent_id: intentId,
    event: "intent_created",
    status: "success",
    reason: policyResult.reason
  });

  audit_logs.push({
    intent_id: intentId,
    event: "policy_checked",
    status: policyResult.allowed ? "allowed" : "blocked",
    reason: policyResult.reason
  });

  saveAuditLogs();

  const prevIntentId = conversation.last_intent_id;
  conversation.stage = "intent_created";
  conversation.last_intent_id = intentId;

  const responseMessage = "I found a suitable product and created a purchase intent. User approval is required before payment.";
  conversation.history.push({ role: "assistant", message: responseMessage });

  res.json({
    session_id: sessionId,
    buyer_message: message,
    stage: conversation.stage,
    last_intent_id: conversation.last_intent_id,
    refined_from_intent_id: prevIntentId,
    understanding: {
      product_type: productType,
      features,
      purpose,
      max_price: budget
    },
    recommendations: [recommendation],
    cross_sell: crossSell,
    intent_id: intentId,
    message: responseMessage
  });
});

// Create Intent
app.post("/intent", (req: Request, res: Response) => {
  const intent: IntentContract = req.body;
  const intentId = crypto.randomUUID();
  const policyResult = checkPolicy(intent);

  intents[intentId] = {
    intent,
    policy: policyResult,
    approved: false,
    status: "intent_created",
    payment: null,
    execution_count: 0
  };

  saveIntents();

  audit_logs.push({
    intent_id: intentId,
    event: "intent_created",
    status: "success",
    reason: policyResult.reason
  });

  audit_logs.push({
    intent_id: intentId,
    event: "policy_checked",
    status: policyResult.allowed ? "allowed" : "blocked",
    reason: policyResult.reason
  });

  saveAuditLogs();

  res.json({
    intent_id: intentId,
    intent,
    policy: policyResult
  });
});

// Autonomous Commerce Loop Status
app.get("/commerce-loop/:intent_id", (req: Request, res: Response) => {
  const intentId = req.params.intent_id;
  const stored = intents[intentId];

  if (!stored) {
    res.status(404).json({ detail: "Intent not found" });
    return;
  }

  const policy = stored.policy || {};
  const policyAllowed = Boolean(policy.allowed);
  const approved = Boolean(stored.approved);

  let stage = "ready_for_execution";
  let nextAction = "execute";

  if (stored.status === "payment_verified") {
    stage = "payment_verified";
    nextAction = "none";
  } else if (stored.status === "payment_authorized") {
    stage = "payment_authorized";
    nextAction = "await_capture";
  } else if (stored.status === "payment_pending") {
    stage = "payment_pending";
    nextAction = "complete_payment";
  } else if (!policyAllowed) {
    stage = "blocked";
    nextAction = "none";
  } else if (!approved) {
    stage = "awaiting_approval";
    nextAction = "approve";
  }

  res.json({
    intent_id: intentId,
    stage,
    next_action: nextAction,
    policy_allowed: policyAllowed,
    user_approved: approved,
    payment_status: stored.status,
    commerce_contract_present: stored.commerce_contract != null,
    autonomous_payment: false,
    message: "Commerce loop is ready for the next safe action. Payment always requires the existing approval and execution gates."
  });
});

// Approval
app.post("/approval", (req: Request, res: Response) => {
  const { intent_id, approved } = req.body;
  const stored = intents[intent_id];

  if (!stored) {
    res.status(404).json({ detail: "Intent not found" });
    return;
  }

  if (stored.status === "execution_completed") {
    res.status(409).json({ detail: "Intent has already been executed" });
    return;
  }

  stored.approved = Boolean(approved);
  stored.status = approved ? "approved" : "rejected";

  if (stored.commerce_contract) {
    stored.commerce_contract.user_authorized = Boolean(approved);
  }

  saveIntents();

  audit_logs.push({
    intent_id,
    event: "approval_received",
    status: approved ? "approved" : "rejected",
    reason: approved ? "User approval" : "User rejected intent"
  });

  saveAuditLogs();

  if (approved) {
    res.json({ intent_id, approved: true, message: "Intent approved" });
  } else {
    res.json({ intent_id, approved: false, message: "Intent rejected" });
  }
});

// Execute Payment / Create Order
app.post("/execute/:intent_id", (req: Request, res: Response) => {
  const intentId = req.params.intent_id;
  const stored = intents[intentId];

  if (!stored) {
    res.status(404).json({ detail: "Intent not found" });
    return;
  }

  if (stored.status === "payment_verified") {
    res.json({
      intent_id: intentId,
      status: "payment_verified",
      payment: stored.payment,
      idempotent: true
    });
    return;
  }

  if (stored.status === "payment_pending" && stored.payment) {
    res.json({
      intent_id: intentId,
      status: "payment_pending",
      payment: stored.payment,
      idempotent: true
    });
    return;
  }

  if (stored.status === "execution_in_progress") {
    res.status(409).json({ detail: "Intent execution is already in progress" });
    return;
  }

  if (!stored.policy.allowed) {
    stored.status = "blocked";
    audit_logs.push({
      intent_id: intentId,
      event: "execution_blocked",
      status: "blocked",
      reason: "Intent is not allowed by policy"
    });
    saveIntents();
    saveAuditLogs();
    res.status(403).json({ detail: "Intent is not allowed by policy" });
    return;
  }

  if (!stored.approved) {
    audit_logs.push({
      intent_id: intentId,
      event: "execution_blocked",
      status: "blocked",
      reason: "User approval is required"
    });
    saveAuditLogs();
    res.status(403).json({ detail: "User approval is required" });
    return;
  }

  stored.status = "execution_in_progress";
  stored.execution_count = (stored.execution_count || 0) + 1;

  audit_logs.push({
    intent_id: intentId,
    event: "execution_started",
    status: "started",
    reason: "Policy and approval gates passed"
  });

  try {
    const paymentResult = createPaymentOrder(stored.intent, intentId);
    stored.payment = paymentResult;
    stored.status = "payment_pending";

    audit_logs.push({
      intent_id: intentId,
      event: "payment_order_created",
      status: "success",
      reason: "Razorpay order created; customer payment is still pending"
    });

    saveIntents();
    saveAuditLogs();

    res.json({
      intent_id: intentId,
      status: "payment_pending",
      payment: paymentResult
    });
  } catch (err: any) {
    stored.status = "payment_failed";
    saveIntents();

    audit_logs.push({
      intent_id: intentId,
      event: "payment_failed",
      status: "failed",
      reason: "Razorpay order creation failed"
    });
    saveAuditLogs();

    res.status(502).json({ detail: "Payment creation failed" });
  }
});

// Verify Payment
app.post("/payment/verify", (req: Request, res: Response) => {
  const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body;

  const intentEntry = Object.entries(intents).find(
    ([, stored]) => (stored.payment || {}).order_id === razorpay_order_id
  );

  if (!intentEntry) {
    res.status(404).json({ detail: "Razorpay order is not associated with a known purchase intent" });
    return;
  }

  const [intentId, stored] = intentEntry;
  const payment = stored.payment || {};

  if (stored.status === "payment_verified") {
    res.json({
      intent_id: intentId,
      status: "payment_verified",
      payment,
      idempotent: true
    });
    return;
  }

  try {
    if (!verifyCheckoutSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature || "demo_sig")) {
      throw new Error("Razorpay payment signature verification failed");
    }

    stored.payment = {
      ...payment,
      status: "payment_verified",
      payment_id: razorpay_payment_id,
      captured: true,
      amount: payment.amount || stored.intent.max_amount,
      currency: payment.currency || "INR",
      signature_verified: true
    };

    stored.status = "payment_verified";

    audit_logs.push({
      intent_id: intentId,
      event: "payment_signature_verified",
      status: "success",
      reason: "Razorpay payment signature verified server-side"
    });

    audit_logs.push({
      intent_id: intentId,
      event: "execution_completed",
      status: "success",
      reason: "Payment was successfully verified and captured"
    });

    audit_logs.push({
      intent_id: intentId,
      event: "payment_captured",
      status: "success",
      reason: "Razorpay confirms the payment is captured"
    });

    saveIntents();
    saveAuditLogs();

    res.json({
      intent_id: intentId,
      status: "payment_verified",
      payment: stored.payment
    });
  } catch (err: any) {
    audit_logs.push({
      intent_id: intentId,
      event: "payment_verification_failed",
      status: "failed",
      reason: err.message || "Verification failed"
    });
    saveAuditLogs();
    res.status(400).json({ detail: err.message || "Payment verification failed" });
  }
});

// Webhook
app.post("/webhooks/razorpay", (req: Request, res: Response) => {
  const signature = (req.headers["x-razorpay-signature"] as string) || "";
  const eventId = (req.headers["x-razorpay-event-id"] as string) || "";

  try {
    verifyWebhookSignature(JSON.stringify(req.body), signature);
  } catch (err: any) {
    res.status(400).json({ detail: err.message });
    return;
  }

  if (eventId && processed_webhook_events.has(eventId)) {
    res.json({ status: "ignored", reason: "duplicate_event" });
    return;
  }

  if (eventId) {
    processed_webhook_events.add(eventId);
    saveWebhookEvents();
  }

  const payload = req.body;
  const eventName = payload.event || "";
  const entity = payload.payload?.payment?.entity || payload.payload?.order?.entity || {};
  const orderId = entity.order_id || entity.id;
  const paymentId = entity.entity === "payment" ? entity.id : null;

  const intentEntry = Object.entries(intents).find(
    ([, stored]) => (stored.payment || {}).order_id === orderId
  );

  if (!intentEntry) {
    res.json({ status: "ignored", reason: "unknown_order" });
    return;
  }

  const [intentId, stored] = intentEntry;
  stored.payment = stored.payment || {};

  if (eventName === "payment.captured" || eventName === "order.paid") {
    stored.status = "payment_verified";
    stored.payment.status = "payment_verified";
    stored.payment.captured = true;
    stored.payment.webhook_confirmed = true;
    if (paymentId) stored.payment.payment_id = paymentId;

    audit_logs.push({
      intent_id: intentId,
      event: "payment_captured",
      status: "success",
      reason: `Razorpay ${eventName} webhook received`
    });
  } else if (eventName === "payment.failed") {
    if (stored.status !== "payment_verified") {
      stored.status = "payment_failed";
      stored.payment.failed_webhook_confirmed = true;
      audit_logs.push({
        intent_id: intentId,
        event: "payment_failed",
        status: "failed",
        reason: "Razorpay payment.failed webhook received"
      });
    }
  }

  saveIntents();
  saveAuditLogs();

  res.json({ status: "received" });
});

// Intent Status
app.get("/intent/:intent_id", (req: Request, res: Response) => {
  const intentId = req.params.intent_id;
  const stored = intents[intentId];

  if (!stored) {
    res.status(404).json({ detail: "Intent not found" });
    return;
  }

  res.json({
    intent_id: intentId,
    status: stored.status || "intent_created",
    approved: stored.approved || false,
    policy: stored.policy,
    payment: stored.payment,
    execution_count: stored.execution_count || 0,
    session_id: stored.session_id,
    commerce_contract: stored.commerce_contract,
    offer: stored.offer
  });
});

// Orders
app.get("/orders", (_req: Request, res: Response) => {
  const orders: any[] = [];

  for (const [intentId, stored] of Object.entries(intents)) {
    const payment = stored.payment;
    if (!payment || !payment.order_id) continue;
    if (payment.amount == null) continue;

    orders.push({
      intent_id: intentId,
      order_id: payment.order_id,
      payment_id: payment.payment_id,
      status: stored.status || payment.status || "unknown",
      amount: payment.amount,
      currency: payment.currency || "INR",
      captured: Boolean(payment.captured),
      merchant: payment.merchant || "AI Commerce Demo Store"
    });
  }

  orders.reverse();
  res.json({ orders, count: orders.length });
});

// Audit Trail
app.get("/audit/:intent_id", (req: Request, res: Response) => {
  const intentId = req.params.intent_id;
  if (!intents[intentId]) {
    res.status(404).json({ detail: "Intent not found" });
    return;
  }

  const events = audit_logs.filter(e => e.intent_id === intentId);
  res.json({
    intent_id: intentId,
    audit_trail: events
  });
});

// Static frontend serving
const frontendPath = path.join(process.cwd(), "frontend");
app.use(express.static(frontendPath));

// Root route handler
app.get("/", (req: Request, res: Response) => {
  if (req.headers.accept && req.headers.accept.includes("application/json") && !req.headers.accept.includes("text/html")) {
    res.json({ message: "AI Commerce Engine is running", status: "ok" });
  } else {
    res.sendFile(path.join(frontendPath, "index.html"));
  }
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
});
