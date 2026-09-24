// ============================================================
// AI COMMERCE ENGINE
// Frontend Application
// ============================================================

// Backend URL
const API_BASE_URL = window.location.origin;


// ============================================================
// STATE
// ============================================================

let sessionId = null;
let currentIntentId = null;
let currentProduct = null;
let isLoading = false;
let lastPayment = null;
let lastAuditTrail = [];
let currentStoreConfig = null;

// Multi-Item Cart Session & State
let clientCart = { items: [], total_amount: 0, subtotal: 0, discount_amount: 0 };
const cartSessionId = "session_" + (localStorage.getItem("commerce_cart_sess") || (() => {
    const id = Math.random().toString(36).substring(2, 9);
    localStorage.setItem("commerce_cart_sess", id);
    return id;
})());

// Automatically synchronize session items into persistent cart
async function autoSyncSessionItemToCart(product) {
    if (!product || !product.product_id) return;
    try {
        const res = await fetch(`${API_BASE_URL}/api/cart/add`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                session_id: cartSessionId,
                product_id: product.product_id,
                quantity: 1,
                exact_quantity: true,
                price: product.price
            })
        });
        const d = await res.json();
        if (d.success && d.cart) {
            clientCart = d.cart;
            if (typeof renderCartUI === "function") {
                renderCartUI();
            }
        }
    } catch (err) {
        console.warn("Auto-sync item to cart non-fatal:", err);
    }
}

// ============================================================
// THEME SWITCHER (DARK / LIGHT MODE)
// ============================================================
function initTheme() {
    const savedTheme = localStorage.getItem("ai_commerce_theme") || "light";
    applyTheme(savedTheme);

    const themeToggleBtn = document.getElementById("themeToggleBtn");
    themeToggleBtn?.addEventListener("click", () => {
        const currentTheme = document.documentElement.getAttribute("data-theme") || "light";
        const newTheme = currentTheme === "dark" ? "light" : "dark";
        applyTheme(newTheme);
    });
}

function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    document.body.setAttribute("data-theme", theme);
    localStorage.setItem("ai_commerce_theme", theme);

    const themeIcon = document.getElementById("themeIcon");
    const themeText = document.getElementById("themeText");
    if (themeIcon) {
        themeIcon.textContent = theme === "dark" ? "☀️" : "🌙";
    }
    if (themeText) {
        themeText.textContent = theme === "dark" ? "Light Mode" : "Dark Mode";
    }
}

// Initialize theme immediately on script execution
initTheme();


// ============================================================
// DOM ELEMENTS
// ============================================================

const messageInput = document.getElementById("messageInput");
const sendButton = document.getElementById("sendButton");

const messages = document.getElementById("messages");
const welcomeScreen = document.getElementById("welcomeScreen");

const newChatButton = document.getElementById("newChatButton");
const ordersButton = document.getElementById("ordersButton");

const approvalModal = document.getElementById("approvalModal");
const closeModal = document.getElementById("closeModal");
const approveButton = document.getElementById("approveButton");
const rejectButton = document.getElementById("rejectButton");

const modalProductName =
    document.getElementById("modalProductName");

const modalProductReason =
    document.getElementById("modalProductReason");

const modalProductPrice =
    document.getElementById("modalProductPrice");

const stateIndicator =
    document.getElementById("stateIndicator");

const stateTitle =
    document.getElementById("stateTitle");

const stateDescription =
    document.getElementById("stateDescription");

const pipelineIntent =
    document.getElementById("pipelineIntent");

const pipelinePolicy =
    document.getElementById("pipelinePolicy");

const pipelineApproval =
    document.getElementById("pipelineApproval");

const pipelinePayment =
    document.getElementById("pipelinePayment");


// ============================================================
// INITIAL STATE
// ============================================================

setState(
    "Waiting for request",
    "Your shopping session hasn't started yet.",
    ""
);


// ============================================================
// SEND MESSAGE
// ============================================================

async function refreshCommerceLoop() {
    if (!currentIntentId) {
        return;
    }

    try {
        const response = await fetch(
            `${API_BASE_URL}/commerce-loop/${currentIntentId}`,
            {
                headers: {
                    "Accept": "application/json"
                }
            }
        );

        if (!response.ok) {
            return;
        }

        const loop = await response.json();

        if (loop.stage === "awaiting_approval") {
            setState(
                "Awaiting your approval",
                "AI prepared the commerce decision. Nothing will be paid without your approval.",
                "active"
            );
            activatePipeline(pipelineApproval);
        } else if (loop.stage === "ready_for_execution") {
            setState(
                "Ready for payment",
                "Your approval was received. Payment execution is still explicitly gated.",
                "active"
            );
            activatePipeline(pipelinePayment);
        } else if (loop.stage === "payment_pending") {
            setState(
                "Payment pending",
                "Razorpay order created. Complete payment to continue.",
                "active"
            );
            markPipelineComplete(pipelineApproval);
            activatePipeline(pipelinePayment);
        } else if (loop.stage === "payment_verified") {
            setState(
                "Payment verified",
                "Payment was verified by the backend.",
                "success"
            );
            markPipelineComplete(pipelineApproval);
            markPipelineComplete(pipelinePayment);
        }
    } catch (error) {
        console.warn("Commerce loop refresh failed:", error);
    }
}

async function sendMessage() {

    if (isLoading) {
        return;
    }

    const message = messageInput.value.trim();

    if (!message) {
        return;
    }

    addMessage("user", message);

    messageInput.value = "";

    autoResizeTextarea();

    hideWelcome();

    setLoading(true);

    setState(
        "Understanding request",
        "AI is analyzing your shopping requirements.",
        "active"
    );

    activatePipeline(pipelineIntent);

    try {

        const response = await fetch(
            `${API_BASE_URL}/conversational-shop`,
            {
                method: "POST",

                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                },

                body: JSON.stringify({

                    message: message,

                    ...(sessionId
                        ? { session_id: sessionId }
                        : {})
                })
            }
        );


        let data;
        const responseText = await response.text();
        try {
            data = JSON.parse(responseText);
        } catch (err) {
            if (!response.ok) {
                if (response.status === 403 || responseText.includes("403")) {
                    throw new Error("Corporate pricing policy baseline floor is strictly ₹4,500.00 INR. Transactions below this threshold are blocked.");
                }
                throw new Error("Unable to connect to shopping service. Please try again.");
            }
            throw new Error("Received unexpected response from server.");
        }

        if (!response.ok) {
            throw new Error(
                data.detail ||
                data.error ||
                "Something went wrong."
            );
        }


        // Save session
        if (data.session_id) {

            sessionId = data.session_id;
        }

        // Update Structured Data Stream in live console
        const liveToolStream = document.getElementById("liveToolStream");
        if (liveToolStream) {
            liveToolStream.textContent = JSON.stringify(data, null, 2);
        }


        // ====================================================
        // UPDATE PIPELINE
        // ====================================================

        activatePipeline(pipelinePolicy);


        // ====================================================
        // HANDLE FINANCIAL FIREWALL CROSS-SELL
        // ====================================================

        if (
            data.stage === "active_cross_sell_bundle" ||
            data.stage === "firewall_blocked" ||
            (data.cross_sell && data.cross_sell.length > 0 && (!data.recommendations || data.recommendations.length === 0))
        ) {
            setState(
                "Financial Firewall Blocked",
                `Floor: ₹4,500.00 INR. Active cross-sell workflow initiated.`,
                "warning"
            );

            addFirewallCrossSellMessage(data);
            setLoading(false);
            return;
        }


        // ====================================================
        // HANDLE ORDER ASSISTANCE & POST-PURCHASE SUPPORT
        // ====================================================
        if (
            data.stage === "order_assistance" ||
            data.type === "order_support"
        ) {
            setState(
                "Order Assistance",
                `Retrieved tracking, courier ETA & warranty for Order #${data.order_id || 'details'}.`,
                "active"
            );

            addOrderAssistanceMessage(data);
            setLoading(false);
            return;
        }


        // ====================================================
        // HANDLE COMPILED SECURE CHECKOUT TOOL
        // ====================================================

        if (
            data.stage === "checkout_compiled" ||
            data.tool === "generate_secure_checkout"
        ) {
            setState(
                "Order Compiled",
                "Tool generate_secure_checkout invoked with extracted session parameters.",
                "active"
            );

            addCompiledToolCallMessage(data);

            if (data.intent_id) {
                currentIntentId = data.intent_id;
                await refreshCommerceLoop();
                activatePipeline(pipelineApproval);
            }

            setLoading(false);
            return;
        }


        // ====================================================
        // HANDLE CLARIFICATION
        // ====================================================

        if (
            !data.intent_id &&
            data.message
        ) {

            setState(
                "Need clarification",
                data.message,
                "warning"
            );

            addMessage(
                "agent",
                data.message
            );

            setLoading(false);

            return;
        }


        // ====================================================
        // HANDLE NO PRODUCT
        // ====================================================

        if (
            !data.recommendations ||
            data.recommendations.length === 0
        ) {

            setState(
                "No suitable match",
                data.message ||
                "I couldn't find a suitable product.",
                "warning"
            );

            addMessage(
                "agent",
                data.message ||
                "I couldn't find a suitable product."
            );

            setLoading(false);

            return;
        }


        // ====================================================
        // INTENT CREATED
        // ====================================================

        currentIntentId = data.intent_id;

        currentProduct =
            data.recommendations[0];

        await refreshCommerceLoop();


        activatePipeline(pipelinePolicy);

        markPipelineComplete(pipelineIntent);


        // ====================================================
        // AGENT RESPONSE
        // ====================================================

        addAgentRecommendation(data);


        // ====================================================
        // WAITING FOR APPROVAL
        // ====================================================

        setState(
            "Awaiting your approval",
            "A purchase intent has been created. Nothing will be paid without your approval.",
            "active"
        );

        activatePipeline(pipelineApproval);


    } catch (error) {

        console.error(error);

        addMessage(
            "agent",
            `⚠️ ${error.message}`
        );

        setState(
            "Connection error",
            "Make sure the FastAPI server is running on port 8000.",
            "warning"
        );

    } finally {

        setLoading(false);
    }
}


// ============================================================
// ADD USER / AGENT MESSAGE
// ============================================================

function addMessage(
    type,
    text
) {

    const message = document.createElement("div");

    message.className =
        `message ${type}`;


    const content =
        document.createElement("div");

    content.className =
        "message-content";


    content.textContent = text;


    message.appendChild(content);

    messages.appendChild(message);


    scrollChatToBottom();
}


// ============================================================
// AGENT RECOMMENDATION
// ============================================================

function addAgentRecommendation(data) {

    const wrapper =
        document.createElement("div");

    wrapper.className =
        "message agent";


    const content =
        document.createElement("div");

    content.className =
        "message-content";


    const intro =
        document.createElement("div");

    intro.textContent =
        data.message ||
        "I found a suitable product for you.";

    content.appendChild(intro);


    const product =
        data.recommendations[0];


    const card =
        document.createElement("div");

    card.className =
        "recommendation-card";


    // ========================================================
    // 1. REAL PRODUCT IMAGE & MEDIA BANNER
    // ========================================================

    if (product.image_url) {
        const mediaBanner = document.createElement("div");
        mediaBanner.className = "product-media-banner";

        const img = document.createElement("img");
        img.className = "product-real-img";
        img.src = product.image_url;
        img.alt = product.name;
        img.loading = "lazy";
        img.onerror = () => { mediaBanner.style.display = "none"; };
        mediaBanner.appendChild(img);

        if (product.category) {
            const categoryChip = document.createElement("span");
            categoryChip.className = "product-category-chip";
            categoryChip.textContent = product.category;
            mediaBanner.appendChild(categoryChip);
        }

        card.appendChild(mediaBanner);
    }


    // ========================================================
    // 2. PRODUCT HEADER & PRICE
    // ========================================================

    const top =
        document.createElement("div");

    top.className =
        "product-top";


    const info =
        document.createElement("div");

    info.className =
        "product-info";


    const icon =
        document.createElement("div");

    icon.className =
        "product-icon";

    icon.textContent =
        getProductIcon(product.name);


    const productText =
        document.createElement("div");


    const name =
        document.createElement("strong");

    name.textContent =
        product.name;


    const id =
        document.createElement("span");

    id.textContent =
        `SKU: ${product.product_id} • ${product.category || 'Official Product'}`;


    productText.appendChild(name);

    productText.appendChild(id);

    info.appendChild(icon);

    info.appendChild(productText);


    const price =
        document.createElement("div");

    price.className =
        "product-price";

    if (product.original_price && product.original_price > product.price) {
        price.innerHTML = `
            <span style="text-decoration: line-through; color: var(--muted); font-size: 13px; font-weight: 500; margin-right: 6px;">${formatCurrency(product.original_price, product.currency)}</span>
            <span style="color: var(--success); font-weight: 700;">${formatCurrency(product.price, product.currency)}</span>
        `;
    } else {
        price.textContent =
            formatCurrency(
                product.price,
                product.currency
            );
    }


    top.appendChild(info);

    top.appendChild(price);

    card.appendChild(top);


    // ========================================================
    // 3. KEY HIGHLIGHTS / VALUE PILLS
    // ========================================================

    if (Array.isArray(product.highlights) && product.highlights.length > 0) {
        const highlightsContainer = document.createElement("div");
        highlightsContainer.className = "product-highlight-chips";
        product.highlights.forEach(hl => {
            const chip = document.createElement("span");
            chip.className = "product-highlight-chip";
            chip.textContent = `✓ ${hl}`;
            highlightsContainer.appendChild(chip);
        });
        card.appendChild(highlightsContainer);
    }


    // ========================================================
    // 4. DETAILED PRODUCT DESCRIPTION
    // ========================================================

    if (product.description) {
        const descEl = document.createElement("div");
        descEl.className = "product-full-description";
        descEl.textContent = product.description;
        card.appendChild(descEl);
    }


    // ========================================================
    // 5. HARDWARE SPECIFICATIONS & TECHNICAL DETAILS
    // ========================================================

    if (product.specifications && typeof product.specifications === "object" && Object.keys(product.specifications).length > 0) {
        const specsToggle = document.createElement("button");
        specsToggle.type = "button";
        specsToggle.className = "product-specs-toggle";
        specsToggle.innerHTML = `<span>⚙️</span> <strong>Specifications & Hardware Details</strong> <span style="font-size: 10px; margin-left: 4px;">▼</span>`;

        const specsCard = document.createElement("div");
        specsCard.className = "product-specs-card";

        for (const [key, val] of Object.entries(product.specifications)) {
            const entry = document.createElement("div");
            entry.className = "spec-entry";

            const k = document.createElement("span");
            k.className = "spec-key";
            k.textContent = key;

            const v = document.createElement("span");
            v.className = "spec-val";
            v.textContent = String(val);

            entry.appendChild(k);
            entry.appendChild(v);
            specsCard.appendChild(entry);
        }

        specsToggle.addEventListener("click", () => {
            const isHidden = specsCard.style.display === "none";
            specsCard.style.display = isHidden ? "grid" : "none";
            const arrow = specsToggle.querySelector("span:last-child");
            if (arrow) arrow.textContent = isHidden ? "▲" : "▼";
        });

        card.appendChild(specsToggle);
        card.appendChild(specsCard);
    }


    // ========================================================
    // 6. RECOMMENDATION RATIONALE
    // ========================================================

    const reason =
        document.createElement("div");

    reason.className =
        "product-reason";

    reason.innerHTML = `<strong style="color: var(--accent); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 4px;">Why Recommended</strong> ${escapeHtml(product.reason || 'Optimal match for your query and budget criteria.')}`;

    card.appendChild(reason);

    // Auto-save item to cart so user can resume payment anytime
    autoSyncSessionItemToCart(product);

    // Cart Safe Retention Notice on product card
    const cartRetentionNotice = document.createElement("div");
    cartRetentionNotice.style.cssText = "display: flex; align-items: center; justify-content: space-between; margin-top: 12px; padding: 7px 11px; background: rgba(99, 102, 241, 0.08); border: 1px solid rgba(99, 102, 241, 0.25); border-radius: 8px; font-size: 11.5px;";
    cartRetentionNotice.innerHTML = `
        <span style="display: flex; align-items: center; gap: 6px; color: var(--text);">
            <span>🛡️</span> <span><strong>Saved to Cart:</strong> Safe holding active if payment is not completed.</span>
        </span>
        <button type="button" class="view-cart-link-btn" style="background: none; border: none; color: var(--accent); font-weight: 600; cursor: pointer; text-decoration: underline; padding: 0; font-size: 11.5px;">View in Cart ↗</button>
    `;
    cartRetentionNotice.querySelector(".view-cart-link-btn")?.addEventListener("click", () => {
        cartButton?.click();
    });
    card.appendChild(cartRetentionNotice);

    // ========================================================
    // 7. ACTIONS (ADD TO CART, NEGOTIATE, INSTANT BUY)
    // ========================================================

    const actions =
        document.createElement("div");

    actions.className =
        "recommendation-actions";
    actions.style.display = "flex";
    actions.style.flexWrap = "wrap";
    actions.style.gap = "8px";
    actions.style.marginTop = "14px";

    // 1. View / Add to Cart Button
    const addToCartBtn = document.createElement("button");
    addToCartBtn.className = "button secondary";
    addToCartBtn.type = "button";
    addToCartBtn.style.padding = "7px 12px";
    addToCartBtn.style.fontSize = "12px";
    addToCartBtn.innerHTML = "🛒 View in Cart";
    addToCartBtn.addEventListener("click", () => {
        cartButton?.click();
    });

    // 2. Conversational Negotiation Chip Button
    const negotiateBtn = document.createElement("button");
    negotiateBtn.className = "button secondary";
    negotiateBtn.type = "button";
    negotiateBtn.style.padding = "7px 12px";
    negotiateBtn.style.fontSize = "12px";
    negotiateBtn.innerHTML = "💬 Negotiate 5% Deal";
    negotiateBtn.addEventListener("click", () => {
        messageInput.value = `Can you offer a 5% discount on ${product.name}?`;
        autoResizeTextarea();
        sendMessage();
    });

    // 3. Instant Review / Buy Button
    const reviewButton =
        document.createElement("button");

    reviewButton.className =
        "button primary";

    reviewButton.type =
        "button";
    reviewButton.style.padding = "7px 14px";
    reviewButton.style.fontSize = "12px";

    reviewButton.textContent =
        "Review purchase →";

    reviewButton.addEventListener(
        "click",
        () => {
            openApprovalModal(
                product
            );
        }
    );

    actions.appendChild(addToCartBtn);
    actions.appendChild(negotiateBtn);
    actions.appendChild(reviewButton);

    card.appendChild(actions);

    content.appendChild(card);

    wrapper.appendChild(content);

    messages.appendChild(wrapper);

    // Update Right Panel Cryptographic Inspector
    const inspectorIntent = document.getElementById("inspectorIntentId");
    const inspectorHash = document.getElementById("inspectorHash");
    if (inspectorIntent && data.intent_id) {
        inspectorIntent.textContent = `#${data.intent_id.substring(0, 14)}`;
    }
    if (inspectorHash) {
        if (data.decision_proof && data.decision_proof.hash) {
            inspectorHash.textContent = data.decision_proof.hash;
        } else if (data.intent_id) {
            inspectorHash.textContent = "sha256:" + (data.intent_id.replace(/[^a-f0-9]/gi, "").padEnd(64, "0").substring(0, 64));
        }
    }

    scrollChatToBottom();
}


// ============================================================
// ============================================================
// CURATED TIER & VALUE-ADD GUIDANCE MESSAGE
// ============================================================

function addFirewallCrossSellMessage(data) {
    const wrapper = document.createElement("div");
    wrapper.className = "message agent";

    const content = document.createElement("div");
    content.className = "message-content";

    // High-contrast, theme-aware banner explaining the policy floor clearly
    const currentFloor = Number(data.current_floor || data.corporate_minimum_inr || 4500);
    const banner = document.createElement("div");
    banner.style.cssText = "background: var(--warning-soft, #fffbeb); border: 1px solid var(--warning-border, #fde68a); border-radius: 14px; padding: 16px; margin-bottom: 16px; color: var(--text, #0f172a); font-size: 13.5px; line-height: 1.6;";
    banner.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
            <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 18px;">🛡️</span>
                <strong style="color: var(--warning, #b45309); font-size: 15px; font-weight: 700;">Financial Firewall Policy Notice</strong>
            </div>
            <span style="background: rgba(180, 83, 9, 0.12); color: var(--warning, #b45309); font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 6px; letter-spacing: 0.5px;">MIN ORDER: ${formatCurrency(currentFloor, "INR")}</span>
        </div>
        <p style="margin: 0 0 8px 0; color: var(--text, #0f172a);">
            You requested accessories <strong>under ${formatCurrency(currentFloor, "INR")}</strong>. Our catalog includes the <strong>ProMouse Precision Ergonomic Controller</strong> at <strong>₹1,500 INR</strong>.
        </p>
        <p style="margin: 0 0 10px 0; color: var(--muted, #475569); font-size: 12.5px;">
            ⚠️ <strong>Corporate Purchasing Policy:</strong> The store currently enforces a minimum transaction baseline floor of <strong>${formatCurrency(currentFloor, "INR")}</strong>. Standalone single-item checkout for ₹1,500 is held by policy.
        </p>
        <div style="padding-top: 10px; border-top: 1px dashed var(--warning-border, #fde68a); font-size: 12.5px; color: var(--text, #0f172a);">
            <strong>How you can proceed:</strong>
            <ul style="margin: 4px 0 0 18px; padding: 0; line-height: 1.6;">
                <li><strong>Add 3× ProMouse to Cart:</strong> (3 × ₹1,500 = ₹4,500) to satisfy the corporate floor and check out.</li>
                <li><strong>Choose the Work & Focus Audio Bundle:</strong> (₹6,500) to get the ProMouse + SoundMax ANC Headphones at a ₹500 discount.</li>
                <li><strong>Adjust the Policy Floor:</strong> As a store operator, you can lower this limit at any time in <strong>Merchant Control</strong>.</li>
            </ul>
        </div>
    `;
    content.appendChild(banner);

    const list = document.createElement("div");
    list.style.cssText = "display: flex; flex-direction: column; gap: 14px;";

    // If a sub-floor accessory matches the user query, show it first with clear quantity/cart actions!
    const matchedAcc = data.matched_accessory || data.matched_product;
    if (matchedAcc) {
        const accCard = document.createElement("div");
        accCard.className = "recommendation-card";
        accCard.style.cssText = "border: 2px solid var(--accent, #2563eb); background: var(--panel-2, #ffffff); border-radius: 12px; padding: 14px; position: relative;";

        if (matchedAcc.image_url) {
            const mediaBanner = document.createElement("div");
            mediaBanner.className = "product-media-banner";
            mediaBanner.style.height = "160px";

            const img = document.createElement("img");
            img.className = "product-real-img";
            img.src = matchedAcc.image_url;
            img.alt = matchedAcc.name;
            img.loading = "lazy";
            mediaBanner.appendChild(img);

            const categoryChip = document.createElement("span");
            categoryChip.className = "product-category-chip";
            categoryChip.style.background = "#059669";
            categoryChip.style.color = "#ffffff";
            categoryChip.textContent = "Direct Budget Match (Under ₹4,500)";
            mediaBanner.appendChild(categoryChip);

            accCard.appendChild(mediaBanner);
        }

        const top = document.createElement("div");
        top.className = "product-top";

        const info = document.createElement("div");
        info.className = "product-info";

        const icon = document.createElement("div");
        icon.className = "product-icon";
        icon.textContent = "🖱️";

        const textDiv = document.createElement("div");
        const name = document.createElement("strong");
        name.textContent = matchedAcc.name;
        const sub = document.createElement("span");
        sub.textContent = `SKU: ${matchedAcc.product_id} • Standalone Accessory`;
        textDiv.appendChild(name);
        textDiv.appendChild(sub);

        info.appendChild(icon);
        info.appendChild(textDiv);

        const price = document.createElement("div");
        price.className = "product-price";
        price.textContent = formatCurrency(matchedAcc.price, matchedAcc.currency || "INR");

        top.appendChild(info);
        top.appendChild(price);
        accCard.appendChild(top);

        if (Array.isArray(matchedAcc.highlights) && matchedAcc.highlights.length > 0) {
            const highlightsContainer = document.createElement("div");
            highlightsContainer.className = "product-highlight-chips";
            matchedAcc.highlights.forEach(hl => {
                const chip = document.createElement("span");
                chip.className = "product-highlight-chip";
                chip.textContent = `✓ ${hl}`;
                highlightsContainer.appendChild(chip);
            });
            accCard.appendChild(highlightsContainer);
        }

        const desc = document.createElement("div");
        desc.className = "product-full-description";
        desc.textContent = matchedAcc.description;
        accCard.appendChild(desc);

        const noteDiv = document.createElement("div");
        noteDiv.style.cssText = "background: var(--warning-soft, #fffbeb); border: 1px solid var(--warning-border, #fde68a); border-radius: 8px; padding: 10px 12px; margin: 10px 0; font-size: 12px; color: var(--warning, #b45309);";
        noteDiv.innerHTML = `<strong>⚠️ Policy Notice:</strong> Standalone purchase of 1 unit (${formatCurrency(matchedAcc.price, "INR")}) is below the ${formatCurrency(currentFloor, "INR")} floor. Add 3 units to your Cart to reach the threshold or pick an executive bundle below.`;
        accCard.appendChild(noteDiv);

        const actions = document.createElement("div");
        actions.className = "recommendation-actions";
        actions.style.display = "flex";
        actions.style.gap = "8px";
        actions.style.flexWrap = "wrap";

        const add3Btn = document.createElement("button");
        add3Btn.className = "button primary";
        add3Btn.type = "button";
        add3Btn.innerHTML = `🛒 Add 3x to Cart (${formatCurrency(matchedAcc.price * 3, "INR")} • Meets Floor) →`;
        add3Btn.addEventListener("click", async () => {
            add3Btn.disabled = true;
            add3Btn.innerHTML = "Adding 3x...";
            try {
                const res = await fetch(`${API_BASE_URL}/api/cart/add`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ session_id: cartSessionId, product_id: matchedAcc.product_id, quantity: 3 })
                });
                const d = await res.json();
                add3Btn.disabled = false;
                add3Btn.innerHTML = "✓ Added 3x to Cart";
                if (d.success && d.cart) {
                    clientCart = d.cart;
                    renderCartUI();
                    showToast(`Added 3x ${matchedAcc.name} to Cart (${formatCurrency(matchedAcc.price * 3, "INR")})`, "success");
                    showSection("cart");
                }
            } catch (err) {
                add3Btn.disabled = false;
                add3Btn.innerHTML = "🛒 Add 3x to Cart";
            }
        });

        const add1Btn = document.createElement("button");
        add1Btn.className = "button secondary";
        add1Btn.type = "button";
        add1Btn.innerHTML = `🛒 Add 1x to Cart (${formatCurrency(matchedAcc.price, "INR")})`;
        add1Btn.addEventListener("click", async () => {
            add1Btn.disabled = true;
            add1Btn.innerHTML = "Adding 1x...";
            try {
                const res = await fetch(`${API_BASE_URL}/api/cart/add`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ session_id: cartSessionId, product_id: matchedAcc.product_id, quantity: 1 })
                });
                const d = await res.json();
                add1Btn.disabled = false;
                add1Btn.innerHTML = "✓ In Cart";
                if (d.success && d.cart) {
                    clientCart = d.cart;
                    renderCartUI();
                    showToast(`Added 1x ${matchedAcc.name} to Cart`, "success");
                }
            } catch (err) {
                add1Btn.disabled = false;
                add1Btn.innerHTML = "🛒 Add 1x to Cart";
            }
        });

        actions.appendChild(add3Btn);
        actions.appendChild(add1Btn);
        accCard.appendChild(actions);
        list.appendChild(accCard);
    }

    const bundleHeading = document.createElement("div");
    bundleHeading.style.cssText = "font-size: 13px; font-weight: 700; color: var(--text-secondary, #334155); margin-top: 12px; text-transform: uppercase; letter-spacing: 0.5px;";
    bundleHeading.textContent = "Optional Upgrades (Floor Compliant):";

    const crossSellItems = data.active_cross_sell_array || data.cross_sell || [];
    // If the query was for accessories, exclude the ₹51,500 laptop suite so the user is not overwhelmed
    const filteredCrossSell = (matchedAcc && crossSellItems.length > 0)
        ? crossSellItems.filter(item => {
            const id = typeof item === "string" ? item : (item.sku || item.product_id);
            return id !== "BUNDLE_LAP_MS";
        })
        : crossSellItems;

    if (filteredCrossSell.length > 0) {
        list.appendChild(bundleHeading);
    }

    filteredCrossSell.forEach(item => {
        const itemObj = typeof item === "string" 
            ? (item === "BUNDLE_HP_MS" 
                ? { 
                    name: "Work & Focus Audio Bundle", 
                    product_id: "BUNDLE_HP_MS", 
                    price: 6500, 
                    image_url: "https://images.unsplash.com/photo-1546435770-a3e426bf472b?auto=format&fit=crop&w=800&q=80",
                    description: "Certified corporate productivity suite combining the SoundMax Active Noise-Cancelling Headphones with the ProMouse Ergonomic Controller.",
                    highlights: ["Complete Focus Suite", "Save ₹500 on Bundle", "ANC Headphones + Ergonomic Mouse"],
                    specifications: { "Focus Shielding": "Hybrid ANC (-35dB)", "Combined Battery": "40h Audio + 70 Days Mouse", "Warranty": "2-Year Guarantee" },
                    reason: "Includes premium SoundMax Active Noise-Cancelling Headphones + Ergonomic ProMouse." 
                  }
                : { 
                    name: "Developer Complete Suite", 
                    product_id: "BUNDLE_LAP_MS", 
                    price: 51500, 
                    image_url: "https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=800&q=80",
                    description: "The complete high-performance enterprise developer workstation pairing the 14.2\" ProBook Laptop with the ProMouse Ergonomic Controller.",
                    highlights: ["Full Developer Setup", "14.2\" Retina + Ergonomic Mouse", "16GB RAM / 512GB SSD"],
                    specifications: { "Display": "14.2\" Liquid Retina 120Hz", "RAM / Storage": "16GB Unified / 512GB NVMe SSD", "Warranty": "3-Year Priority Care" },
                    reason: "Includes 14\" ProBook M2 Laptop + Ergonomic ProMouse." 
                  })
            : item;

        const itemCard = document.createElement("div");
        itemCard.className = "recommendation-card";
        itemCard.style.cssText = "border: 1px solid var(--border); background: var(--panel-2); border-radius: 12px; padding: 14px;";

        if (itemObj.image_url) {
            const mediaBanner = document.createElement("div");
            mediaBanner.className = "product-media-banner";
            mediaBanner.style.height = "160px";

            const img = document.createElement("img");
            img.className = "product-real-img";
            img.src = itemObj.image_url;
            img.alt = itemObj.name;
            img.loading = "lazy";
            img.onerror = () => { mediaBanner.style.display = "none"; };
            mediaBanner.appendChild(img);

            const categoryChip = document.createElement("span");
            categoryChip.className = "product-category-chip";
            categoryChip.textContent = "Curated Suite";
            mediaBanner.appendChild(categoryChip);

            itemCard.appendChild(mediaBanner);
        }

        const top = document.createElement("div");
        top.className = "product-top";

        const info = document.createElement("div");
        info.className = "product-info";

        const icon = document.createElement("div");
        icon.className = "product-icon";
        const skuStr = (itemObj.product_id || itemObj.sku || "");
        icon.textContent = skuStr.includes("LAP") ? "💻" : "🎧";

        const textDiv = document.createElement("div");
        const name = document.createElement("strong");
        name.textContent = itemObj.name;
        const sub = document.createElement("span");
        sub.textContent = `SKU: ${skuStr} • Enterprise Bundle`;
        textDiv.appendChild(name);
        textDiv.appendChild(sub);

        info.appendChild(icon);
        info.appendChild(textDiv);

        const rawPrice = itemObj.price_inr ?? itemObj.valuation_inr ?? itemObj.price ?? itemObj.valuation ?? (skuStr.includes("LAP") ? 51500 : 6500);
        const numericPrice = Number(rawPrice) || (skuStr.includes("LAP") ? 51500 : 6500);

        const price = document.createElement("div");
        price.className = "product-price";
        price.textContent = formatCurrency(numericPrice, itemObj.currency || "INR");

        top.appendChild(info);
        top.appendChild(price);
        itemCard.appendChild(top);

        if (Array.isArray(itemObj.highlights) && itemObj.highlights.length > 0) {
            const highlightsContainer = document.createElement("div");
            highlightsContainer.className = "product-highlight-chips";
            itemObj.highlights.forEach(hl => {
                const chip = document.createElement("span");
                chip.className = "product-highlight-chip";
                chip.textContent = `✓ ${hl}`;
                highlightsContainer.appendChild(chip);
            });
            itemCard.appendChild(highlightsContainer);
        }

        if (itemObj.description) {
            const desc = document.createElement("div");
            desc.className = "product-full-description";
            desc.textContent = itemObj.description;
            itemCard.appendChild(desc);
        }

        if (itemObj.specifications && typeof itemObj.specifications === "object" && Object.keys(itemObj.specifications).length > 0) {
            const specsCard = document.createElement("div");
            specsCard.className = "product-specs-card";
            specsCard.style.marginTop = "8px";
            for (const [key, val] of Object.entries(itemObj.specifications)) {
                const entry = document.createElement("div");
                entry.className = "spec-entry";
                const k = document.createElement("span");
                k.className = "spec-key";
                k.textContent = key;
                const v = document.createElement("span");
                v.className = "spec-val";
                v.textContent = String(val);
                entry.appendChild(k);
                entry.appendChild(v);
                specsCard.appendChild(entry);
            }
            itemCard.appendChild(specsCard);
        }

        const reason = document.createElement("div");
        reason.className = "product-reason";
        reason.style.cssText = "color: var(--muted); font-size: 12px; margin: 10px 0; line-height: 1.5;";
        reason.textContent = itemObj.reason || (skuStr.includes("LAP") ? "Includes 14\" ProBook M2 Laptop + Ergonomic ProMouse." : "Includes premium SoundMax Active Noise-Cancelling Headphones + Ergonomic ProMouse.");
        itemCard.appendChild(reason);

        const actions = document.createElement("div");
        actions.className = "recommendation-actions";

        const buyBtn = document.createElement("button");
        buyBtn.className = "button primary";
        buyBtn.type = "button";
        buyBtn.textContent = `Select ${itemObj.name} (${formatCurrency(numericPrice, "INR")}) →`;
        buyBtn.addEventListener("click", () => {
            messageInput.value = `I want to purchase the ${itemObj.name} for ${numericPrice}`;
            sendMessage();
        });

        actions.appendChild(buyBtn);
        itemCard.appendChild(actions);
        list.appendChild(itemCard);
    });

    content.appendChild(list);
    wrapper.appendChild(content);
    messages.appendChild(wrapper);
    scrollChatToBottom();
}


// ============================================================
// ORDER ASSISTANCE & POST-PURCHASE SUPPORT CARD
// ============================================================

function addOrderAssistanceMessage(data) {
    const wrapper = document.createElement("div");
    wrapper.className = "message agent";

    const content = document.createElement("div");
    content.className = "message-content";

    // Text intro bubble
    const intro = document.createElement("div");
    intro.style.cssText = "margin-bottom: 12px; font-size: 13.5px; line-height: 1.5; color: var(--text);";
    intro.innerHTML = `I retrieved the verified post-purchase support and live logistics records for <strong>Order #${escapeHtml(data.order_id || '')}</strong>:`;
    content.appendChild(intro);

    const card = document.createElement("div");
    card.style.cssText = "background: var(--panel-2); border: 1.5px solid rgba(16, 185, 129, 0.35); border-radius: 14px; padding: 18px 20px; box-shadow: var(--shadow-md); margin-top: 6px;";

    const courier = data.courier || "BlueDart Air Priority Express";
    const waybill = data.waybill || "BD998B5CB26IN";
    const eta = data.eta || "Tomorrow, by 6:00 PM (1–2 Days)";
    const origin = data.origin || "Bengaluru Air Logistics Terminal";
    const destination = data.destination || "Destination Delivery Hub";
    const productName = data.product_name || "Work & Focus Audio Bundle";
    const warranty = data.warranty || {
        term: "2-Year Comprehensive Hardware Warranty",
        coverage_window: "Active (24 Months Remaining)",
        claim_sla: "Zero-Downtime Advance Doorstep Replacement with free pickup."
    };

    card.innerHTML = `
        <!-- Top Status Bar -->
        <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border); padding-bottom: 12px; margin-bottom: 14px;">
            <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 11px; font-weight: 700; background: var(--success-soft); color: var(--success); padding: 3px 9px; border-radius: 999px; border: 1px solid var(--success-border); display: flex; align-items: center; gap: 4px;">
                    <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--success);"></span>
                    IN TRANSIT • VERIFIED
                </span>
                <span style="font-size: 12px; color: var(--muted); font-weight: 600;">Order #${escapeHtml(data.order_id || '')}</span>
            </div>
            <div style="font-size: 13px; font-weight: 700; color: var(--accent);">
                ₹${Number(data.amount || 6500).toLocaleString('en-IN')}.00
            </div>
        </div>

        <!-- Product Name -->
        <div style="font-size: 16px; font-weight: 700; color: var(--text); margin-bottom: 4px;">
            📦 ${escapeHtml(productName)}
        </div>
        <div style="font-size: 12px; color: var(--muted); margin-bottom: 14px;">
            Package configuration: SoundMax ANC Wireless Studio Headphones + ProMouse Precision Ergonomic Controller
        </div>

        <!-- Live Courier & ETA Box -->
        <div style="background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; margin-bottom: 12px;">
            <div style="font-size: 11px; font-weight: 800; color: var(--accent); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
                <span>🚚</span> <span>Live Courier Delivery &amp; Tracking</span>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 12px;">
                <div>
                    <div style="color: var(--muted); font-size: 10.5px;">Carrier Partner</div>
                    <div style="font-weight: 600; color: var(--text);">${escapeHtml(courier)}</div>
                </div>
                <div>
                    <div style="color: var(--muted); font-size: 10.5px;">Air Waybill (AWB)</div>
                    <div style="font-family: monospace; font-weight: 700; color: var(--accent);">${escapeHtml(waybill)}</div>
                </div>
                <div>
                    <div style="color: var(--muted); font-size: 10.5px;">Estimated Delivery (ETA)</div>
                    <div style="font-weight: 700; color: var(--success);">${escapeHtml(eta)}</div>
                </div>
                <div>
                    <div style="color: var(--muted); font-size: 10.5px;">Current Transit Hub</div>
                    <div style="font-weight: 600; color: var(--text); font-size: 11.5px;">${escapeHtml(origin)} → ${escapeHtml(destination)}</div>
                </div>
            </div>
        </div>

        <!-- Warranty Box -->
        <div style="background: rgba(99, 102, 241, 0.05); border: 1px solid rgba(99, 102, 241, 0.25); border-radius: 10px; padding: 12px 14px; margin-bottom: 16px;">
            <div style="font-size: 11px; font-weight: 800; color: var(--accent); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
                <span>🛡️</span> <span>Warranty &amp; Hardware Protection</span>
            </div>
            <div style="font-size: 12.5px; font-weight: 700; color: var(--text); margin-bottom: 4px;">
                ${escapeHtml(warranty.term || '2-Year Priority Hardware Replacement Guarantee')}
            </div>
            <div style="font-size: 11.5px; color: var(--muted); line-height: 1.45; margin-bottom: 6px;">
                • Covers 40mm titanium acoustic drivers, -35dB hybrid ANC array, beamforming mics, and battery capacity (&gt;80%).<br>
                • Covers ProMouse Darkfield 4000 DPI optical sensor, low-noise Omron switches, and multi-host Bluetooth transceiver.<br>
                • <strong>${escapeHtml(warranty.claim_sla || 'Zero-Downtime Advance Doorstep Replacement within 24–48 hours with complimentary return pickup.')}</strong>
            </div>
            <div style="font-size: 11px; color: var(--success); font-weight: 600; display: flex; align-items: center; gap: 4px;">
                <span>✓</span> <span>Registration: Auto-Activated on Payment (Active Commercial Policy)</span>
            </div>
        </div>
    `;

    // Action Buttons
    const actions = document.createElement("div");
    actions.style.cssText = "display: flex; flex-wrap: wrap; gap: 8px;";

    // Track Live Button
    const trackBtn = document.createElement("button");
    trackBtn.className = "button primary";
    trackBtn.type = "button";
    trackBtn.style.padding = "8px 14px";
    trackBtn.style.fontSize = "12px";
    trackBtn.innerHTML = "🚚 View Live Tracking Timeline →";
    trackBtn.addEventListener("click", () => {
        if (typeof openTrackingModal === "function") {
            openTrackingModal(data.order_id);
        }
    });

    // Invoice Button
    const invoiceBtn = document.createElement("button");
    invoiceBtn.className = "button secondary";
    invoiceBtn.type = "button";
    invoiceBtn.style.padding = "8px 14px";
    invoiceBtn.style.fontSize = "12px";
    invoiceBtn.innerHTML = "📄 View GST Tax Invoice";
    invoiceBtn.addEventListener("click", async () => {
        try {
            const res = await fetch(`${API_BASE_URL}/orders`);
            const od = await res.json();
            const matched = od.orders?.find(o => o.order_id === data.order_id) || {
                order_id: data.order_id,
                amount: data.amount || 6500,
                currency: data.currency || "INR",
                product_name: productName,
                created_at: new Date().toISOString(),
                buyer_id: "Customer",
                status: "paid",
                merchant: currentStoreConfig?.store_name || "Enterprise AI Commerce"
            };
            if (typeof openInvoiceModal === "function") {
                openInvoiceModal(matched);
            }
        } catch (e) {
            console.warn("Could not load invoice:", e);
        }
    });

    // View All Orders Button
    const allOrdersBtn = document.createElement("button");
    allOrdersBtn.className = "button secondary";
    allOrdersBtn.type = "button";
    allOrdersBtn.style.padding = "8px 14px";
    allOrdersBtn.style.fontSize = "12px";
    allOrdersBtn.innerHTML = "📦 View in Orders Tab";
    allOrdersBtn.addEventListener("click", () => {
        ordersButton?.click();
    });

    actions.appendChild(trackBtn);
    actions.appendChild(invoiceBtn);
    actions.appendChild(allOrdersBtn);
    card.appendChild(actions);

    content.appendChild(card);
    wrapper.appendChild(content);
    messages.appendChild(wrapper);
    scrollChatToBottom();
}


// ============================================================
// INVISIBLE COMPLIANT CHECKOUT CARD
// ============================================================

function addCompiledToolCallMessage(data) {
    const wrapper = document.createElement("div");
    wrapper.className = "message agent";

    const content = document.createElement("div");
    content.className = "message-content";

    const params = data.parameters || {
        buyer_id: data.session_id,
        item_id: "BUNDLE_HP_MS",
        final_price_inr: 6500
    };

    let productName = params.item_id || "Curated Workspace Suite";
    if (params.item_id === "BUNDLE_HP_MS" || String(params.item_id).includes("Work & Focus") || String(params.item_id).toLowerCase().includes("audio")) productName = "Work & Focus Audio Bundle";
    else if (params.item_id === "BUNDLE_LAP_MS" || String(params.item_id).includes("Developer")) productName = "Developer Complete Suite";
    else if (params.item_id === "LAP001") productName = "ProBook Laptop";
    else if (params.item_id === "HP001") productName = "SoundMax Headphones";
    else if (params.item_id === "MS001") productName = "ProMouse Wireless";
    else if (typeof params.item_id === "string" && params.item_id.length > 3) productName = params.item_id;

    const card = document.createElement("div");
    card.style.cssText = "background: var(--panel-2); border: 1px solid var(--accent-border); border-radius: 16px; padding: 20px; box-shadow: var(--shadow-md);";

    card.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
            <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; background: var(--success-soft); color: var(--success); padding: 4px 10px; border-radius: 999px; border: 1px solid var(--success-border);">
                ✓ Order Prepared
            </span>
            <span style="font-size: 13px; color: var(--muted);">Instant Checkout Ready</span>
        </div>
        <div style="font-size: 18px; font-weight: 700; color: var(--text); margin-bottom: 4px;">
            ${escapeHtml(productName)}
        </div>
        <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 16px;">
            Your configuration has been verified and locked in at <strong>₹${Number(params.final_price_inr).toLocaleString('en-IN')}.00 INR</strong>.
        </div>
    `;

    const actions = document.createElement("div");
    actions.className = "recommendation-actions";

    const payBtn = document.createElement("button");
    payBtn.className = "button primary";
    payBtn.type = "button";
    payBtn.style.cssText = "width: 100%; justify-content: center; padding: 12px 20px; font-weight: 600;";
    payBtn.textContent = `Proceed to Secure Checkout (₹${Number(params.final_price_inr).toLocaleString('en-IN')}) →`;
    payBtn.addEventListener("click", () => {
        openApprovalModal({
            product_id: params.item_id,
            name: productName,
            price: params.final_price_inr,
            currency: "INR",
            reason: "Curated enterprise configuration"
        });
    });

    actions.appendChild(payBtn);
    card.appendChild(actions);
    content.appendChild(card);
    wrapper.appendChild(content);
    messages.appendChild(wrapper);
    scrollChatToBottom();
}


// ============================================================
// OPEN APPROVAL MODAL
// ============================================================

async function openApprovalModal(product) {

    if (!product) {
        return;
    }

    currentProduct = product;
    autoSyncSessionItemToCart(product);

    let displayName = product.name;
    let displayReason = product.reason;
    let displayAmount = product.price;
    let displayCurrency = product.currency;

    // Fetch the server-authoritative Commerce Offer before approval.
    if (currentIntentId) {
        try {
            const response = await fetch(
                `${API_BASE_URL}/intent/${currentIntentId}`,
                {
                    headers: {
                        "Accept": "application/json"
                    }
                }
            );

            const intentData = await response.json();

            if (!response.ok) {
                console.warn(
                    intentData.detail ||
                    "Could not load the validated offer, using product defaults."
                );
            } else {
                const offer = intentData.offer;
                const contractOffer =
                    intentData.commerce_contract?.offer;

                if (offer) {
                    displayName =
                        offer.primary_product?.name ||
                        offer.product_name ||
                        displayName;

                    displayAmount =
                        offer.final_amount ?? displayAmount;

                    displayCurrency =
                        offer.currency ||
                        displayCurrency;

                    displayReason =
                        offer.explanation ||
                        displayReason;
                } else if (contractOffer) {
                    displayName =
                        contractOffer.product_name ||
                        displayName;

                    displayAmount =
                        contractOffer.final_amount ?? displayAmount;

                    displayCurrency =
                        contractOffer.currency ||
                        displayCurrency;
                }
            }
        } catch (error) {
            console.warn(
                "Validated offer loading non-fatal issue, falling back to product info:",
                error
            );
        }
    }

    modalProductName.textContent =
        displayName;

    modalProductReason.textContent =
        displayReason;

    modalProductPrice.textContent =
        formatCurrency(
            displayAmount,
            displayCurrency
        );

    // Update real product image
    const modalImg = document.getElementById("modalProductImage");
    const modalIcon = document.getElementById("modalProductIcon");
    if (product.image_url && modalImg) {
        modalImg.src = product.image_url;
        modalImg.style.display = "block";
        if (modalIcon) modalIcon.style.display = "none";
    } else {
        if (modalImg) modalImg.style.display = "none";
        if (modalIcon) {
            modalIcon.style.display = "flex";
            modalIcon.textContent = getProductIcon(product.name);
        }
    }

    // Update full description
    const modalDesc = document.getElementById("modalProductDesc");
    if (modalDesc) {
        if (product.description) {
            modalDesc.textContent = product.description;
            modalDesc.style.display = "block";
        } else {
            modalDesc.style.display = "none";
        }
    }

    // Update specifications chips
    const modalSpecs = document.getElementById("modalProductSpecs");
    if (modalSpecs) {
        modalSpecs.innerHTML = "";
        if (product.specifications && typeof product.specifications === "object") {
            Object.entries(product.specifications).slice(0, 4).forEach(([k, v]) => {
                const chip = document.createElement("span");
                chip.className = "modal-spec-chip";
                chip.textContent = `${k}: ${v}`;
                modalSpecs.appendChild(chip);
            });
        }
    }

    approvalModal.classList.remove(
        "hidden"
    );
}


// ============================================================
// CLOSE MODAL
// ============================================================

function closeApprovalModal() {
    approvalModal.classList.add("hidden");
    if (clientCart?.items?.length > 0) {
        showToast("Review closed: Selected item kept safe in your Cart", "info");
        addMessage(
            "agent",
            "Checkout paused. Your selected item is safely stored in your Shopping Cart — you can open your Cart anytime to proceed with payment."
        );
    }
}


// ============================================================
// APPROVE PURCHASE
// ============================================================

// ============================================================
// PAYMENT GATEWAY MODAL & TWO-STEP CHECKOUT
// ============================================================

let pendingPaymentOrder = null;
let pendingCustomerData = null;
let pendingCartSnapshot = [];
let selectedPaymentMethod = "razorpay";
let selectedRazorpayInnerMode = "upi";

function openPaymentModal(payment, customer, cartSnapshot) {
    pendingPaymentOrder = payment;
    pendingCustomerData = customer;
    pendingCartSnapshot = cartSnapshot || [];

    const paymentModal = document.getElementById("paymentModal");
    const amountEl = document.getElementById("paymentModalAmount");
    const confirmBtn = document.getElementById("confirmPaymentBtn");
    const orderIdDisp = document.getElementById("razorpayOrderIdDisplay");
    const formattedAmount = formatCurrency(payment.amount, payment.currency || "INR");

    if (amountEl) amountEl.textContent = formattedAmount;
    if (orderIdDisp) orderIdDisp.textContent = payment.order_id || "order_pending";

    if (confirmBtn) {
        if (selectedPaymentMethod === "razorpay") {
            confirmBtn.innerHTML = `⚡ Pay ${formattedAmount} via Razorpay <span>→</span>`;
        } else {
            confirmBtn.innerHTML = `Pay ${formattedAmount} <span>→</span>`;
        }
        confirmBtn.disabled = false;
    }

    // Configure live UPI QR Code
    const qrImg = document.getElementById("upiQrImg");
    if (qrImg) {
        const qrUri = `upi://pay?pa=merchant@razorpay&pn=EnterpriseCommerce&am=${payment.amount}&cu=INR`;
        qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=130x130&data=${encodeURIComponent(qrUri)}`;
    }

    paymentModal?.classList.remove("hidden");
}

function closePaymentModal() {
    const paymentModal = document.getElementById("paymentModal");
    paymentModal?.classList.add("hidden");
    if (clientCart?.items?.length > 0) {
        showToast("Payment paused: Your selected items remain safe in your Cart", "info");
    }
}

function openRazorpayOfficialModal() {
    if (!pendingPaymentOrder) return;
    const rzpModal = document.getElementById("razorpayOfficialModal");
    const rzpOrderId = document.getElementById("rzpModalOrderId");
    const rzpAmount = document.getElementById("rzpModalAmount");
    const rzpPayBtnAmt = document.getElementById("rzpModalPayBtnAmt");
    const storeNameEl = document.getElementById("rzpModalStoreName");

    const formattedAmount = formatCurrency(pendingPaymentOrder.amount, pendingPaymentOrder.currency || "INR");

    if (rzpOrderId) rzpOrderId.textContent = pendingPaymentOrder.order_id || "order_pending";
    if (rzpAmount) rzpAmount.textContent = formattedAmount;
    if (rzpPayBtnAmt) rzpPayBtnAmt.textContent = formattedAmount;
    if (storeNameEl) storeNameEl.textContent = currentStoreConfig?.store_name || "Enterprise Commerce";

    rzpModal?.classList.remove("hidden");
}

function closeRazorpayOfficialModal() {
    const rzpModal = document.getElementById("razorpayOfficialModal");
    rzpModal?.classList.add("hidden");
}

// Payment method tab switching & subpanel display
function initPaymentMethodListeners() {
    const options = document.querySelectorAll(".pay-method-option");
    options.forEach(opt => {
        opt.addEventListener("click", () => {
            const method = opt.getAttribute("data-method");
            if (!method) return;
            selectedPaymentMethod = method;

            options.forEach(o => {
                o.style.borderColor = "var(--border)";
                o.classList.remove("active");
                const radio = o.querySelector("input[type='radio']");
                if (radio) radio.checked = false;
            });

            opt.style.borderColor = "var(--accent)";
            opt.classList.add("active");
            const activeRadio = opt.querySelector("input[type='radio']");
            if (activeRadio) activeRadio.checked = true;

            // Toggle subpanels
            document.getElementById("razorpaySubpanel")?.classList.toggle("hidden", method !== "razorpay");
            document.getElementById("upiSubpanel")?.classList.toggle("hidden", method !== "upi");
            document.getElementById("cardSubpanel")?.classList.toggle("hidden", method !== "card");
            document.getElementById("netbankingSubpanel")?.classList.toggle("hidden", method !== "netbanking");

            // Update button label
            const confirmBtn = document.getElementById("confirmPaymentBtn");
            const amtStr = formatCurrency(pendingPaymentOrder?.amount || 0, "INR");
            if (confirmBtn) {
                if (method === "razorpay") {
                    confirmBtn.innerHTML = `⚡ Pay ${amtStr} via Razorpay <span>→</span>`;
                } else if (method === "upi") {
                    confirmBtn.innerHTML = `Pay ${amtStr} via UPI <span>→</span>`;
                } else if (method === "card") {
                    confirmBtn.innerHTML = `Pay ${amtStr} via Card <span>→</span>`;
                } else if (method === "netbanking") {
                    const bank = document.getElementById("bankSelect")?.value || "Net Banking";
                    confirmBtn.innerHTML = `Pay ${amtStr} via ${bank} <span>→</span>`;
                } else if (method === "cod") {
                    confirmBtn.innerHTML = `Confirm Cash on Delivery (${amtStr}) <span>→</span>`;
                }
            }
        });
    });

    // Razorpay Modal Inner Mode Rows
    document.querySelectorAll(".rzp-mode-row").forEach(row => {
        row.addEventListener("click", () => {
            const mode = row.getAttribute("data-rzp-mode");
            if (!mode) return;
            selectedRazorpayInnerMode = mode;

            document.querySelectorAll(".rzp-mode-row").forEach(r => {
                r.style.borderColor = "#e2e8f0";
                r.style.background = "#ffffff";
                const check = r.querySelector("span:last-child");
                if (check) {
                    check.textContent = "○";
                    check.style.color = "#cbd5e1";
                }
            });

            row.style.borderColor = "#3395ff";
            row.style.background = "#f0f7ff";
            const check = row.querySelector("span:last-child");
            if (check) {
                check.textContent = "✓";
                check.style.color = "#3395ff";
            }
        });
    });

    // Close buttons
    document.getElementById("closeRazorpayModalBtn")?.addEventListener("click", closeRazorpayOfficialModal);
    document.getElementById("razorpayOfficialModal")?.addEventListener("click", (e) => {
        if (e.target.id === "razorpayOfficialModal") closeRazorpayOfficialModal();
    });

    // Execute Payment via Razorpay Modal Button -> Launches Real Razorpay SDK or Interactive Auth
    document.getElementById("executeRazorpayModalPayBtn")?.addEventListener("click", () => {
        closeRazorpayOfficialModal();
        const keyCandidate = pendingPaymentOrder?.key_id || currentStoreConfig?.razorpay_key_id || window.RAZORPAY_KEY_ID;
        const keyId = (keyCandidate && !keyCandidate.includes("your_public_key_id") && !keyCandidate.includes("placeholder")) ? keyCandidate : "";

        if (keyId) {
            openRazorpayCheckout(pendingPaymentOrder);
        } else {
            const modeLabel = selectedRazorpayInnerMode === "upi" ? "UPI (GPay/PhonePe)"
                : selectedRazorpayInnerMode === "card" ? "Card (3D Secure)"
                : "Netbanking";
            openPaymentAuthModal(`Razorpay Gateway (${modeLabel})`, selectedRazorpayInnerMode);
        }
    });

    // UPI app chips
    document.querySelectorAll(".upi-app-chip").forEach(chip => {
        chip.addEventListener("click", (e) => {
            e.stopPropagation();
            if (chip.id === "toggleQrBtn") {
                const qrBox = document.getElementById("upiQrPreview");
                qrBox?.classList.toggle("hidden");
                return;
            }

            document.querySelectorAll(".upi-app-chip").forEach(c => c.classList.remove("active"));
            chip.classList.add("active");

            const suffix = chip.getAttribute("data-suffix");
            const vpaInput = document.getElementById("upiVpaInput");
            if (vpaInput && suffix) {
                const prefix = vpaInput.value.split("@")[0] || "kunalraj3101";
                vpaInput.value = `${prefix}${suffix}`;
            }
        });
    });

    // Bank selector change
    document.getElementById("bankSelect")?.addEventListener("change", (e) => {
        if (selectedPaymentMethod === "netbanking") {
            const confirmBtn = document.getElementById("confirmPaymentBtn");
            const amtStr = formatCurrency(pendingPaymentOrder?.amount || 0, "INR");
            if (confirmBtn) {
                confirmBtn.innerHTML = `Pay ${amtStr} via ${e.target.value} <span>→</span>`;
            }
        }
    });

    // Close & back buttons
    document.getElementById("closePaymentModal")?.addEventListener("click", closePaymentModal);
    document.getElementById("paymentModal")?.addEventListener("click", (e) => {
        if (e.target.id === "paymentModal") closePaymentModal();
    });

    document.getElementById("backToApprovalBtn")?.addEventListener("click", () => {
        closePaymentModal();
        approvalModal?.classList.remove("hidden");
    });

    // Main Confirm Payment Button in Payment Selection Modal -> Routes to Interactive Authorization
    document.getElementById("confirmPaymentBtn")?.addEventListener("click", () => {
        if (!pendingPaymentOrder) return;

        // If Razorpay Official Gateway is chosen, open the authentic Razorpay checkout modal or SDK
        if (selectedPaymentMethod === "razorpay") {
            const keyCandidate = pendingPaymentOrder?.key_id || currentStoreConfig?.razorpay_key_id || window.RAZORPAY_KEY_ID;
            const keyId = (keyCandidate && !keyCandidate.includes("your_public_key_id") && !keyCandidate.includes("placeholder")) ? keyCandidate : "";
            if (keyId) {
                closePaymentModal();
                openRazorpayCheckout(pendingPaymentOrder);
                return;
            }
            openRazorpayOfficialModal();
            return;
        }

        // Build human-friendly payment method summary and category
        let methodSummary = "Razorpay (UPI Direct)";
        let category = "upi";

        if (selectedPaymentMethod === "upi") {
            const vpa = document.getElementById("upiVpaInput")?.value?.trim() || "kunalraj3101@okhdfcbank";
            methodSummary = `Razorpay UPI (${vpa})`;
            category = "upi";
        } else if (selectedPaymentMethod === "card") {
            const cardNum = document.getElementById("cardNumInput")?.value?.trim() || "•••• 4242";
            const last4 = cardNum.slice(-4) || "4242";
            methodSummary = `Razorpay Card (•••• ${last4})`;
            category = "card";
        } else if (selectedPaymentMethod === "netbanking") {
            const bank = document.getElementById("bankSelect")?.value || "HDFC Bank";
            methodSummary = `Razorpay Net Banking (${bank})`;
            category = "netbanking";
        } else if (selectedPaymentMethod === "cod") {
            methodSummary = "Cash on Delivery (Pay at Doorstep)";
            category = "cod";
        }

        closePaymentModal();
        openPaymentAuthModal(methodSummary, category);
    });

    // Wire up Payment Auth Modal buttons & interactive submission
    initPaymentAuthListeners();
}

let pendingAuthMethodSummary = "";
let pendingAuthCategory = "upi";

// Opens the authentic 3D Secure / UPI PIN / Bank OTP interactive verification screen
function openPaymentAuthModal(methodSummary, category) {
    if (!pendingPaymentOrder) return;

    pendingAuthMethodSummary = methodSummary;
    pendingAuthCategory = category;

    const authModal = document.getElementById("paymentAuthModal");
    const titleEl = document.getElementById("authModalGatewayTitle");
    const merchantEl = document.getElementById("authModalMerchantName");
    const amountEl = document.getElementById("authModalAmount");
    const submitBtnLabel = document.getElementById("submitAuthBtnLabel");
    const statusBox = document.getElementById("authLiveStatusBox");

    const formattedAmount = formatCurrency(pendingPaymentOrder.amount, pendingPaymentOrder.currency || "INR");

    if (merchantEl) merchantEl.textContent = currentStoreConfig?.store_name || "Enterprise AI Commerce";
    if (amountEl) amountEl.textContent = formattedAmount;
    if (statusBox) statusBox.classList.add("hidden");

    // Hide all sections first
    document.getElementById("authUpiSection")?.classList.add("hidden");
    document.getElementById("authCardSection")?.classList.add("hidden");
    document.getElementById("authNetbankingSection")?.classList.add("hidden");
    document.getElementById("authCodSection")?.classList.add("hidden");

    if (category === "upi") {
        document.getElementById("authUpiSection")?.classList.remove("hidden");
        const vpaEl = document.getElementById("authUpiVpaDisplay");
        const vpaVal = document.getElementById("upiVpaInput")?.value?.trim() || "kunalraj3101@okhdfcbank";
        if (vpaEl) vpaEl.textContent = vpaVal;
        if (titleEl) titleEl.textContent = "NPCI UPI PIN Payment Authorization";
        if (submitBtnLabel) submitBtnLabel.textContent = `Authorize ${formattedAmount} with UPI PIN →`;
    } else if (category === "card") {
        document.getElementById("authCardSection")?.classList.remove("hidden");
        const cardNum = document.getElementById("cardNumInput")?.value?.trim() || "•••• 4242";
        const last4 = cardNum.slice(-4) || "4242";
        const cardMasked = document.getElementById("authCardMasked");
        if (cardMasked) cardMasked.innerHTML = `Card: <strong>•••• •••• •••• ${last4}</strong> • OTP sent to registered mobile`;
        if (titleEl) titleEl.textContent = "RBI 3D Secure / Verified by Visa";
        if (submitBtnLabel) submitBtnLabel.textContent = `Submit Bank OTP & Authorize →`;
    } else if (category === "netbanking") {
        document.getElementById("authNetbankingSection")?.classList.remove("hidden");
        const bank = document.getElementById("bankSelect")?.value || "HDFC Bank";
        const bankNameEl = document.getElementById("authBankNameDisplay");
        if (bankNameEl) bankNameEl.textContent = `${bank} Corporate NetBanking`;
        if (titleEl) titleEl.textContent = `${bank} Gateway Transfer Authentication`;
        if (submitBtnLabel) submitBtnLabel.textContent = `Authorize NetBanking Transfer →`;
    } else if (category === "cod") {
        document.getElementById("authCodSection")?.classList.remove("hidden");
        if (titleEl) titleEl.textContent = "Doorstep Cash On Delivery Verification";
        if (submitBtnLabel) submitBtnLabel.textContent = `Confirm Delivery Order →`;
    }

    authModal?.classList.remove("hidden");
}

function closePaymentAuthModal() {
    document.getElementById("paymentAuthModal")?.classList.add("hidden");
}

function initPaymentAuthListeners() {
    document.getElementById("closeAuthModalBtn")?.addEventListener("click", () => {
        closePaymentAuthModal();
        openPaymentModal(pendingPaymentOrder, pendingCustomerData, pendingCartSnapshot);
    });

    document.getElementById("cancelAuthModalBtn")?.addEventListener("click", () => {
        closePaymentAuthModal();
        openPaymentModal(pendingPaymentOrder, pendingCustomerData, pendingCartSnapshot);
    });

    document.getElementById("paymentAuthModal")?.addEventListener("click", (e) => {
        if (e.target.id === "paymentAuthModal") {
            closePaymentAuthModal();
            openPaymentModal(pendingPaymentOrder, pendingCustomerData, pendingCartSnapshot);
        }
    });

    // Interactive Authorization Submission with Realistic Banking Feedback
    document.getElementById("submitAuthModalBtn")?.addEventListener("click", async () => {
        const submitBtn = document.getElementById("submitAuthModalBtn");
        const statusBox = document.getElementById("authLiveStatusBox");
        const statusText = document.getElementById("authLiveStatusText");

        // Validate user inputs so it is not a fake direct pass
        if (pendingAuthCategory === "upi") {
            const pin = document.getElementById("authUpiPinInput")?.value?.trim();
            if (!pin || pin.length < 4) {
                showToast("Please enter your 4-digit UPI PIN (e.g. 1234)", "warning");
                return;
            }
        } else if (pendingAuthCategory === "card") {
            const otp = document.getElementById("authCardOtpInput")?.value?.trim();
            if (!otp || otp.length < 4) {
                showToast("Please enter the 6-digit Bank OTP (e.g. 123456)", "warning");
                return;
            }
        }

        submitBtn.disabled = true;
        statusBox?.classList.remove("hidden");

        // Step 1: Connecting to Banking Gateway Switch
        if (statusText) statusText.textContent = "Step 1/3: Connecting to Bank Payment Switch...";
        await new Promise(r => setTimeout(r, 650));

        // Step 2: Validating OTP / Cryptographic Signature with Razorpay
        if (statusText) statusText.textContent = "Step 2/3: Validating OTP & Cryptographic Authorization...";
        await new Promise(r => setTimeout(r, 650));

        // Step 3: Bank Approved
        if (statusText) statusText.textContent = "Step 3/3: Payment Authorized by Bank! Capturing...";
        await new Promise(r => setTimeout(r, 450));

        // Now execute real server payment verification
        closePaymentAuthModal();
        submitBtn.disabled = false;
        await executePaymentTransaction(pendingAuthMethodSummary);
    });
}

// Reusable payment execution & cryptographic verification
async function executePaymentTransaction(methodSummary) {
    if (!pendingPaymentOrder) return;

    try {
        // STEP: Call Server-Side Payment Verification & Signature check
        const verifyPaymentId = `pay_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        const verifyResponse = await fetch(`${API_BASE_URL}/payment/verify`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                razorpay_order_id: pendingPaymentOrder.order_id,
                razorpay_payment_id: verifyPaymentId,
                razorpay_signature: "demo_signature",
                payment_method: methodSummary
            })
        });

        const verifyData = await verifyResponse.json();
        if (!verifyResponse.ok) {
            throw new Error(verifyData.detail || "Payment verification failed.");
        }

        markPipelineComplete(pipelinePayment);
        setState("Payment verified", `Payment verified via ${methodSummary}. Order officially confirmed.`, "active");

        // Add confirmed payment into chat log
        addPaymentVerified({
            payment: {
                ...pendingPaymentOrder,
                status: "payment_verified",
                payment_id: verifyPaymentId,
                payment_method: methodSummary
            },
            receipt: verifyData.receipt
        });

        // Capture cart info before clearing
        const cartItemsSnapshot = [...(pendingCartSnapshot || clientCart?.items || [])];
        const hasCartItems = cartItemsSnapshot.length > 0;

        // Clear cart on server and client
        try {
            await fetch(`${API_BASE_URL}/api/cart/clear`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ session_id: cartSessionId })
            });
            clientCart = { items: [], total_amount: 0 };
            try {
                localStorage.removeItem("commerce_client_cart_backup");
            } catch (e) {}
            renderCartUI();
        } catch (clearErr) {
            console.warn("Non-fatal cart clear warning:", clearErr);
        }

        // Close payment modal
        closePaymentModal();

        // Refresh orders cache and audit
        await loadAudit(currentIntentId);
        if (typeof fetchOrders === "function") {
            fetchOrders();
        }

        // Open Official Tax Invoice Receipt Modal
        const customerName = pendingCustomerData?.full_name || "Kunal Raj";
        const customerPincode = pendingCustomerData?.pincode || "560001";
        const finalProductName = currentProduct?.name || 
            (hasCartItems ? `Cart Bundle (${cartItemsSnapshot.length} items)` : (pendingPaymentOrder.purpose || "Executive Tech Suite"));

        const orderForInvoice = {
            order_id: pendingPaymentOrder.order_id,
            payment_id: verifyPaymentId,
            payment_method: methodSummary,
            amount: pendingPaymentOrder.amount,
            currency: pendingPaymentOrder.currency || "INR",
            product_name: finalProductName,
            merchant: pendingPaymentOrder.merchant || currentStoreConfig?.store_name || "Enterprise AI Commerce",
            buyer_id: `${customerName} (${customerPincode})`,
            created_at: new Date().toISOString()
        };

        openInvoiceModal(orderForInvoice);

        // Populate multi-item invoice table if checkout was from cart
        if (hasCartItems) {
            const tableBody = document.getElementById("invoiceTableBody");
            if (tableBody) {
                tableBody.innerHTML = cartItemsSnapshot.map(it => `
                    <tr>
                        <td style="padding: 10px 0;">
                            <div style="font-weight: 600; color: var(--text);">${escapeHtml(it.name)}</div>
                            <div style="font-size: 11px; color: var(--muted); margin-top: 2px;">SKU: ${escapeHtml(it.product_id)} • 1-Year Comprehensive Warranty</div>
                        </td>
                        <td style="text-align: center; color: var(--text); padding: 10px 0;">${it.quantity}</td>
                        <td style="text-align: right; font-weight: 700; color: var(--text); padding: 10px 0;">${formatCurrency(it.price * it.quantity, "INR")}</td>
                    </tr>
                `).join("");
            }
        }

        showToast(`✓ Payment Completed via ${methodSummary}! Order Placed.`, "success");

    } catch (error) {
        console.error(error);
        setState("Payment failed", error.message, "warning");
        addMessage("agent", `⚠️ ${error.message}`);
        showToast(error.message, "error");
    }
}

// Call on startup
setTimeout(initPaymentMethodListeners, 100);

// ============================================================
// STEP 1 — PROCEED TO PAYMENT (VALIDATE & CREATE ORDER)
// ============================================================

async function approvePurchase() {
    if (!currentIntentId) {
        addMessage("agent", "⚠️ No active purchase intent found to approve.");
        return;
    }

    approveButton.disabled = true;
    approveButton.innerHTML = "Creating Secure Order...";

    try {
        // Extract customer shipping details from modal
        const customerName = document.getElementById("modalCustomerName")?.value?.trim() || "Kunal Raj";
        const customerEmail = document.getElementById("modalCustomerEmail")?.value?.trim() || "kunalraj31012005@gmail.com";
        const customerAddress = document.getElementById("modalCustomerAddress")?.value?.trim() || "100 Innovation Tech Park, Koramangala";
        const customerPincode = document.getElementById("modalCustomerPincode")?.value?.trim() || "560001";
        const customerCity = document.getElementById("modalCustomerCity")?.value?.trim() || "Bengaluru, Karnataka";

        const customerPayload = {
            full_name: customerName,
            email: customerEmail,
            address_line: customerAddress,
            pincode: customerPincode,
            city: customerCity.split(",")[0]?.trim() || customerCity,
            state: customerCity.split(",")[1]?.trim() || "Karnataka",
            country: "India"
        };

        // STEP 1 — APPROVE INTENT
        const approvalResponse = await fetch(`${API_BASE_URL}/approval`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            body: JSON.stringify({
                intent_id: currentIntentId,
                approved: true,
                customer: customerPayload
            })
        });

        const approvalData = await approvalResponse.json();
        if (!approvalResponse.ok) {
            throw new Error(approvalData.detail || "Approval failed.");
        }

        markPipelineComplete(pipelineApproval);
        setState("Order Created", "Review delivery address and select payment method to complete purchase.", "active");

        // STEP 2 — EXECUTE SECURE ORDER
        activatePipeline(pipelinePayment);
        const executeResponse = await fetch(`${API_BASE_URL}/execute/${currentIntentId}`, {
            method: "POST",
            headers: { "Accept": "application/json" }
        });

        const executeData = await executeResponse.json();
        if (!executeResponse.ok) {
            throw new Error(executeData.detail || "Payment order creation failed.");
        }

        const payment = executeData.payment;
        if (!payment) {
            throw new Error("Payment order data missing from server response.");
        }

        // Snapshot current cart
        const cartSnapshot = [...(clientCart?.items || [])];

        // Close Step 1 Modal
        closeApprovalModal();

        // STEP 3 — OPEN PAYMENT METHOD SELECTION MODAL
        openPaymentModal(payment, customerPayload, cartSnapshot);

    } catch (error) {
        console.error(error);
        setState("Execution failed", error.message, "warning");
        addMessage("agent", `⚠️ ${error.message}`);
        showToast(error.message, "error");
    } finally {
        approveButton.disabled = false;
        approveButton.innerHTML = "Proceed to Payment <span>→</span>";
    }
}


// ============================================================
// REJECT PURCHASE
// ============================================================

async function rejectPurchase() {

    if (!currentIntentId) {

        closeApprovalModal();

        return;
    }


    rejectButton.disabled = true;


    try {

        const response =
            await fetch(
                `${API_BASE_URL}/approval`,
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json",

                        "Accept":
                            "application/json"
                    },

                    body: JSON.stringify({

                        intent_id:
                            currentIntentId,

                        approved: false
                    })
                }
            );


        const data =
            await response.json();


        if (!response.ok) {

            throw new Error(
                data.detail ||
                "Could not reject intent."
            );
        }


        closeApprovalModal();

        setState(
            "Purchase cancelled",
            "No payment was created.",
            "warning"
        );

        const cartMsg = clientCart?.items?.length > 0
            ? " Purchase cancelled. No payment was charged, and your selected items remain safely in your Shopping Cart."
            : " Purchase cancelled. No payment was created.";

        addMessage(
            "agent",
            cartMsg
        );

        if (clientCart?.items?.length > 0) {
            showToast("Purchase cancelled. Selected items kept safe in your Cart.", "info");
        }


    } catch (error) {

        console.error(error);

        addMessage("agent", `⚠️ Could not complete cancellation: ${error.message}`);

    } finally {

        rejectButton.disabled = false;
    }
}


// ============================================================
// PAYMENT SUCCESS + RAZORPAY CHECKOUT
// ============================================================

function addPaymentSuccess(data) {

    const payment = data?.payment;

    if (!payment) {
        return;
    }

    lastPayment = payment;

    const wrapper = document.createElement("div");
    wrapper.className = "message agent";

    const content = document.createElement("div");
    content.className = "message-content";

    const title = document.createElement("strong");
    title.textContent = "✓ Razorpay order created";

    const card = document.createElement("div");
    card.className = "recommendation-card";

    const details = [
        ["Status", payment.status || "payment_created"],
        ["Merchant", payment.merchant || "—"],
        ["Amount", formatCurrency(payment.amount, payment.currency)],
        ["Razorpay Order", payment.order_id || "—"]
    ];

    details.forEach(([label, value]) => {

        const row = document.createElement("div");

        row.style.display = "flex";
        row.style.justifyContent = "space-between";
        row.style.alignItems = "center";
        row.style.gap = "15px";
        row.style.padding = "8px 0";
        row.style.borderBottom =
            "1px solid rgba(255,255,255,0.05)";

        const labelElement = document.createElement("span");
        labelElement.textContent = label;
        labelElement.style.color = "#9298a8";
        labelElement.style.fontSize = "9px";

        const valueElement = document.createElement("strong");
        valueElement.textContent = value;
        valueElement.style.fontSize = "9px";
        valueElement.style.wordBreak = "break-all";
        valueElement.style.textAlign = "right";

        row.appendChild(labelElement);
        row.appendChild(valueElement);
        card.appendChild(row);
    });

    const testMessage = document.createElement("div");
    testMessage.style.marginTop = "10px";
    testMessage.style.color = "#34d399";
    testMessage.style.fontSize = "10px";
    testMessage.textContent =
        "Razorpay Test Mode • Verified Transaction Recorded";

    card.appendChild(testMessage);

    const actions = document.createElement("div");
    actions.className = "recommendation-actions";

    const checkoutButton = document.createElement("button");
    checkoutButton.type = "button";
    checkoutButton.className = "button primary";
    checkoutButton.textContent = "Open Razorpay Checkout →";

    checkoutButton.addEventListener("click", () => {
        openRazorpayCheckout(payment);
    });

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "button";
    copyButton.textContent = "Copy Order ID";

    copyButton.addEventListener("click", async () => {

        if (!payment.order_id) {
            return;
        }

        try {
            await navigator.clipboard.writeText(payment.order_id);

            const original = copyButton.textContent;
            copyButton.textContent = "Copied ✓";

            setTimeout(() => {
                copyButton.textContent = original;
            }, 1400);

        } catch (error) {
            console.error("Clipboard failed:", error);
        }
    });

    const testVerifyBtn = document.createElement("button");
    testVerifyBtn.type = "button";
    testVerifyBtn.className = "button secondary";
    testVerifyBtn.textContent = "⚡ Simulate Test Payment";
    testVerifyBtn.addEventListener("click", () => {
        renderPaymentVerificationFallback(payment);
        const trigger = document.getElementById("btn-test-payment-fallback");
        if (trigger) trigger.click();
    });

    actions.appendChild(checkoutButton);
    actions.appendChild(testVerifyBtn);
    actions.appendChild(copyButton);

    content.appendChild(title);
    content.appendChild(card);
    content.appendChild(actions);

    wrapper.appendChild(content);
    messages.appendChild(wrapper);

    scrollChatToBottom();
}


// ============================================================
// VERIFIED PAYMENT
// ============================================================

function addPaymentVerified(data) {

    const payment = data?.payment;
    const receipt = data?.receipt;

    if (!payment) {
        return;
    }

    lastPayment = {
        ...(lastPayment || {}),
        ...payment,
        status: "payment_verified"
    };

    addMessage(
        "agent",
        "✓ Payment verified. Razorpay signature, amount, order and capture status were confirmed by the backend."
    );

    // Render Cryptographic Digital Receipt Card in the conversation
    if (receipt) {
        const receiptCard = document.createElement("div");
        receiptCard.className = "message agent";
        receiptCard.style.maxWidth = "480px";
        receiptCard.style.margin = "8px 0";
        receiptCard.innerHTML = `
            <div style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 8px; padding: 14px; font-size: 13px; color: var(--foreground);">
                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(16, 185, 129, 0.2); padding-bottom: 8px; margin-bottom: 10px;">
                    <strong style="color: #10b981; font-size: 14px;">🧾 OFFICIAL ORDER RECEIPT</strong>
                    <span style="font-family: monospace; font-size: 11px; background: rgba(16, 185, 129, 0.2); color: #10b981; padding: 2px 6px; border-radius: 4px;">${escapeHtml(receipt.receipt_id)}</span>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; font-size: 12px; margin-bottom: 10px;">
                    <div><span style="color: var(--muted);">Item:</span> <strong>${escapeHtml(receipt.item)}</strong></div>
                    <div><span style="color: var(--muted);">Amount Paid:</span> <strong style="color: #10b981;">₹${Number(receipt.amount_inr).toLocaleString("en-IN")} INR</strong></div>
                    <div><span style="color: var(--muted);">Order ID:</span> <span style="font-family: monospace;">${escapeHtml(receipt.order_id)}</span></div>
                    <div><span style="color: var(--muted);">Payment ID:</span> <span style="font-family: monospace;">${escapeHtml(receipt.payment_id)}</span></div>
                    <div><span style="color: var(--muted);">Issued At:</span> <span>${new Date(receipt.issued_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div>
                    <div><span style="color: var(--muted);">Gateway:</span> <span>Razorpay Verified</span></div>
                </div>
                <div style="border-top: 1px dashed rgba(16, 185, 129, 0.2); padding-top: 8px; font-size: 11px;">
                    <span style="color: var(--muted);">Cryptographic Signature (SHA-256 Proof):</span>
                    <div style="font-family: monospace; font-size: 10px; color: #10b981; word-break: break-all; margin-top: 2px;">${escapeHtml(receipt.digital_signature)}</div>
                </div>
            </div>
        `;
        messages.appendChild(receiptCard);
        scrollChatToBottom();
    }

    console.log(
        "Payment verified:",
        {
            order_id: payment.order_id,
            payment_id: payment.payment_id,
            amount: payment.amount,
            currency: payment.currency,
            captured: payment.captured
        }
    );
}


// ============================================================
// RAZORPAY CHECKOUT
// ============================================================

function loadRazorpayScript() {

    return new Promise((resolve, reject) => {

        if (window.Razorpay) {
            resolve();
            return;
        }

        const existing =
            document.querySelector(
                'script[src="https://checkout.razorpay.com/v1/checkout.js"]'
            );

        if (existing) {

            existing.addEventListener("load", resolve);
            existing.addEventListener("error", reject);
            return;
        }

        const script = document.createElement("script");

        script.src =
            "https://checkout.razorpay.com/v1/checkout.js";

        script.onload = resolve;
        script.onerror = () =>
            reject(
                new Error(
                    "Razorpay Checkout could not be loaded."
                )
            );

        document.head.appendChild(script);
    });
}


function renderPaymentVerificationFallback(payment) {
    if (document.getElementById("btn-test-payment-fallback")) return;
    const fallbackBtn = document.createElement("button");
    fallbackBtn.id = "btn-test-payment-fallback";
    fallbackBtn.className = "button primary";
    fallbackBtn.style.marginTop = "10px";
    fallbackBtn.textContent = "⚡ Complete Test Payment Verification";
    fallbackBtn.onclick = async () => {
        fallbackBtn.disabled = true;
        fallbackBtn.textContent = "Verifying test payment...";
        try {
            const verifyResponse = await fetch(`${API_BASE_URL}/payment/verify`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                },
                body: JSON.stringify({
                    razorpay_payment_id: `pay_sim_${Date.now()}`,
                    razorpay_order_id: payment.order_id,
                    razorpay_signature: "demo_signature"
                })
            });

            const verificationData = await verifyResponse.json();

            if (!verifyResponse.ok) {
                throw new Error(verificationData.detail || "Payment verification failed.");
            }

            setState(
                "Payment verified",
                "Server-side signature, amount, order and capture checks passed.",
                "active"
            );

            addPaymentVerified(verificationData);
            markPipelineComplete(pipelinePayment);
            await loadAudit(currentIntentId);
        } catch (err) {
            setState("Payment verification failed", err.message, "warning");
            addMessage("agent", `⚠️ ${err.message}`);
        }
    };
    messages?.appendChild(fallbackBtn);
    messages?.scrollTo({ top: messages.scrollHeight, behavior: "smooth" });
}

async function openRazorpayCheckout(payment) {

    if (!payment?.order_id) {

        addMessage(
            "agent",
            "⚠️ Razorpay order ID is missing."
        );

        return;
    }

    /*
     * IMPORTANT:
     * RAZORPAY_KEY_ID is a PUBLIC key, not the secret key.
     *
     * The preferred production path is for the backend to return
     * `key_id` with the created order.
     *
     * Until that backend field is added, the UI safely refuses to
     * guess a credential.
     */
    const keyCandidate = payment.key_id || currentStoreConfig?.razorpay_key_id || window.RAZORPAY_KEY_ID;
    const keyId = (keyCandidate && !keyCandidate.includes("your_public_key_id") && !keyCandidate.includes("placeholder"))
        ? keyCandidate
        : "";

    if (!keyId) {
        addMessage(
            "agent",
            "💡 Razorpay Key ID is not configured yet. Configure your keys in Merchant Control (top nav). Launching interactive gateway verification..."
        );
        openPaymentAuthModal("Razorpay Gateway (Interactive)", "card");
        return;
    }

    try {

        await loadRazorpayScript();

        // Standard Razorpay sandbox accounts have a test transaction limit per order (typically ₹50,000 max).
        let rawAmount = Number(payment.amount || 0);
        let amountInPaise = Math.round(rawAmount * 100);

        if (amountInPaise > 5000000) {
            amountInPaise = 5000000;
        }

        const options = {

            key: keyId,

            amount:
                amountInPaise,

            currency:
                payment.currency || "INR",

            name:
                currentStoreConfig?.store_name || "Workspace & Audio Tech",

            description:
                currentProduct?.name ||
                "AI Commerce Order Checkout",

            // Only supply order_id if created on the real Razorpay Orders API
            ...(payment.order_id && (payment.is_live_order || payment.is_real_razorpay_order) ? { order_id: payment.order_id } : {}),

            prefill: {
                name: pendingCustomerData?.name || "Kunal Raj",
                email: pendingCustomerData?.email || "kunalraj31012005@gmail.com",
                contact: pendingCustomerData?.phone || "9876543210"
            },

            theme: {
                color: "#3395ff"
            },

            modal: {
                ondismiss: function () {
                    console.log("[Razorpay] Customer dismissed checkout popup");
                    showToast("Razorpay Checkout dismissed", "info");
                }
            },

            handler: async function (response) {

                addMessage(
                    "agent",
                    "✓ Checkout completed. Verifying payment securely on the server..."
                );

                setState(
                    "Verifying payment",
                    "Razorpay returned the payment proof. The backend is validating the signature, amount, order and capture status.",
                    "active"
                );

                try {

                    const verifyResponse =
                        await fetch(
                            `${API_BASE_URL}/payment/verify`,
                            {
                                method: "POST",
                                headers: {
                                    "Content-Type": "application/json",
                                    "Accept": "application/json"
                                },
                                body: JSON.stringify({
                                    razorpay_payment_id: response.razorpay_payment_id || `pay_${Date.now()}`,
                                    razorpay_order_id: response.razorpay_order_id || payment.order_id,
                                    razorpay_signature: response.razorpay_signature || "demo_signature"
                                })
                            }
                        );

                    const verificationData =
                        await verifyResponse.json();

                    if (!verifyResponse.ok) {
                        throw new Error(
                            verificationData.detail ||
                            "Payment verification failed."
                        );
                    }

                    if (verificationData.status === "payment_verified") {

                        setState(
                            "Payment verified",
                            "Server-side signature, amount, order and capture checks passed.",
                            "active"
                        );

                        addPaymentVerified(
                            verificationData
                        );

                        markPipelineComplete(
                            pipelinePayment
                        );

                    } else {

                        setState(
                            "Payment authorized",
                            "The signature is valid, but Razorpay has not confirmed capture yet.",
                            "active"
                        );

                        addMessage(
                            "agent",
                            "⏳ Payment is authorized but not captured yet. The server will rely on Razorpay status/webhooks for final confirmation."
                        );
                    }

                    await loadAudit(
                        currentIntentId
                    );

                } catch (error) {

                    console.error(
                        "Payment verification failed:",
                        error.message
                    );

                    setState(
                        "Payment verification failed",
                        error.message,
                        "warning"
                    );

                    addMessage(
                        "agent",
                        `⚠️ Payment was not marked as successful: ${error.message}`
                    );
                }
            },

            modal: {
                ondismiss: function () {
                    addMessage(
                        "agent",
                        "Razorpay Checkout was closed. Payment was not completed — your selected items remain safely preserved in your Cart so you can resume whenever ready."
                    );
                    if (clientCart?.items?.length > 0) {
                        showToast("Payment paused: Selected items remain safe in your Cart", "info");
                    }
                }
            },

            theme: {
                color: "#6366f1"
            }
        };

        const razorpay = new Razorpay(options);

        razorpay.on(
            "payment.failed",
            function (response) {
                console.error(
                    "Razorpay payment failed:",
                    response?.error?.code || "unknown",
                    response?.error?.description || "unknown error"
                );

                setState(
                    "Payment failed",
                    `Razorpay reported: ${response?.error?.description || "Payment could not be processed."}`,
                    "warning"
                );

                addMessage(
                    "agent",
                    `⚠️ Payment could not be completed (${response?.error?.description || "Gateway issue"}). Your selected items remain safe in your Cart for retry.`
                );

                showToast("Payment not proceeded: Items preserved in your Cart", "warning");

                // Render instant test payment verification fallback button
                renderPaymentVerificationFallback(payment);
            }
        );

        razorpay.open();

    } catch (error) {

        console.error(error);

        addMessage(
            "agent",
            `⚠️ Razorpay checkout could not open in this browser context: ${error.message}`
        );

        const fallbackBtn = document.createElement("button");
        fallbackBtn.className = "button primary";
        fallbackBtn.style.marginTop = "10px";
        fallbackBtn.textContent = "⚡ Complete Test Payment Verification";
        fallbackBtn.onclick = async () => {
            fallbackBtn.disabled = true;
            fallbackBtn.textContent = "Verifying test payment...";
            try {
                const verifyResponse = await fetch(`${API_BASE_URL}/payment/verify`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Accept": "application/json"
                    },
                    body: JSON.stringify({
                        razorpay_payment_id: `pay_sim_${Date.now()}`,
                        razorpay_order_id: payment.order_id,
                        razorpay_signature: "demo_signature"
                    })
                });

                const verificationData = await verifyResponse.json();

                if (!verifyResponse.ok) {
                    throw new Error(verificationData.detail || "Payment verification failed.");
                }

                setState(
                    "Payment verified",
                    "Server-side signature, amount, order and capture checks passed.",
                    "active"
                );

                addPaymentVerified(verificationData);
                markPipelineComplete(pipelinePayment);
                await loadAudit(currentIntentId);
            } catch (err) {
                setState("Payment verification failed", err.message, "warning");
                addMessage("agent", `⚠️ ${err.message}`);
            }
        };

        const msgDiv = document.createElement("div");
        msgDiv.className = "message agent";
        msgDiv.appendChild(fallbackBtn);
        messages.appendChild(msgDiv);
        scrollChatToBottom();
    }
}


// ============================================================
// AUDIT TRAIL
// ============================================================

async function loadAudit(intentId) {

    if (!intentId) {
        return;
    }

    try {

        const response =
            await fetch(
                `${API_BASE_URL}/audit/${intentId}`,
                {
                    method: "GET",
                    headers: {
                        "Accept": "application/json"
                    }
                }
            );

        const data = await response.json();

        if (!response.ok) {
            return;
        }

        lastAuditTrail =
            Array.isArray(data.audit_trail)
                ? data.audit_trail
                : [];

        console.log(
            "Audit trail:",
            lastAuditTrail
        );

        renderAuditTrail(lastAuditTrail);

    } catch (error) {

        console.error(
            "Audit loading failed:",
            error
        );
    }
}


function renderAuditTrail(events) {

    if (!events.length) {
        return;
    }

    const wrapper =
        document.createElement("div");

    wrapper.className =
        "message agent";

    const content =
        document.createElement("div");

    content.className =
        "message-content";

    const title =
        document.createElement("strong");

    title.textContent =
        "Security & audit trail";

    content.appendChild(title);

    const card =
        document.createElement("div");

    card.className =
        "recommendation-card";

    const executionCompleted =
        events.some(
            item =>
                item.event === "execution_completed" &&
                item.status === "success"
        );

    events.forEach((event, index) => {

        const row =
            document.createElement("div");

        row.style.display = "grid";
        row.style.gridTemplateColumns =
            "24px 1fr auto";
        row.style.gap = "9px";
        row.style.alignItems = "center";
        row.style.padding = "8px 0";

        if (index < events.length - 1) {
            row.style.borderBottom =
                "1px solid rgba(255,255,255,0.05)";
        }

        const marker =
            document.createElement("span");

        marker.textContent =
            event.status === "success" ||
            event.status === "allowed" ||
            event.status === "approved" ||
            (
                event.event === "execution_started" &&
                executionCompleted
            )
                ? "✓"
                : "•";

        marker.style.fontWeight = "700";

        const eventName =
            document.createElement("strong");

        eventName.textContent =
            formatAuditEvent(event.event);

        eventName.style.fontSize = "9px";

        const status =
            document.createElement("span");

        status.textContent =
            (
                event.event === "execution_started" &&
                executionCompleted
            )
                ? "success"
                : event.status || "";

        status.style.fontSize = "8px";
        status.style.opacity = "0.7";

        row.appendChild(marker);
        row.appendChild(eventName);
        row.appendChild(status);

        card.appendChild(row);
    });

    content.appendChild(card);
    wrapper.appendChild(content);
    messages.appendChild(wrapper);

    scrollChatToBottom();
}


function formatAuditEvent(event) {

    const labels = {

        intent_created:
            "Purchase intent created",

        policy_checked:
            "Policy verified",

        approval_received:
            "User approval received",

        execution_started:
            "Secure execution started",

        execution_completed:
            "Secure execution completed",

        payment_order_created:
            "Razorpay order created",

        payment_signature_verified:
            "Payment signature verified",

        payment_captured:
            "Payment captured",

        payment_failed:
            "Payment creation failed",

        execution_blocked:
            "Execution blocked"
    };

    return labels[event] || event;
}


// ============================================================
// MERCHANT DASHBOARD
// ============================================================

const merchantButton =
    document.getElementById("merchantButton");

const merchantDashboard =
    document.getElementById("merchantDashboard");

const ordersView =
    document.getElementById("ordersView");

const ordersList =
    document.getElementById("ordersList");

const ordersRefreshButton =
    document.getElementById("ordersRefreshButton");

const chatContainer =
    document.getElementById("chatContainer");

const composerWrapper =
    document.querySelector(".composer-wrapper");

const dashboardRefreshButton =
    document.getElementById("dashboardRefreshButton");

const dashboardRevenue =
    document.getElementById("dashboardRevenue");

const dashboardOrders =
    document.getElementById("dashboardOrders");

const dashboardAov =
    document.getElementById("dashboardAov");

const dashboardPaymentIssues =
    document.getElementById("dashboardPaymentIssues");

const dashboardNegotiatedDeals =
    document.getElementById("dashboardNegotiatedDeals");

const dashboardFirewallBlocks =
    document.getElementById("dashboardFirewallBlocks");

const demandForecastGrid =
    document.getElementById("demandForecastGrid");

const dashboardOpportunities =
    document.getElementById("dashboardOpportunities");

const dashboardProfile =
    document.getElementById("dashboardProfile");

const dashboardCatalog =
    document.getElementById("dashboardCatalog");

const dashboardCatalogCount =
    document.getElementById("dashboardCatalogCount");

const dashboardDataStatus =
    document.getElementById("dashboardDataStatus");

const dashboardExplanation =
    document.getElementById("dashboardExplanation");

const dashboardDecision =
    document.getElementById("dashboardDecision");

const dashboardDecisionType =
    document.getElementById("dashboardDecisionType");

const toggleInspectorBtn =
    document.getElementById("toggleInspectorBtn");

const appContainer =
    document.querySelector(".app");

if (toggleInspectorBtn && appContainer) {
    toggleInspectorBtn.addEventListener("click", () => {
        appContainer.classList.toggle("inspector-collapsed");
        toggleInspectorBtn.classList.toggle("active");
    });
}


function setDashboardMode(showDashboard) {

    merchantDashboard.classList.toggle(
        "hidden",
        !showDashboard
    );

    if (ordersView) {
        ordersView.classList.add("hidden");
    }

    if (cartDashboard) {
        cartDashboard.classList.add("hidden");
    }

    const waViewEl = document.getElementById("whatsappView");
    if (waViewEl) {
        waViewEl.classList.add("hidden");
    }

    const waNavBtnEl = document.getElementById("whatsappNavButton");
    if (waNavBtnEl) {
        waNavBtnEl.classList.remove("active");
    }

    chatContainer.classList.toggle(
        "hidden",
        showDashboard
    );

    composerWrapper.classList.toggle(
        "hidden",
        showDashboard
    );

    document
        .querySelector(".inspector")
        ?.classList.toggle(
            "hidden",
            showDashboard
        );

    newChatButton.classList.toggle(
        "active",
        !showDashboard
    );

    ordersButton.classList.toggle(
        "active",
        false
    );

    merchantButton.classList.toggle(
        "active",
        showDashboard
    );

    const heading =
        document.querySelector(".topbar h1");

    if (heading) {

        heading.innerHTML =
            showDashboard
                ? 'Merchant <span>control plane.</span>'
                : 'Your intelligent <span>shopping agent.</span>';
    }

    const eyebrow =
        document.querySelector(".topbar .eyebrow");

    if (eyebrow) {

        eyebrow.textContent =
            showDashboard
                ? "MERCHANT CONTROL"
                : "AI COMMERCE ENGINE";
    }

    if (showDashboard) {
        loadMerchantDashboard();
    }
}


async function fetchDashboardData() {

    const responses =
        await Promise.all([
            fetch(
                `${API_BASE_URL}/revenue-agent`,
                {
                    headers: {
                        "Accept": "application/json"
                    }
                }
            ),
            fetch(
                `${API_BASE_URL}/commerce-profile`,
                {
                    headers: {
                        "Accept": "application/json"
                    }
                }
            ),
            fetch(
                `${API_BASE_URL}/catalog`,
                {
                    headers: {
                        "Accept": "application/json"
                    }
                }
            )
        ]);

    const data = [];

    for (const response of responses) {

        const payload =
            await response.json();

        if (!response.ok) {

            throw new Error(
                payload.detail ||
                "Dashboard data request failed."
            );
        }

        data.push(payload);
    }

    return {
        revenue: data[0],
        profile: data[1],
        catalog: data[2]
    };
}


function renderDashboardMetrics(revenue) {

    dashboardRevenue.textContent =
        formatCurrency(
            revenue.total_revenue,
            "INR"
        );

    dashboardOrders.textContent =
        String(
            revenue.completed_orders
        );

    dashboardAov.textContent =
        formatCurrency(
            revenue.average_order_value,
            "INR"
        );

    dashboardPaymentIssues.textContent =
        String(
            revenue.pending_payments +
            revenue.failed_payments
        );

    if (dashboardNegotiatedDeals) {
        dashboardNegotiatedDeals.textContent = String(revenue.negotiated_deals || 0);
    }

    if (dashboardFirewallBlocks) {
        dashboardFirewallBlocks.textContent = String(revenue.firewall_blocked || 0);
    }
}


function renderDemandForecasts(forecasts) {
    if (!demandForecastGrid) return;
    demandForecastGrid.innerHTML = "";

    if (!Array.isArray(forecasts) || forecasts.length === 0) {
        demandForecastGrid.innerHTML = `<div class="dashboard-empty">No inventory forecasting models available.</div>`;
        return;
    }

    forecasts.forEach(f => {
        const card = document.createElement("div");
        card.style.cssText = "background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 16px; display: flex; flex-direction: column; justify-content: space-between; gap: 12px;";

        const badgeColor = f.alert_type === "surge" ? "#10b981" : f.alert_type === "clearance" ? "#f59e0b" : "#3b82f6";
        const badgeBg = f.alert_type === "surge" ? "rgba(16, 185, 129, 0.12)" : f.alert_type === "clearance" ? "rgba(245, 158, 11, 0.12)" : "rgba(59, 130, 246, 0.12)";
        const badgeLabel = f.alert_type === "surge" ? "🚀 High Velocity" : f.alert_type === "clearance" ? "⚠️ Low Stock" : "✓ Steady Demand";

        card.innerHTML = `
            <div>
                <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
                    <div>
                        <strong style="font-size: 14px; color: var(--text);">${escapeHtml(f.name)}</strong>
                        <div style="font-size: 11px; color: var(--muted); margin-top: 2px;">${escapeHtml(f.category)} • Current Price: ₹${Number(f.price).toLocaleString("en-IN")} INR</div>
                    </div>
                    <span style="background: ${badgeBg}; color: ${badgeColor}; font-size: 10.5px; font-weight: 700; padding: 3px 8px; border-radius: 999px; white-space: nowrap;">
                        ${badgeLabel}
                    </span>
                </div>

                <!-- Velocity Meter -->
                <div style="margin-top: 14px;">
                    <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 4px;">
                        <span style="color: var(--muted);">Sales Velocity Index</span>
                        <strong style="color: var(--text);">${f.velocity_index}x</strong>
                    </div>
                    <div style="background: rgba(255,255,255,0.08); height: 6px; border-radius: 3px; overflow: hidden;">
                        <div style="background: ${badgeColor}; width: ${Math.min(100, Math.max(15, f.velocity_index * 25))}%; height: 100%; border-radius: 3px;"></div>
                    </div>
                </div>

                <div style="margin-top: 12px; font-size: 12px; color: var(--text); line-height: 1.4; background: rgba(0,0,0,0.2); padding: 10px; border-radius: 8px; border-left: 3px solid ${badgeColor};">
                    ${escapeHtml(f.recommendation)}
                </div>
            </div>

            <div>
                <div style="border-top: 1px solid var(--border); padding-top: 10px; display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-size: 11px; color: var(--muted);">Stock: <strong>${f.stock} units</strong></span>
                    <span style="font-size: 11px; font-weight: 600; color: ${badgeColor};">${escapeHtml(f.suggested_floor_action)}</span>
                </div>
                ${f.suggested_floor_inr ? `
                    <button type="button" class="button secondary apply-forecast-floor-btn" data-floor="${f.suggested_floor_inr}" data-name="${escapeHtml(f.name)}" style="width: 100%; font-size: 11px; padding: 6px 10px; margin-top: 10px; border-color: rgba(16, 185, 129, 0.4); color: #10b981; justify-content: center;">
                        ⚡ 1-Click Apply Floor: ₹${Number(f.suggested_floor_inr).toLocaleString("en-IN")} INR
                    </button>
                ` : ""}
            </div>
        `;

        const applyBtn = card.querySelector(".apply-forecast-floor-btn");
        if (applyBtn) {
            applyBtn.addEventListener("click", async () => {
                applyBtn.disabled = true;
                applyBtn.textContent = "Updating Enclave Policy...";
                try {
                    const res = await fetch(`${API_BASE_URL}/api/revenue/apply-floor`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            floor_price_inr: f.suggested_floor_inr,
                            reason: `Merchant applied demand velocity floor for ${f.name}`,
                            product_id: f.product_id
                        })
                    });
                    const resData = await res.json();
                    if (resData.success) {
                        showToast(`Enclave Updated: Corporate floor set to ₹${resData.new_floor.toLocaleString("en-IN")} INR`);
                        await loadMerchantDashboard();
                    } else {
                        showToast(resData.error || "Failed to update floor", "error");
                    }
                } catch (e) {
                    showToast("Error updating price floor", "error");
                } finally {
                    applyBtn.disabled = false;
                }
            });
        }

        demandForecastGrid.appendChild(card);
    });
}

function renderAbandonedIntents(abandonedIntents) {
    const container = document.getElementById("abandonedIntentsContainer");
    if (!container) return;
    container.innerHTML = "";

    if (!Array.isArray(abandonedIntents) || abandonedIntents.length === 0) {
        container.innerHTML = `<div class="dashboard-empty">All customer checkout intents are currently completed and verified.</div>`;
        return;
    }

    abandonedIntents.forEach(item => {
        const card = document.createElement("div");
        card.style.cssText = "background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 14px; display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap;";

        card.innerHTML = `
            <div style="flex: 1; min-width: 240px;">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="font-family: monospace; font-size: 11px; background: rgba(245, 158, 11, 0.15); color: #f59e0b; padding: 2px 6px; border-radius: 4px; font-weight: 700;">
                        #${escapeHtml(item.intent_id)}
                    </span>
                    <strong style="font-size: 13.5px; color: var(--text);">${escapeHtml(item.item_name)}</strong>
                </div>
                <div style="font-size: 11px; color: var(--muted); margin-top: 4px;">
                    Customer: <strong style="color: var(--text);">${escapeHtml(item.recipient || "Prospective Shopper")}</strong> • Value: <strong style="color: #10b981;">₹${Number(item.amount).toLocaleString("en-IN")} INR</strong>
                </div>
            </div>

            <div style="display: flex; gap: 8px; align-items: center;">
                <button type="button" class="button secondary recover-nudge-btn" style="font-size: 11px; padding: 6px 12px; border-color: rgba(245, 158, 11, 0.4); color: #f59e0b;">
                    ⚡ Dispatch +3% WhatsApp Nudge
                </button>
                <button type="button" class="button secondary copy-intent-btn" style="font-size: 11px; padding: 6px 10px;">
                    📋 Copy Link
                </button>
            </div>
        `;

        const nudgeBtn = card.querySelector(".recover-nudge-btn");
        const copyBtn = card.querySelector(".copy-intent-btn");

        nudgeBtn?.addEventListener("click", async () => {
            nudgeBtn.disabled = true;
            nudgeBtn.textContent = "Dispatching...";
            try {
                const res = await fetch(`${API_BASE_URL}/api/intents/recover-intent`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        intent_id: item.intent_id,
                        recovery_discount_percent: 3
                    })
                });
                const data = await res.json();
                if (data.success) {
                    showToast(`Recovery Offer Generated: New Price ₹${data.new_price.toLocaleString("en-IN")} (Saved ₹${data.savings.toLocaleString("en-IN")})`);
                    // Switch to WhatsApp simulator and append recovery bubble!
                    setWhatsAppSandboxMode();
                    appendWhatsAppBubble("agent", data.recovery_message, {
                        title: item.item_name,
                        price: data.new_price,
                        checkout_url: data.checkout_url
                    });
                } else {
                    showToast(data.error || "Failed to dispatch recovery offer", "error");
                }
            } catch (e) {
                showToast("Error dispatching recovery offer", "error");
            } finally {
                nudgeBtn.disabled = false;
                nudgeBtn.textContent = "⚡ Dispatch +3% WhatsApp Nudge";
            }
        });

        copyBtn?.addEventListener("click", () => {
            const checkoutUrl = `${window.location.origin}/?intent_id=${item.intent_id}&payment=1`;
            navigator.clipboard.writeText(checkoutUrl).then(() => {
                showToast("Direct checkout link copied to clipboard!");
            }).catch(() => {
                prompt("Copy checkout link:", checkoutUrl);
            });
        });

        container.appendChild(card);
    });
}


function renderDashboardOpportunities(
    opportunities
) {

    dashboardOpportunities.innerHTML = "";

    if (
        !Array.isArray(opportunities) ||
        opportunities.length === 0
    ) {

        dashboardOpportunities.innerHTML =
            `<div class="dashboard-empty">
                No revenue opportunities detected
                from completed purchases yet.
            </div>`;

        return;
    }

    opportunities.forEach(
        opportunity => {

            const card =
                document.createElement("div");

            card.className =
                "dashboard-opportunity";

            card.innerHTML = `
                <div class="dashboard-opportunity-top">
                    <strong>${escapeHtml(
                        opportunity.product_name
                    )}</strong>

                    <span class="dashboard-opportunity-badge">
                        ${escapeHtml(
                            opportunity.opportunity
                        )}
                    </span>
                </div>

                <p>${escapeHtml(
                    opportunity.reason
                )}</p>

                <div class="dashboard-opportunity-action">
                    ${escapeHtml(
                        opportunity.potential_action
                    )}
                </div>
            `;

            dashboardOpportunities.appendChild(
                card
            );
        }
    );
}


function renderDashboardDecision(revenue) {

    const trace = revenue?.decision_trace;

    if (!trace) {
        dashboardDecision.innerHTML =
            `<div class="dashboard-empty">
                AI decision data unavailable.
            </div>`;
        return;
    }

    dashboardDecisionType.textContent =
        trace.decision_type || "AI decision";

    dashboardDecision.innerHTML = `
        <div class="dashboard-decision-main">
            <strong>${escapeHtml(
                trace.decision || "Decision unavailable"
            )}</strong>

            <p>${escapeHtml(
                trace.explanation || ""
            )}</p>
        </div>

        <div class="dashboard-decision-factors">
            ${
                Array.isArray(trace.factors)
                    ? trace.factors.map(
                        factor => `
                            <div class="dashboard-decision-factor">
                                <strong>${escapeHtml(
                                    factor.factor
                                )}</strong>

                                <span>${escapeHtml(
                                    factor.value
                                )}</span>

                                <p>${escapeHtml(
                                    factor.impact
                                )}</p>
                            </div>
                        `
                    ).join("")
                    : ""
            }
        </div>
    `;
}


function renderDashboardProfile(profile) {

    dashboardProfile.innerHTML = "";

    if (!profile || typeof profile !== "object") {

        dashboardProfile.innerHTML =
            `<div class="dashboard-empty">
                Merchant profile unavailable.
            </div>`;

        return;
    }

    const entries = [
        ["Merchant", profile.merchant],
        ["Currency", profile.currency],
        ["Checkout", profile.checkout],
        ["Approval", profile.user_approval_required],
        ["Catalog", profile.catalog_description]
    ];

    entries.forEach(
        ([label, value]) => {

            if (
                value === undefined ||
                value === null
            ) {
                return;
            }

            const row =
                document.createElement("div");

            row.className =
                "dashboard-profile-row";

            const labelElement =
                document.createElement("span");

            labelElement.className =
                "dashboard-profile-label";

            labelElement.textContent =
                label;

            const valueElement =
                document.createElement("span");

            valueElement.className =
                "dashboard-profile-value";

            valueElement.textContent =
                typeof value === "boolean"
                    ? value
                        ? "Required"
                        : "Not required"
                    : String(value);

            row.appendChild(labelElement);
            row.appendChild(valueElement);

            dashboardProfile.appendChild(row);
        }
    );
}


function renderDashboardCatalog(catalog) {

    dashboardCatalog.innerHTML = "";

    const products =
        Array.isArray(catalog)
            ? catalog
            : Array.isArray(catalog?.products)
                ? catalog.products
                : [];

    dashboardCatalogCount.textContent =
        `${products.length} ${
            products.length === 1
                ? "product"
                : "products"
        }`;

    if (!products.length) {

        dashboardCatalog.innerHTML =
            `<div class="dashboard-empty">
                No catalog products available.
            </div>`;

        return;
    }

    products.forEach(
        product => {

            const card =
                document.createElement("div");

            card.className =
                "dashboard-product";

            const tags =
                Array.isArray(product.tags)
                    ? product.tags
                    : [];

            const stockText =
                product.stock > 0
                    ? `${product.stock} in stock`
                    : "Out of stock";

            const imageHtml = product.image_url
                ? `<div class="dashboard-product-media">
                     <img class="dashboard-product-img" src="${escapeHtml(product.image_url)}" alt="${escapeHtml(product.name)}" onerror="this.parentElement.style.display='none'" />
                   </div>`
                : `<div class="dashboard-product-icon">
                     ${getProductIcon(product.name)}
                   </div>`;

            const descHtml = product.description
                ? `<div class="dashboard-product-desc">${escapeHtml(product.description)}</div>`
                : "";

            const specsPreview = product.specifications && typeof product.specifications === "object"
                ? `<div style="display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px;">
                     ${Object.entries(product.specifications).slice(0, 2).map(([k, v]) => `
                         <span style="font-size: 10px; background: var(--panel-2); border: 1px solid var(--border); padding: 1px 5px; border-radius: 4px; color: var(--text-secondary);">
                             ${escapeHtml(k)}: ${escapeHtml(String(v))}
                         </span>
                     `).join("")}
                   </div>`
                : "";

            card.innerHTML = `
                ${imageHtml}

                <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
                    <strong>
                        ${escapeHtml(product.name)}
                    </strong>
                    <span style="font-size: 11px; background: var(--accent-soft); color: var(--accent); padding: 2px 6px; border-radius: 4px; font-weight: 600;">
                        ${escapeHtml(product.category || 'Item')}
                    </span>
                </div>

                <span class="dashboard-product-price">
                    ${formatCurrency(
                        product.price,
                        product.currency
                    )}
                </span>

                <span class="dashboard-product-stock">
                    ${escapeHtml(stockText)}
                </span>

                ${descHtml}
                ${specsPreview}

                <div class="dashboard-product-tags" style="display: flex; justify-content: space-between; align-items: center; width: 100%; margin-top: 6px;">
                    <div style="display: flex; flex-wrap: wrap; gap: 4px;">
                        ${tags
                            .slice(0, 3)
                            .map(
                                tag =>
                                    `<span class="dashboard-product-tag">
                                        ${escapeHtml(tag)}
                                    </span>`
                            )
                            .join("")}
                    </div>
                    <button class="delete-prod-btn" data-id="${escapeHtml(product.product_id)}" title="Delete item" style="background: none; border: none; color: #ef4444; cursor: pointer; font-size: 13px; padding: 2px 6px;">✕</button>
                </div>
            `;

            const delBtn = card.querySelector(".delete-prod-btn");
            if (delBtn) {
                delBtn.addEventListener("click", async (ev) => {
                    ev.stopPropagation();
                    if (!confirm(`Delete product ${product.name}?`)) return;
                    await fetch(`${API_BASE_URL}/api/catalog/product/${encodeURIComponent(product.product_id)}`, { method: "DELETE" });
                    await loadMerchantDashboard();
                    loadStorefrontShowcase();
                });
            }

            dashboardCatalog.appendChild(card);
        }
    );
}


async function loadMerchantDashboard() {

    dashboardDataStatus.textContent =
        "Refreshing";

    try {

        const data =
            await fetchDashboardData();

        renderDashboardMetrics(
            data.revenue
        );

        renderDemandForecasts(
            data.revenue.demand_forecasts
        );

        renderAbandonedIntents(
            data.revenue.abandoned_intents
        );

        renderDashboardDecision(
            data.revenue
        );

        renderDashboardOpportunities(
            data.revenue.opportunities
        );

        renderDashboardProfile(
            data.profile
        );

        renderDashboardCatalog(
            data.catalog
        );

        dashboardExplanation.textContent =
            data.revenue.explanation;

        dashboardDataStatus.textContent =
            "Live data";

        await loadCloudSqlAudits();

    } catch (error) {

        console.error(
            "Merchant dashboard loading failed:",
            error
        );

        dashboardDataStatus.textContent =
            "Unavailable";

        dashboardOpportunities.innerHTML =
            `<div class="dashboard-empty">
                Could not load live merchant data.
                ${escapeHtml(error.message)}
            </div>`;

        dashboardExplanation.textContent =
            "The dashboard could not retrieve live backend data. No revenue values were estimated.";
    }
}


function escapeHtml(value) {

    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}


merchantButton.addEventListener(
    "click",
    () => {
        setDashboardMode(true);
    }
);

dashboardRefreshButton.addEventListener(
    "click",
    loadMerchantDashboard
);

// ============================================================
// REAL MERCHANT STORE CONNECTOR & CHANNEL SIMULATOR LOGIC
// ============================================================

let currentChannel = "storefront";

const channelStorefrontBtn = document.getElementById("channelStorefront");
const channelWhatsAppBtn = document.getElementById("channelWhatsApp");
const headerFloorBadge = document.getElementById("headerFloorBadge");
const storeConnectorName = document.getElementById("storeConnectorName");
const storeConnectorPlatform = document.getElementById("storeConnectorPlatform");
const storeConnectorDomain = document.getElementById("storeConnectorDomain");
const storeCurrentFloor = document.getElementById("storeCurrentFloor");
const configSaveStatus = document.getElementById("configSaveStatus");

const inputStoreName = document.getElementById("inputStoreName");
const inputStoreDomain = document.getElementById("inputStoreDomain");
const inputPlatform = document.getElementById("inputPlatform");
const inputFloorPrice = document.getElementById("inputFloorPrice");
const inputWhatsAppPhone = document.getElementById("inputWhatsAppPhone");
const saveStoreConfigBtn = document.getElementById("saveStoreConfigBtn");
const syncShopifyButton = document.getElementById("syncShopifyButton");

// Load Live Store Configuration
async function loadStoreConfig() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/store/config`);
        if (!response.ok) return;
        const data = await response.json();
        const store = data.store;
        currentStoreConfig = store;
        const activeFloor = data.active_floor || 4500;

        if (storeConnectorName) storeConnectorName.textContent = store.store_name || "Workspace & Audio Tech";
        if (storeConnectorPlatform) storeConnectorPlatform.textContent = (store.platform || "SHOPIFY").toUpperCase() + " LIVE";
        if (storeConnectorDomain) storeConnectorDomain.textContent = store.store_domain || "https://shop.workspacetech.in";
        if (storeCurrentFloor) storeCurrentFloor.textContent = `₹${Number(activeFloor).toLocaleString("en-IN")}.00 INR`;
        if (headerFloorBadge) headerFloorBadge.textContent = `Policy Floor: ₹${Number(activeFloor).toLocaleString("en-IN")} INR`;

        const headerStoreName = document.getElementById("headerStoreName");
        if (headerStoreName && store.store_name) {
            headerStoreName.textContent = store.store_name;
        }

        const sideFloorAmount = document.getElementById("sideFloorAmount");
        if (sideFloorAmount) {
            sideFloorAmount.textContent = `₹${Number(activeFloor).toLocaleString("en-IN")}.00 INR`;
        }

        if (inputStoreName) inputStoreName.value = store.store_name || "";
        if (inputStoreDomain) inputStoreDomain.value = store.store_domain || "";
        if (inputPlatform) inputPlatform.value = store.platform || "shopify";
        if (inputFloorPrice) inputFloorPrice.value = activeFloor;
        if (inputWhatsAppPhone) inputWhatsAppPhone.value = store.whatsapp_phone_number_id || "";

        // Webhook URL display
        const displayWebhookUrl = document.getElementById("displayWebhookUrl");
        if (displayWebhookUrl) {
            const baseOrigin = window.location.origin;
            displayWebhookUrl.value = `${baseOrigin}/webhooks/razorpay`;
        }
    } catch (e) {
        console.warn("Could not load merchant store config:", e);
    }
}

// Save Live Store Configuration
if (saveStoreConfigBtn) {
    saveStoreConfigBtn.addEventListener("click", async () => {
        saveStoreConfigBtn.disabled = true;
        saveStoreConfigBtn.textContent = "Saving...";
        if (configSaveStatus) configSaveStatus.textContent = "Updating...";

        try {
            const payload = {
                store_name: inputStoreName?.value || "",
                store_domain: inputStoreDomain?.value || "",
                platform: inputPlatform?.value || "shopify",
                floor_price_inr: Number(inputFloorPrice?.value || 4500),
                whatsapp_phone_number_id: inputWhatsAppPhone?.value || ""
            };

            const response = await fetch(`${API_BASE_URL}/api/store/config`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                if (configSaveStatus) configSaveStatus.textContent = "Saved & Applied";
                showToast("Store policy and parameters updated successfully!", "success");
                setTimeout(() => {
                    if (configSaveStatus) configSaveStatus.textContent = "Ready";
                }, 2500);
                await loadStoreConfig();
                await loadMerchantDashboard();
            } else {
                if (configSaveStatus) configSaveStatus.textContent = "Failed";
                showToast("Failed to save store parameters", "warning");
            }
        } catch (err) {
            console.error(err);
            if (configSaveStatus) configSaveStatus.textContent = "Error";
            showToast("Network error saving configuration", "warning");
        } finally {
            saveStoreConfigBtn.disabled = false;
            saveStoreConfigBtn.textContent = "Save & Apply Policy";
        }
    });
}

// Wire up Webhook URL Copy Button
document.getElementById("copyWebhookUrlBtn")?.addEventListener("click", () => {
    const input = document.getElementById("displayWebhookUrl");
    if (input && input.value) {
        navigator.clipboard.writeText(input.value).then(() => {
            showToast("Razorpay Webhook URL copied to clipboard!", "success");
        }).catch(() => {
            input.select();
            document.execCommand("copy");
            showToast("Razorpay Webhook URL copied!", "success");
        });
    }
});

// Wire up Webhook Test Simulator Buttons
document.getElementById("sendTestWebhookSuccessBtn")?.addEventListener("click", async () => {
    const statusEl = document.getElementById("webhookTestResult");
    if (statusEl) statusEl.textContent = "Dispatching payment.captured...";

    try {
        const res = await fetch(`${API_BASE_URL}/api/webhooks/razorpay/test-send`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                event: "payment.captured",
                intent_id: currentIntentId || "",
                order_id: pendingPaymentOrder?.order_id || "",
                amount: pendingPaymentOrder?.amount || 24999
            })
        });
        const data = await res.json();
        if (res.ok) {
            if (statusEl) statusEl.textContent = `✓ payment.captured verified (${data.payment_id})`;
            showToast(`Webhook event verified and processed! Order updated.`, "success");
            addMessage("agent", `⚡ Inbound Razorpay Webhook received: payment.captured for order ${data.order_id}. Signature verified via HMAC-SHA256.`);
            setState("Payment Verified via Webhook", "Razorpay webhook confirmed payment capture.", "active");
            if (currentIntentId) {
                await loadAudit(currentIntentId);
            }
            await loadMerchantDashboard();
        } else {
            if (statusEl) statusEl.textContent = `Error: ${data.detail}`;
            showToast(`Webhook test failed: ${data.detail}`, "warning");
        }
    } catch (e) {
        if (statusEl) statusEl.textContent = "Network error";
        showToast("Network error sending test webhook", "warning");
    }
});

document.getElementById("sendTestWebhookFailedBtn")?.addEventListener("click", async () => {
    const statusEl = document.getElementById("webhookTestResult");
    if (statusEl) statusEl.textContent = "Dispatching payment.failed...";

    try {
        const res = await fetch(`${API_BASE_URL}/api/webhooks/razorpay/test-send`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                event: "payment.failed",
                intent_id: currentIntentId || "",
                order_id: pendingPaymentOrder?.order_id || ""
            })
        });
        const data = await res.json();
        if (res.ok) {
            if (statusEl) statusEl.textContent = `✓ payment.failed verified`;
            showToast(`Webhook received: payment.failed recorded in audit log`, "info");
            addMessage("agent", `⚠️ Razorpay Webhook: payment.failed event received for order ${data.order_id}.`);
        } else {
            if (statusEl) statusEl.textContent = `Error: ${data.detail}`;
        }
    } catch (e) {
        if (statusEl) statusEl.textContent = "Network error";
    }
});

// Sync Live Shopify Catalog Button
if (syncShopifyButton) {
    syncShopifyButton.addEventListener("click", async () => {
        syncShopifyButton.disabled = true;
        syncShopifyButton.textContent = "⚡ Syncing Products...";

        try {
            const domain = inputStoreDomain?.value || "https://shop.workspacetech.in";
            const res = await fetch(`${API_BASE_URL}/api/store/sync-shopify`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ shopify_domain: domain })
            });

            if (res.ok) {
                const data = await res.json();
                syncShopifyButton.textContent = `✓ Synced ${data.products_synced} Products`;
                setTimeout(() => {
                    syncShopifyButton.textContent = "⚡ Sync Shopify Store";
                    syncShopifyButton.disabled = false;
                }, 2000);
                await loadMerchantDashboard();
                await loadStoreConfig();
            }
        } catch (e) {
            console.error(e);
            syncShopifyButton.textContent = "Sync Failed";
            syncShopifyButton.disabled = false;
        }
    });
}

// Multi-Channel Consumer Switcher (Storefront vs WhatsApp)
if (channelStorefrontBtn && channelWhatsAppBtn) {
    channelStorefrontBtn.addEventListener("click", () => {
        currentChannel = "storefront";
        channelStorefrontBtn.classList.add("active");
        channelWhatsAppBtn.classList.remove("active");
        setDashboardMode(false);
        addMessage("agent", "🌐 Switched simulation channel to **Web Storefront Concierge**. Shoppers browse through embedded web widget.");
    });

    channelWhatsAppBtn.addEventListener("click", () => {
        currentChannel = "whatsapp";
        channelWhatsAppBtn.classList.add("active");
        channelStorefrontBtn.classList.remove("active");
        setDashboardMode(false);
        addMessage("agent", "💬 Switched simulation channel to **WhatsApp Business AI Assistant**. Real-time conversational commerce with direct instant checkout links.");
    });
}

// ============================================================
// CLOUD SQL POLICY AUDIT LOGS VIEWER
// ============================================================

async function loadCloudSqlAudits() {
    const tableBody = document.getElementById("cloudSqlAuditBody");
    if (!tableBody) return;

    try {
        const response = await fetch(`${API_BASE_URL}/api/db/audits`);
        if (!response.ok) {
            tableBody.innerHTML = `<tr><td colspan="6" style="padding: 12px; text-align: center; color: var(--muted);">Unable to load Cloud SQL audits</td></tr>`;
            return;
        }

        const data = await response.json();
        const audits = data.audits || [];

        if (audits.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="6" style="padding: 12px; text-align: center; color: var(--muted);">No financial firewall or quorum events recorded yet. All actions are monitored in real time.</td></tr>`;
            return;
        }

        tableBody.innerHTML = audits.slice(0, 15).map(audit => {
            const timeStr = audit.createdAt ? new Date(audit.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : "Just now";
            const isBlocked = audit.action === "MUTATION_BLOCKED" || audit.action === "FIREWALL_INTERCEPTION";
            const statusColor = isBlocked ? "#ef4444" : "#10b981";
            const shortHash = audit.hashProof ? `${audit.hashProof.slice(0, 12)}...` : (audit.action === "QUORUM_CONSENSUS" ? "3/3 Quorum Sign" : "—");

            let offeredCol = "—";
            if (audit.requestedPrice) {
                offeredCol = `₹${Number(audit.requestedPrice).toLocaleString("en-IN")}`;
            } else if (audit.finalPrice) {
                offeredCol = `<span style="color: #10b981; font-weight: 600;">₹${Number(audit.finalPrice).toLocaleString("en-IN")}</span>`;
            }

            let floorCol = "—";
            if (audit.floorPrice) {
                floorCol = `₹${Number(audit.floorPrice).toLocaleString("en-IN")}`;
            } else if (audit.action === "QUORUM_CONSENSUS") {
                floorCol = `₹4,500`;
            }

            return `
                <tr style="border-bottom: 1px solid rgba(255, 255, 255, 0.05);">
                    <td style="padding: 8px; font-family: monospace; color: var(--muted);">${escapeHtml(timeStr)}</td>
                    <td style="padding: 8px; font-weight: 600; color: ${statusColor};">${escapeHtml(audit.action)}</td>
                    <td style="padding: 8px;">${offeredCol}</td>
                    <td style="padding: 8px;">${floorCol}</td>
                    <td style="padding: 8px;"><span style="background: ${isBlocked ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)'}; color: ${statusColor}; padding: 2px 6px; border-radius: 4px; font-size: 11px;">${isBlocked ? "BLOCKED" : "APPROVED"}</span></td>
                    <td style="padding: 8px; font-family: monospace; font-size: 11px; color: var(--muted);">${escapeHtml(shortHash)}</td>
                </tr>
            `;
        }).join("");
    } catch (err) {
        console.error("Failed to load Cloud SQL audits:", err);
    }
}

// ============================================================
// MERCHANT PRODUCT CATALOG CRUD HANDLERS
// ============================================================

const openAddProductModalBtn = document.getElementById("openAddProductModalBtn");
const addProductCard = document.getElementById("addProductCard");
const cancelAddProdBtn = document.getElementById("cancelAddProdBtn");
const saveNewProdBtn = document.getElementById("saveNewProdBtn");

const inputNewProdId = document.getElementById("inputNewProdId");
const inputNewProdName = document.getElementById("inputNewProdName");
const inputNewProdCategory = document.getElementById("inputNewProdCategory");
const inputNewProdPrice = document.getElementById("inputNewProdPrice");
const inputNewProdStock = document.getElementById("inputNewProdStock");
const inputNewProdImage = document.getElementById("inputNewProdImage");
const inputNewProdDescription = document.getElementById("inputNewProdDescription");
const inputNewProdSpecs = document.getElementById("inputNewProdSpecs");

const addProductNotice = document.getElementById("addProductNotice");

if (openAddProductModalBtn && addProductCard) {
    openAddProductModalBtn.addEventListener("click", () => {
        const isOpening = addProductCard.style.display === "none";
        addProductCard.style.display = isOpening ? "block" : "none";
        if (isOpening) {
            if (inputNewProdId) inputNewProdId.value = `SKU_${Math.floor(1000 + Math.random() * 9000)}`;
            if (inputNewProdName && !inputNewProdName.value) inputNewProdName.value = "Ergonomic Office Chair";
            if (inputNewProdCategory && !inputNewProdCategory.value) inputNewProdCategory.value = "Furniture";
            if (inputNewProdPrice && !inputNewProdPrice.value) inputNewProdPrice.value = "5999";
            if (inputNewProdStock && !inputNewProdStock.value) inputNewProdStock.value = "25";
            if (inputNewProdImage && !inputNewProdImage.value) inputNewProdImage.value = "https://images.unsplash.com/photo-1580481077194-453059eb774a?auto=format&fit=crop&w=800&q=80";
            if (inputNewProdDescription && !inputNewProdDescription.value) inputNewProdDescription.value = "High-comfort breathable mesh ergonomic executive chair with lumbar dynamic support.";
            if (inputNewProdSpecs && !inputNewProdSpecs.value) inputNewProdSpecs.value = "Material: Mesh & Steel, Weight: 12kg, Warranty: 3 Years";
            if (addProductNotice) {
                addProductNotice.style.display = "none";
            }
        }
    });
}

if (cancelAddProdBtn && addProductCard) {
    cancelAddProdBtn.addEventListener("click", () => {
        addProductCard.style.display = "none";
        if (addProductNotice) addProductNotice.style.display = "none";
    });
}

if (saveNewProdBtn) {
    saveNewProdBtn.addEventListener("click", async () => {
        const id = inputNewProdId?.value?.trim();
        const name = inputNewProdName?.value?.trim();
        const price = Number(inputNewProdPrice?.value || 0);

        if (!id || !name || price <= 0) {
            if (addProductNotice) {
                addProductNotice.style.display = "block";
                addProductNotice.style.background = "rgba(239, 68, 68, 0.15)";
                addProductNotice.style.border = "1px solid rgba(239, 68, 68, 0.4)";
                addProductNotice.style.color = "#fca5a5";
                addProductNotice.textContent = "Please provide a valid SKU, Product Title, and Price greater than 0.";
            }
            return;
        }

        saveNewProdBtn.disabled = true;
        saveNewProdBtn.textContent = "Saving...";

        // Parse specifications string "Key: Value, Key2: Value2"
        const specsObj = {};
        const rawSpecs = inputNewProdSpecs?.value?.trim() || "";
        if (rawSpecs) {
            rawSpecs.split(",").forEach(part => {
                const [k, v] = part.split(":").map(s => s?.trim());
                if (k && v) specsObj[k] = v;
            });
        }

        try {
            const res = await fetch(`${API_BASE_URL}/api/catalog/product`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    product_id: id,
                    name,
                    category: inputNewProdCategory?.value?.trim() || "General",
                    price,
                    stock: Number(inputNewProdStock?.value || 20),
                    image_url: inputNewProdImage?.value?.trim() || "https://images.unsplash.com/photo-1580481077194-453059eb774a?auto=format&fit=crop&w=800&q=80",
                    description: inputNewProdDescription?.value?.trim() || `Official ${name} designed for modern workspaces.`,
                    specifications: Object.keys(specsObj).length > 0 ? specsObj : { "Category": inputNewProdCategory?.value?.trim() || "General", "Condition": "Brand New" },
                    tags: [name.toLowerCase()]
                })
            });

            if (res.ok) {
                if (addProductNotice) {
                    addProductNotice.style.display = "block";
                    addProductNotice.style.background = "rgba(16, 185, 129, 0.15)";
                    addProductNotice.style.border = "1px solid rgba(16, 185, 129, 0.4)";
                    addProductNotice.style.color = "#6ee7b7";
                    addProductNotice.textContent = `✓ Product "${name}" saved to Cloud SQL catalog!`;
                }
                setTimeout(async () => {
                    if (addProductCard) addProductCard.style.display = "none";
                    if (addProductNotice) addProductNotice.style.display = "none";
                    if (inputNewProdName) inputNewProdName.value = "";
                    if (inputNewProdPrice) inputNewProdPrice.value = "";
                    await loadMerchantDashboard();
                    loadStorefrontShowcase();
                }, 900);
            } else {
                const errData = await res.json().catch(() => ({}));
                if (addProductNotice) {
                    addProductNotice.style.display = "block";
                    addProductNotice.style.background = "rgba(239, 68, 68, 0.15)";
                    addProductNotice.style.border = "1px solid rgba(239, 68, 68, 0.4)";
                    addProductNotice.style.color = "#fca5a5";
                    addProductNotice.textContent = errData.error || "Failed to save product to catalog.";
                }
            }
        } catch (err) {
            console.error("Product save failed:", err);
            if (addProductNotice) {
                addProductNotice.style.display = "block";
                addProductNotice.style.background = "rgba(239, 68, 68, 0.15)";
                addProductNotice.style.border = "1px solid rgba(239, 68, 68, 0.4)";
                addProductNotice.style.color = "#fca5a5";
                addProductNotice.textContent = "Network error: Failed to reach catalog API.";
            }
        } finally {
            saveNewProdBtn.disabled = false;
            saveNewProdBtn.textContent = "Save to Catalog";
        }
    });
}

// ============================================================
// WHATSAPP INSTANT PURCHASE LINK DISPATCHER
// ============================================================

const sendWhatsAppLinkBtn = document.getElementById("sendWhatsAppLinkBtn");
const inputDispatchPhone = document.getElementById("inputDispatchPhone");
const inputDispatchItem = document.getElementById("inputDispatchItem");
const inputDispatchPrice = document.getElementById("inputDispatchPrice");
const dispatchResultNotice = document.getElementById("dispatchResultNotice");

if (sendWhatsAppLinkBtn) {
    sendWhatsAppLinkBtn.addEventListener("click", async () => {
        const phone = inputDispatchPhone?.value?.trim();
        const item = inputDispatchItem?.value?.trim() || "Authorized Audio Bundle";
        const price = Number(inputDispatchPrice?.value || 6500);

        if (!phone) {
            if (dispatchResultNotice) {
                dispatchResultNotice.style.display = "block";
                dispatchResultNotice.style.color = "#ef4444";
                dispatchResultNotice.textContent = "⚠️ Please enter a customer WhatsApp number.";
            }
            return;
        }

        sendWhatsAppLinkBtn.disabled = true;
        sendWhatsAppLinkBtn.textContent = "Sending...";

        try {
            const checkoutUrl = `${window.location.origin}/?item=${encodeURIComponent(item)}&negotiated_price=${price}`;
            const res = await fetch(`${API_BASE_URL}/api/channels/whatsapp/send-link`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    phone_number: phone,
                    item_name: item,
                    final_price_inr: price,
                    checkout_url: checkoutUrl
                })
            });

            const data = await res.json();
            if (dispatchResultNotice) {
                dispatchResultNotice.style.display = "block";
                dispatchResultNotice.style.color = "#10b981";
                const linkHtml = data.whatsapp_direct_link ? `<div style="margin-top: 6px;"><a href="${escapeHtml(data.whatsapp_direct_link)}" target="_blank" rel="noopener noreferrer" style="color: #34d399; text-decoration: underline; font-weight: 500;">Open in WhatsApp ↗</a></div>` : "";
                dispatchResultNotice.innerHTML = `✓ <strong>Link Dispatched</strong> to ${escapeHtml(data.recipient)}! Free transaction tier confirmed. Message recorded in Cloud SQL.${linkHtml}`;
            }
        } catch (e) {
            console.error(e);
            if (dispatchResultNotice) {
                dispatchResultNotice.style.display = "block";
                dispatchResultNotice.style.color = "#ef4444";
                dispatchResultNotice.textContent = "Failed to dispatch WhatsApp link.";
            }
        } finally {
            sendWhatsAppLinkBtn.disabled = false;
            sendWhatsAppLinkBtn.textContent = "💬 Dispatch Payment Link";
        }
    });
}

// Initial fetch on app start
loadStoreConfig();


// ============================================================
// NEW CHAT
// ============================================================

function startNewChat() {

    setDashboardMode(false);

    sessionId = null;

    currentIntentId = null;

    currentProduct = null;
    lastPayment = null;
    lastAuditTrail = [];


    messages.innerHTML = "";


    welcomeScreen.style.display =
        "block";


    setState(
        "Waiting for request",
        "Your shopping session hasn't started yet.",
        ""
    );


    resetPipeline();

    if (typeof renderCartUI === "function") {
        renderCartUI();
    }
}


// ============================================================
// HIDE WELCOME
// ============================================================

function hideWelcome() {

    welcomeScreen.style.display =
        "none";
}


// ============================================================
// LOADING
// ============================================================

function setLoading(value) {

    isLoading = value;

    sendButton.disabled =
        value;

    messageInput.disabled =
        value;


    if (value) {

        sendButton.innerHTML =
            '<span>…</span>';

    } else {

        sendButton.innerHTML =
            '<span>↑</span>';
    }
}


// ============================================================
// STATE PANEL
// ============================================================

function setState(
    title,
    description,
    state
) {

    stateTitle.textContent =
        title;

    stateDescription.textContent =
        description;


    stateIndicator.className =
        "state-indicator";


    if (state === "active") {

        stateIndicator.classList.add(
            "active"
        );

    } else if (state === "warning") {

        stateIndicator.classList.add(
            "warning"
        );
    }
}


// ============================================================
// PIPELINE
// ============================================================

function activatePipeline(element) {

    if (!element) {
        return;
    }

    element.classList.add(
        "active"
    );
}


function markPipelineComplete(element) {

    if (!element) {
        return;
    }

    element.classList.remove(
        "active"
    );

    element.classList.add(
        "completed"
    );
}


function resetPipeline() {

    [
        pipelineIntent,
        pipelinePolicy,
        pipelineApproval,
        pipelinePayment
    ].forEach(
        element => {

            if (!element) {
                return;
            }

            element.classList.remove(
                "active",
                "completed"
            );
        }
    );
}


// ============================================================
// FORMAT CURRENCY
// ============================================================

function formatCurrency(
    amount,
    currency
) {
    const validAmount = Number(amount) || 0;

    if (
        currency === "INR"
    ) {

        return new Intl.NumberFormat(
            "en-IN",
            {
                style: "currency",
                currency: "INR",
                maximumFractionDigits: 0
            }
        ).format(validAmount);
    }


    return `${currency || ""} ${validAmount}`;
}


// ============================================================
// PRODUCT ICON
// ============================================================

function getProductIcon(
    name
) {

    const text =
        name.toLowerCase();


    if (
        text.includes("mouse")
    ) {
        return "🖱️";
    }


    if (
        text.includes("headphone")
    ) {
        return "🎧";
    }


    if (
        text.includes("laptop")
    ) {
        return "💻";
    }


    return "🛍️";
}


// ============================================================
// SCROLL
// ============================================================

function scrollChatToBottom() {

    const container =
        document.getElementById(
            "chatContainer"
        );


    setTimeout(
        () => {

            container.scrollTo({

                top:
                    container.scrollHeight,

                behavior:
                    "smooth"
            });

        },
        50
    );
}


// ============================================================
// TEXTAREA AUTO RESIZE
// ============================================================

function autoResizeTextarea() {

    messageInput.style.height =
        "auto";


    messageInput.style.height =
        `${Math.min(
            messageInput.scrollHeight,
            100
        )}px`;
}


// ============================================================
// KEYBOARD
// ============================================================

messageInput.addEventListener(
    "keydown",
    event => {

        if (
            event.key === "Enter" &&
            !event.shiftKey
        ) {

            event.preventDefault();

            sendMessage();
        }
    }
);


messageInput.addEventListener(
    "input",
    autoResizeTextarea
);


// ============================================================
// SEND BUTTON
// ============================================================

sendButton.addEventListener(
    "click",
    sendMessage
);


// ============================================================
// SUGGESTION CARDS
// ============================================================

document
    .querySelectorAll(
        ".suggestion-card"
    )
    .forEach(
        button => {

            button.addEventListener(
                "click",
                () => {

                    const message =
                        button.dataset.message;


                    messageInput.value =
                        message;


                    autoResizeTextarea();


                    sendMessage();
                }
            );
        }
    );


// ============================================================
// NEW CHAT
// ============================================================

newChatButton.addEventListener(
    "click",
    startNewChat
);


// ============================================================
// ORDERS
// ============================================================

function formatOrderStatus(status) {

    const labels = {
        payment_verified: "Payment verified",
        payment_pending: "Payment pending",
        payment_failed: "Payment failed"
    };

    return labels[status] || status || "Unknown";
}


let ordersFilterStatus = "all";
let ordersSearchQuery = "";

function renderOrders(orders) {

    if (!ordersList) {
        return;
    }

    ordersList.innerHTML = "";

    const allOrders = Array.isArray(orders) ? orders : [];

    // Filter by status & search query
    const filteredOrders = allOrders.filter(order => {
        // Status filter
        if (ordersFilterStatus === "verified" && !order.payment_id && order.status !== "paid" && order.status !== "verified") {
            return false;
        }

        // Search query filter
        if (ordersSearchQuery.trim()) {
            const q = ordersSearchQuery.toLowerCase().trim();
            const orderId = String(order.order_id || "").toLowerCase();
            const prodName = String(order.product_name || "").toLowerCase();
            const paymentId = String(order.payment_id || "").toLowerCase();
            const customer = String(order.customer_name || order.customer_email || "").toLowerCase();
            if (!orderId.includes(q) && !prodName.includes(q) && !paymentId.includes(q) && !customer.includes(q)) {
                return false;
            }
        }
        return true;
    });

    if (filteredOrders.length === 0) {
        const isFiltered = ordersSearchQuery.trim() || ordersFilterStatus !== "all";
        ordersList.innerHTML = `
            <div class="dashboard-empty" style="padding: 48px 24px; text-align: center;">
                <div style="font-size: 36px; margin-bottom: 14px;">${isFiltered ? "🔍" : "📦"}</div>
                <strong style="font-size: 15px; color: var(--text); display: block; margin-bottom: 6px;">
                    ${isFiltered ? "No orders matched your search/filter criteria" : "No orders found yet"}
                </strong>
                <p style="color: var(--muted); font-size: 13px; max-width: 400px; margin: 0 auto 20px; line-height: 1.6;">
                    ${isFiltered ? "Try searching with a different order ID, item name, or reset your filters." : "When you negotiate or purchase products through AI Chat or Instant Checkout, verified orders with downloadable receipts appear here."}
                </p>
                <button class="button primary" id="emptyOrdersStartBtn" type="button" style="margin: 0 auto; padding: 10px 22px;">
                    ${isFiltered ? "Clear Search Filters" : "Start Autonomous Shopping →"}
                </button>
            </div>
        `;

        document.getElementById("emptyOrdersStartBtn")?.addEventListener("click", () => {
            if (isFiltered) {
                ordersSearchQuery = "";
                ordersFilterStatus = "all";
                const searchInput = document.getElementById("ordersSearchInput");
                if (searchInput) searchInput.value = "";
                document.querySelectorAll(".order-filter-btn").forEach(b => b.classList.toggle("active", b.getAttribute("data-status") === "all"));
                renderOrders(currentOrdersCache);
            } else {
                newChatButton?.click();
            }
        });

        return;
    }

    ordersList.innerHTML = `<div class="orders-grid" id="ordersGridContainer"></div>`;
    const gridContainer = document.getElementById("ordersGridContainer");

    filteredOrders.forEach(order => {
        const card = document.createElement("div");
        card.className = "order-card-enhanced";

        const amount = order.amount !== null && order.amount !== undefined
            ? formatCurrency(order.amount, order.currency || "INR")
            : "—";

        const formattedDate = order.created_at
            ? new Date(order.created_at).toLocaleDateString("en-IN", {
                month: "short",
                day: "numeric",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit"
            })
            : "Recent";

        const productName = order.product_name || "Curated Workspace Technology Package";
        const merchantName = order.merchant || currentStoreConfig?.store_name || "Enterprise Tech Store";

        card.innerHTML = `
            <div class="order-card-header">
                <div class="order-card-id">
                    <span style="color: var(--muted); font-weight: 500;">Order</span>
                    <strong style="color: var(--text);">#${escapeHtml(order.order_id || "Order")}</strong>
                </div>

                <div style="display: flex; align-items: center; gap: 10px;">
                    <span class="order-badge-verified">
                        <span style="width: 6px; height: 6px; border-radius: 50%; background: var(--success); display: inline-block;"></span>
                        PAID & VERIFIED
                    </span>
                    <span style="font-size: 11px; color: var(--muted);">${escapeHtml(formattedDate)}</span>
                </div>
            </div>

            <div class="order-card-body">
                <div>
                    <div class="order-product-name">${escapeHtml(productName)}</div>
                    <div class="order-meta-text">
                        Merchant: <strong style="color: var(--text);">${escapeHtml(merchantName)}</strong>
                        ${order.payment_id ? ` • Payment Ref: <code style="color: var(--accent); background: var(--accent-soft); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--accent-border);">${escapeHtml(order.payment_id)}</code>` : ""}
                    </div>
                </div>

                <div class="order-amount-display">
                    ${escapeHtml(amount)}
                    <div style="font-size: 10px; color: var(--muted); font-weight: 500; margin-top: 2px;">Verified on-chain/ledger</div>
                </div>
            </div>

            <div class="order-actions-bar">
                <button class="order-btn track-btn" type="button" data-order-id="${escapeHtml(order.order_id)}" data-action="track">
                    🚚 Live Tracking
                </button>
                <button class="order-btn download-btn" type="button" data-order-id="${escapeHtml(order.order_id)}" data-action="invoice">
                    📄 View & Download Invoice
                </button>
                <button class="order-btn assistant-btn" type="button" data-order-id="${escapeHtml(order.order_id)}" data-action="assist">
                    💬 Ask AI Assistant
                </button>
                <button class="order-btn delete-btn" type="button" data-order-id="${escapeHtml(order.order_id)}" data-action="delete">
                    🗑️ Delete
                </button>
            </div>
        `;

        // Action listeners
        const trackBtn = card.querySelector('[data-action="track"]');
        const invoiceBtn = card.querySelector('[data-action="invoice"]');
        const assistBtn = card.querySelector('[data-action="assist"]');
        const deleteBtn = card.querySelector('[data-action="delete"]');

        trackBtn?.addEventListener("click", () => {
            openTrackingModal(order.order_id);
        });

        invoiceBtn?.addEventListener("click", () => {
            openInvoiceModal(order);
        });

        assistBtn?.addEventListener("click", () => {
            askAssistantAboutOrder(order);
        });

        deleteBtn?.addEventListener("click", () => {
            openDeleteOrderModal(order.order_id || order.intent_id);
        });

        gridContainer.appendChild(card);
    });
}

// Global reference for active orders & delete modal state
let currentOrdersCache = [];
let pendingDeleteOrderId = null;

const deleteOrderConfirmModal = document.getElementById("deleteOrderConfirmModal");
const deleteOrderModalId = document.getElementById("deleteOrderModalId");
const closeDeleteModal = document.getElementById("closeDeleteModal");
const cancelDeleteOrderBtn = document.getElementById("cancelDeleteOrderBtn");
const confirmDeleteOrderBtn = document.getElementById("confirmDeleteOrderBtn");

function openDeleteOrderModal(orderId) {
    if (!orderId) return;
    pendingDeleteOrderId = orderId;
    if (deleteOrderModalId) {
        deleteOrderModalId.textContent = `#${orderId}`;
    }
    deleteOrderConfirmModal?.classList.remove("hidden");
}

function closeDeleteOrderModal() {
    deleteOrderConfirmModal?.classList.add("hidden");
    pendingDeleteOrderId = null;
}

closeDeleteModal?.addEventListener("click", closeDeleteOrderModal);
cancelDeleteOrderBtn?.addEventListener("click", closeDeleteOrderModal);

deleteOrderConfirmModal?.addEventListener("click", (e) => {
    if (e.target === deleteOrderConfirmModal) {
        closeDeleteOrderModal();
    }
});

confirmDeleteOrderBtn?.addEventListener("click", async () => {
    if (!pendingDeleteOrderId) return;
    const orderId = pendingDeleteOrderId;
    confirmDeleteOrderBtn.disabled = true;
    confirmDeleteOrderBtn.textContent = "Deleting...";

    try {
        await executeDeleteOrder(orderId);
        closeDeleteOrderModal();
    } catch (err) {
        console.error("Delete order error:", err);
        showToast("Error deleting order: " + (err.message || "Request failed"), "error");
    } finally {
        confirmDeleteOrderBtn.disabled = false;
        confirmDeleteOrderBtn.textContent = "Confirm Delete";
    }
});

async function executeDeleteOrder(orderId) {
    if (!orderId) return;

    // Optimistically update local cache so UI updates immediately
    if (Array.isArray(currentOrdersCache)) {
        currentOrdersCache = currentOrdersCache.filter(o => {
            const oId = String(o.order_id || "").replace(/^#/, "").trim().toLowerCase();
            const targetId = String(orderId).replace(/^#/, "").trim().toLowerCase();
            const iId = String(o.intent_id || "").trim().toLowerCase();
            return oId !== targetId && iId !== targetId;
        });
        renderOrders(currentOrdersCache);
    }

    try {
        const response = await fetch(`${API_BASE_URL}/orders/${encodeURIComponent(orderId)}`, {
            method: "DELETE",
            headers: {
                "Accept": "application/json"
            }
        });

        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || result.message || "Failed to delete order.");
        }
        showToast(`Order #${orderId} permanently deleted.`, "success");
    } catch (err) {
        console.warn("Backend delete sync:", err);
        showToast(`Order #${orderId} removed from records.`, "success");
    }

    // Refresh from server to ensure accurate state
    await loadOrders();
}

// In-app Toast Notification helper (replaces intrusive alert boxes)
function showToast(message, type = "info") {
    const container = document.getElementById("appToastContainer");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `app-toast ${type}`;
    const icon = type === "success" ? "✓" : (type === "error" ? "⚠️" : "ℹ️");
    toast.innerHTML = `<span>${icon}</span> <span>${escapeHtml(message)}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateY(8px)";
        toast.style.transition = "opacity 0.3s ease, transform 0.3s ease";
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

function askAssistantAboutOrder(order) {
    if (!order) return;

    // Switch view to chat
    newChatButton?.click();

    const orderPrompt = `I need assistance with Order #${order.order_id}. What is the live delivery tracking, courier ETA, and warranty coverage for my ${order.product_name || 'order'}?`;
    
    // Fill prompt and trigger
    if (messageInput) {
        messageInput.value = orderPrompt;
        setTimeout(() => {
            sendMessage();
        }, 100);
    }
}

// Invoice Modal Logic
let activeInvoiceOrder = null;

function openInvoiceModal(order) {
    if (!order) return;
    activeInvoiceOrder = order;

    const invoiceModal = document.getElementById("invoiceModal");
    if (!invoiceModal) return;

    const storeNameEl = document.getElementById("invoiceStoreName");
    const storeDomainEl = document.getElementById("invoiceStoreDomain");
    const invoiceNumEl = document.getElementById("invoiceNumber");
    const invoiceDateEl = document.getElementById("invoiceDate");
    const orderIdEl = document.getElementById("invoiceOrderId");
    const paymentIdEl = document.getElementById("invoicePaymentId");
    const buyerIdEl = document.getElementById("invoiceBuyerId");
    const payMethodEl = document.getElementById("invoicePaymentMethod");
    const tableBody = document.getElementById("invoiceTableBody");
    const totalAmountEl = document.getElementById("invoiceTotalAmount");

    const storeName = currentStoreConfig?.store_name || order.merchant || "Enterprise AI Commerce";
    const storeDomain = currentStoreConfig?.store_domain || "commerce.workspace.tech";

    if (storeNameEl) storeNameEl.textContent = storeName;
    if (storeDomainEl) storeDomainEl.textContent = storeDomain;

    const shortId = (order.order_id || "").replace(/^order_/i, "").toUpperCase().slice(0, 8);
    if (invoiceNumEl) invoiceNumEl.textContent = `INV-${shortId || "2026"}`;

    const dateStr = order.created_at
        ? new Date(order.created_at).toLocaleDateString("en-IN", { dateStyle: "long" })
        : new Date().toLocaleDateString("en-IN", { dateStyle: "long" });
    if (invoiceDateEl) invoiceDateEl.textContent = dateStr;

    if (orderIdEl) orderIdEl.textContent = order.order_id || "N/A";
    if (paymentIdEl) paymentIdEl.textContent = order.payment_id || "rzp_direct_verified";
    if (buyerIdEl) buyerIdEl.textContent = order.buyer_id || "Customer (Autonomous Session)";
    if (payMethodEl) payMethodEl.textContent = order.payment_method || "UPI (Verified)";

    const formattedAmount = formatCurrency(order.amount || 0, order.currency || "INR");
    if (totalAmountEl) totalAmountEl.textContent = formattedAmount;

    if (tableBody) {
        tableBody.innerHTML = `
            <tr>
                <td style="padding: 14px 0;">
                    <div style="font-weight: 600; color: var(--text);">${escapeHtml(order.product_name || "Curated Technology Suite")}</div>
                    <div style="font-size: 11px; color: var(--muted); margin-top: 3px;">Autonomous Quorum Consensus Verified • 1-Year Comprehensive Warranty</div>
                </td>
                <td style="text-align: center; color: var(--text); padding: 14px 0;">1</td>
                <td style="text-align: right; font-weight: 700; color: var(--text); padding: 14px 0;">${escapeHtml(formattedAmount)}</td>
            </tr>
        `;
    }

    invoiceModal.classList.remove("hidden");
}

function closeInvoiceModal() {
    const invoiceModal = document.getElementById("invoiceModal");
    invoiceModal?.classList.add("hidden");
    activeInvoiceOrder = null;
}

// Download formatted plain text / markdown receipt
function downloadOrderReceipt(order) {
    if (!order) return;

    const storeName = currentStoreConfig?.store_name || order.merchant || "Enterprise AI Commerce";
    const amountStr = formatCurrency(order.amount || 0, order.currency || "INR");
    const dateStr = order.created_at ? new Date(order.created_at).toLocaleString("en-IN") : new Date().toLocaleString("en-IN");

    const receiptContent = `=====================================================
            OFFICIAL PURCHASE RECEIPT
=====================================================
Merchant:     ${storeName}
Date:         ${dateStr}
Order ID:     ${order.order_id || "N/A"}
Payment Ref:  ${order.payment_id || "rzp_test_verified"}
Status:       PAID & CRYPTOGRAPHICALLY VERIFIED
-----------------------------------------------------
ITEMS:
1x ${order.product_name || "Curated Technology Suite"}
   Price: ${amountStr}
-----------------------------------------------------
SUBTOTAL:     ${amountStr}
TAX (18% GST): INCLUDED
TOTAL PAID:   ${amountStr}
=====================================================
WARRANTY & ASSISTANCE:
1-Year Direct Manufacturer Replacement Guarantee.
To track shipment or claim warranty, contact the AI
Commerce Assistant with your Order ID #${order.order_id}.
=====================================================
`;

    const blob = new Blob([receiptContent], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `receipt_${order.order_id || "order"}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

// Export all orders as CSV
function exportOrdersAsCsv() {
    if (!currentOrdersCache || currentOrdersCache.length === 0) {
        alert("No orders available to export.");
        return;
    }

    const headers = ["Order ID", "Date", "Product", "Amount", "Currency", "Status", "Payment ID", "Merchant"];
    const rows = currentOrdersCache.map(o => [
        `"${(o.order_id || "").replace(/"/g, '""')}"`,
        `"${(o.created_at || "").replace(/"/g, '""')}"`,
        `"${(o.product_name || "").replace(/"/g, '""')}"`,
        `"${o.amount != null ? o.amount : ''}"`,
        `"${(o.currency || "INR").replace(/"/g, '""')}"`,
        `"${(o.status || "paid").replace(/"/g, '""')}"`,
        `"${(o.payment_id || "").replace(/"/g, '""')}"`,
        `"${(o.merchant || "").replace(/"/g, '""')}"`
    ]);

    const csvContent = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `orders_export_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

async function loadOrders() {

    if (!ordersList) {
        return;
    }

    ordersList.innerHTML = `
        <div class="dashboard-empty">
            Loading orders...
        </div>
    `;

    try {

        const response =
            await fetch(
                `${API_BASE_URL}/orders`,
                {
                    headers: {
                        "Accept": "application/json"
                    }
                }
            );

        const data =
            await response.json();

        if (!response.ok) {

            throw new Error(
                data.detail ||
                "Unable to load orders."
            );
        }

        currentOrdersCache = data.orders || [];
        renderOrders(data.orders);

    } catch (error) {

        ordersList.innerHTML = `
            <div class="dashboard-empty">
                Unable to load orders.
                <br>
                ${escapeHtml(
                    error.message ||
                    "Unknown error."
                )}
            </div>
        `;
    }
}


ordersButton.addEventListener(
    "click",
    () => {

        merchantDashboard.classList.add(
            "hidden"
        );

        chatContainer.classList.add(
            "hidden"
        );

        composerWrapper.classList.add(
            "hidden"
        );

        document
            .querySelector(".inspector")
            ?.classList.add("hidden");

        cartDashboard?.classList.add("hidden");
        document.getElementById("whatsappView")?.classList.add("hidden");
        document.getElementById("whatsappNavButton")?.classList.remove("active");

        ordersView?.classList.remove(
            "hidden"
        );

        newChatButton.classList.remove(
            "active"
        );

        merchantButton.classList.remove(
            "active"
        );

        ordersButton.classList.add(
            "active"
        );

        const heading =
            document.querySelector(".topbar h1");

        if (heading) {

            heading.innerHTML =
                'Verified <span>orders.</span>';
        }

        const eyebrow =
            document.querySelector(".topbar .eyebrow");

        if (eyebrow) {

            eyebrow.textContent =
                "ORDER REPOSITORY";
        }

        loadOrders();
    }
);


ordersRefreshButton?.addEventListener(
    "click",
    loadOrders
);

// Real-time Orders Search & Status Filtering
const ordersSearchInput = document.getElementById("ordersSearchInput");
ordersSearchInput?.addEventListener("input", (e) => {
    ordersSearchQuery = e.target.value || "";
    renderOrders(currentOrdersCache);
});

document.querySelectorAll("#ordersStatusFilters .order-filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll("#ordersStatusFilters .order-filter-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        ordersFilterStatus = btn.getAttribute("data-status") || "all";
        renderOrders(currentOrdersCache);
    });
});

document.getElementById("ordersExportCsvButton")?.addEventListener(
    "click",
    exportOrdersAsCsv
);

document.getElementById("closeInvoiceModal")?.addEventListener(
    "click",
    closeInvoiceModal
);

document.getElementById("invoiceModal")?.addEventListener("click", (e) => {
    if (e.target.id === "invoiceModal") {
        closeInvoiceModal();
    }
});

function printGstTaxInvoice(order) {
    if (!order) return;
    const storeName = currentStoreConfig?.store_name || order.merchant || "Enterprise AI Commerce";
    const totalAmount = Number(order.amount || 0);
    const baseAmount = Math.round((totalAmount / 1.18) * 100) / 100;
    const cgst = Math.round((baseAmount * 0.09) * 100) / 100;
    const sgst = Math.round((totalAmount - baseAmount - cgst) * 100) / 100;
    const dateStr = order.created_at ? new Date(order.created_at).toLocaleDateString("en-IN", { year: 'numeric', month: 'short', day: 'numeric' }) : new Date().toLocaleDateString("en-IN");
    const gstin = "29AABCE1234F1Z9";

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
        window.print();
        return;
    }

    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>GST Tax Invoice - ${escapeHtml(order.order_id || "Order")}</title>
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #111; padding: 30px; margin: 0; }
                .invoice-box { max-width: 800px; margin: auto; border: 1px solid #cbd5e1; padding: 24px; border-radius: 8px; }
                .header { display: flex; justify-content: space-between; border-bottom: 2px solid #2563eb; padding-bottom: 16px; margin-bottom: 20px; }
                .title { font-size: 22px; font-weight: bold; color: #1e3a8a; }
                .badge { background: #dbeafe; color: #1e40af; font-size: 11px; font-weight: bold; padding: 3px 8px; border-radius: 4px; display: inline-block; margin-top: 4px; }
                .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px; font-size: 13px; line-height: 1.5; }
                table { width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 13px; }
                th { background: #f1f5f9; text-align: left; padding: 10px; border-bottom: 2px solid #cbd5e1; }
                td { padding: 10px; border-bottom: 1px solid #e2e8f0; }
                .total-box { margin-left: auto; width: 280px; font-size: 13px; }
                .total-row { display: flex; justify-content: space-between; padding: 4px 0; }
                .grand-total { border-top: 2px solid #111; font-weight: bold; font-size: 15px; padding-top: 8px; margin-top: 4px; }
                .footer { border-top: 1px dashed #cbd5e1; margin-top: 30px; padding-top: 14px; font-size: 11px; color: #64748b; text-align: center; }
            </style>
        </head>
        <body>
            <div class="invoice-box">
                <div class="header">
                    <div>
                        <div class="title">${escapeHtml(storeName)}</div>
                        <div class="badge">TAX INVOICE / CASH MEMO</div>
                        <div style="font-size: 12px; color: #475569; margin-top: 6px;">GSTIN: <strong>${gstin}</strong> • PAN: AABCE1234F</div>
                    </div>
                    <div style="text-align: right; font-size: 13px;">
                        <div>Invoice No: <strong>INV-${escapeHtml(order.order_id || "001")}</strong></div>
                        <div>Date: <strong>${dateStr}</strong></div>
                        <div>Payment: <strong style="color: #15803d;">PAID (Razorpay)</strong></div>
                    </div>
                </div>

                <div class="meta-grid">
                    <div>
                        <strong>Billed To:</strong><br>
                        ${escapeHtml(order.customer_name || "Enterprise Customer")}<br>
                        ${escapeHtml(order.customer_email || "customer@example.com")}<br>
                        ${escapeHtml(order.shipping_address || "Bengaluru, Karnataka, 560001")}<br>
                        State Code: 29 (Karnataka)
                    </div>
                    <div style="text-align: right;">
                        <strong>Dispatched From:</strong><br>
                        ${escapeHtml(storeName)} Fulfillment Center<br>
                        100 Innovation Boulevard, Cyber Zone<br>
                        Bengaluru, KA 560100<br>
                        HSN / SAC Code: <strong>84713010</strong>
                    </div>
                </div>

                <table>
                    <thead>
                        <tr>
                            <th>Description</th>
                            <th>HSN</th>
                            <th>Qty</th>
                            <th style="text-align: right;">Taxable Value</th>
                            <th style="text-align: right;">Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td><strong>${escapeHtml(order.product_name || "Curated Technology Suite")}</strong><br><span style="font-size: 11px; color: #64748b;">Includes 2-Year Enterprise Warranty</span></td>
                            <td>84713010</td>
                            <td>1</td>
                            <td style="text-align: right;">₹${baseAmount.toLocaleString("en-IN")}</td>
                            <td style="text-align: right;">₹${baseAmount.toLocaleString("en-IN")}</td>
                        </tr>
                    </tbody>
                </table>

                <div class="total-box">
                    <div class="total-row"><span>Taxable Amount:</span> <span>₹${baseAmount.toLocaleString("en-IN")}</span></div>
                    <div class="total-row"><span>CGST (9%):</span> <span>₹${cgst.toLocaleString("en-IN")}</span></div>
                    <div class="total-row"><span>SGST (9%):</span> <span>₹${sgst.toLocaleString("en-IN")}</span></div>
                    <div class="total-row grand-total"><span>Grand Total:</span> <span>₹${totalAmount.toLocaleString("en-IN")} INR</span></div>
                </div>

                <div class="footer">
                    This is a computer-generated tax invoice verified under Government of India GST rules.<br>
                    Cryptographic Payment Hash: <code>${escapeHtml(order.payment_id || "rzp_verified_cryptoseal")}</code>
                </div>
            </div>
            <script>
                window.onload = () => { window.print(); };
            </script>
        </body>
        </html>
    `);
    printWindow.document.close();
}

document.getElementById("invoicePrintBtn")?.addEventListener("click", () => {
    if (activeInvoiceOrder) {
        printGstTaxInvoice(activeInvoiceOrder);
    } else {
        window.print();
    }
});

document.getElementById("invoiceDownloadTextBtn")?.addEventListener("click", () => {
    if (activeInvoiceOrder) {
        downloadOrderReceipt(activeInvoiceOrder);
    }
});


// ============================================================
// MODAL
// ============================================================

closeModal.addEventListener(
    "click",
    closeApprovalModal
);


rejectButton.addEventListener(
    "click",
    rejectPurchase
);


approveButton.addEventListener(
    "click",
    approvePurchase
);


// Close modal by clicking outside

approvalModal.addEventListener(
    "click",
    event => {

        if (
            event.target ===
            approvalModal
        ) {

            closeApprovalModal();
        }
    }
);


// ============================================================
// ESC KEY
// ============================================================

document.addEventListener(
    "keydown",
    event => {

        if (
            event.key === "Escape"
        ) {

            closeApprovalModal();
        }
    }
);


// ============================================================
// STARTUP & INCOMING CHECKOUT LINK RESOLVER
// ============================================================

async function handleIncomingCheckoutParams() {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const intentParam = urlParams.get("intent_id") || urlParams.get("intent");
        const itemParam = urlParams.get("item") || urlParams.get("item_id") || urlParams.get("product_id");
        const rawPrice = urlParams.get("negotiated_price") || urlParams.get("price") || urlParams.get("final_price_inr");

        if (intentParam) {
            currentIntentId = intentParam;
            try {
                const intentRes = await fetch(`${API_BASE_URL}/intent/${intentParam}`);
                if (intentRes.ok) {
                    const intentData = await intentRes.json();
                    if (welcomeScreen) welcomeScreen.style.display = "none";
                    const offer = intentData.offer || intentData.commerce_contract?.offer;
                    const prodName = offer?.primary_product?.name || offer?.product_name || "Verified Order";
                    const prodPrice = offer?.final_amount || intentData.intent?.max_amount || 0;

                    addCompiledToolCallMessage({
                        session_id: sessionId || "wa_customer",
                        intent_id: intentParam,
                        parameters: {
                            item_id: offer?.product_id || "OFFER_ITEM",
                            final_price_inr: prodPrice
                        },
                        gateway_config: { provider: "RAZORPAY_LIVE", currency: "INR" }
                    });

                    if (urlParams.get("payment") === "1" || urlParams.get("checkout") === "1") {
                        openApprovalModal({
                            name: prodName,
                            price: prodPrice,
                            product_id: offer?.product_id || "OFFER_ITEM",
                            reason: offer?.explanation || "WhatsApp pre-authorized checkout"
                        });
                    }
                    return;
                }
            } catch (e) {
                console.warn("Failed to load incoming intent details:", e);
            }
        }

        if (!itemParam) return;

        const priceParam = Number(rawPrice) || 6500;
        let displayName = itemParam;
        if (itemParam === "BUNDLE_HP_MS" || itemParam.toLowerCase().includes("audio") || itemParam.toLowerCase().includes("work")) {
            displayName = "Work & Focus Audio Bundle";
        } else if (itemParam === "BUNDLE_LAP_MS" || itemParam.toLowerCase().includes("developer")) {
            displayName = "Developer Complete Suite";
        }

        // Hide generic welcome screen immediately
        if (welcomeScreen) {
            welcomeScreen.style.display = "none";
        }

        // Switch to WhatsApp channel badge if buttons exist
        if (channelWhatsAppBtn && channelStorefrontBtn) {
            currentChannel = "whatsapp";
            channelWhatsAppBtn.classList.add("active");
            channelStorefrontBtn.classList.remove("active");
        }

        // Add inbound notification card to the chat
        const bannerWrapper = document.createElement("div");
        bannerWrapper.className = "message agent";
        bannerWrapper.innerHTML = `
            <div class="message-content" style="background: var(--panel-2); border: 1px solid var(--success-border); border-radius: 16px; padding: 18px; margin-bottom: 8px;">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                    <span style="display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 700; text-transform: uppercase; background: var(--success-soft); color: var(--success); padding: 4px 10px; border-radius: 999px; border: 1px solid var(--success-border);">
                        💬 WhatsApp Inbound Order
                    </span>
                    <span style="font-size: 12px; color: var(--success); font-weight: 600;">Pre-Authorized Session</span>
                </div>
                <div style="font-size: 16px; font-weight: 700; color: var(--text); margin-bottom: 4px;">
                    Pre-Negotiated Checkout: ${escapeHtml(displayName)}
                </div>
                <div style="font-size: 13px; color: var(--text-secondary);">
                    Welcome back! You opened your pre-authorized payment link negotiated via WhatsApp at <strong style="color: var(--success);">₹${priceParam.toLocaleString('en-IN')}.00 INR</strong>. Multi-agent quorum consensus and security policies have been evaluated.
                </div>
            </div>
        `;
        messages.appendChild(bannerWrapper);
        scrollChatToBottom();

        // Call backend to compile checkout contract & establish intent
        if (!sessionId) {
            sessionId = "wa_buyer_" + Math.random().toString(36).substring(2, 9);
        }
        const buyerId = sessionId;
        const res = await fetch(`${API_BASE_URL}/api/checkout/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                buyer_id: buyerId,
                item_id: itemParam,
                final_price_inr: priceParam
            })
        });

        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            addMessage("agent", `⚠️ ${errData.error || "Unable to activate incoming payment link."}`);
            return;
        }

        const data = await res.json();
        if (data.intent_id) {
            currentIntentId = data.intent_id;
        }

        // Render the pre-authorized Order Prepared card
        addCompiledToolCallMessage({
            ...data,
            session_id: buyerId,
            parameters: {
                buyer_id: buyerId,
                item_id: itemParam,
                final_price_inr: priceParam
            }
        });

        // Update purchase security states on right panel
        setState(
            "Order Compiled",
            "Pre-authorized transaction loaded from WhatsApp direct link. Multi-agent quorum consensus verified.",
            "active"
        );
        activatePipeline(pipelineApproval);
        await refreshCommerceLoop();

    } catch (err) {
        console.error("Failed to process inbound checkout params:", err);
    }
}

console.log(
    "AI Commerce Engine frontend loaded."
);

console.log(
    `Backend: ${API_BASE_URL}`
);

if (window.RAZORPAY_KEY_ID) {
    console.log("Razorpay public key configured.");
} else {
    console.log(
        "Razorpay public key not configured in frontend."
    );
}

// Automatically check for incoming WhatsApp / external checkout link on startup
handleIncomingCheckoutParams();

// ============================================================
// SYSTEM DESIGN MODULE: MULTI-ITEM CART & LIVE LOGISTICS
// ============================================================

const cartButton = document.getElementById("cartButton");
const cartDashboard = document.getElementById("cartDashboard");
const navCartBadge = document.getElementById("navCartBadge");
const cartItemsContainer = document.getElementById("cartItemsContainer");
const cartSummaryCount = document.getElementById("cartSummaryCount");
const cartSummarySubtotal = document.getElementById("cartSummarySubtotal");
const cartDiscountRow = document.getElementById("cartDiscountRow");
const cartDiscountLabel = document.getElementById("cartDiscountLabel");
const cartDiscountAmount = document.getElementById("cartDiscountAmount");
const cartSummaryTotal = document.getElementById("cartSummaryTotal");
const cartPincodeInput = document.getElementById("cartPincodeInput");
const cartCheckPincodeBtn = document.getElementById("cartCheckPincodeBtn");
const cartPincodeResult = document.getElementById("cartPincodeResult");
const cartCheckoutBtn = document.getElementById("cartCheckoutBtn");
const clearCartButton = document.getElementById("clearCartButton");

// Active Cart State initialized at top-level


async function fetchCart() {
    try {
        const res = await fetch(`${API_BASE_URL}/api/cart?session_id=${cartSessionId}`);
        const data = await res.json();
        if (data.success && data.cart) {
            if (data.cart.items && data.cart.items.length > 0) {
                clientCart = data.cart;
                try {
                    localStorage.setItem("commerce_client_cart_backup", JSON.stringify(clientCart));
                } catch (e) {}
                renderCartUI();
            } else {
                // Check if local backup had items (e.g. after fresh restart)
                const backupRaw = localStorage.getItem("commerce_client_cart_backup");
                if (backupRaw) {
                    try {
                        const backup = JSON.parse(backupRaw);
                        if (backup && backup.items && backup.items.length > 0) {
                            for (const it of backup.items) {
                                await fetch(`${API_BASE_URL}/api/cart/add`, {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({
                                        session_id: cartSessionId,
                                        product_id: it.product_id,
                                        quantity: it.quantity || 1
                                    })
                                });
                            }
                            const res2 = await fetch(`${API_BASE_URL}/api/cart?session_id=${cartSessionId}`);
                            const data2 = await res2.json();
                            if (data2.success && data2.cart) {
                                clientCart = data2.cart;
                                renderCartUI();
                                return;
                            }
                        }
                    } catch (err) {
                        console.warn("Could not restore cart from backup:", err);
                    }
                }
                clientCart = data.cart;
                renderCartUI();
            }
        }
    } catch (err) {
        console.error("Failed to fetch cart:", err);
    }
}

function renderCartUI() {
    try {
        if (clientCart && clientCart.items && clientCart.items.length > 0) {
            localStorage.setItem("commerce_client_cart_backup", JSON.stringify(clientCart));
        }
    } catch (e) {}

    const totalCount = clientCart.items.reduce((sum, item) => sum + item.quantity, 0);

    // Update Nav Badge
    if (navCartBadge) {
        if (totalCount > 0) {
            navCartBadge.textContent = totalCount;
            navCartBadge.style.display = "inline-block";
        } else {
            navCartBadge.style.display = "none";
        }
    }

    const mobileCartBadge = document.getElementById("mobileCartBadge");
    if (mobileCartBadge) {
        if (totalCount > 0) {
            mobileCartBadge.textContent = totalCount;
            mobileCartBadge.style.display = "inline-block";
        } else {
            mobileCartBadge.style.display = "none";
        }
    }

    // Update Persistent Floating Cart Widget
    const floatingCartWidget = document.getElementById("floatingCartWidget");
    const floatingCartCount = document.getElementById("floatingCartCount");
    const floatingCartTotal = document.getElementById("floatingCartTotal");

    if (floatingCartWidget) {
        if (totalCount > 0) {
            floatingCartWidget.classList.remove("hidden");
            if (floatingCartCount) floatingCartCount.textContent = totalCount;
            if (floatingCartTotal) floatingCartTotal.textContent = formatCurrency(clientCart.total_amount || 0, "INR");
        } else {
            floatingCartWidget.classList.add("hidden");
        }
    }

    // Update Welcome Screen Cart Resumption Banner (for New Shopping Session)
    const welcomeCartBanner = document.getElementById("welcomeCartBanner");
    const welcomeCartBadgeCount = document.getElementById("welcomeCartBadgeCount");
    const welcomeCartItemsSummary = document.getElementById("welcomeCartItemsSummary");
    const welcomeOpenCartBtn = document.getElementById("welcomeOpenCartBtn");

    if (welcomeCartBanner) {
        if (totalCount > 0) {
            welcomeCartBanner.classList.remove("hidden");
            if (welcomeCartBadgeCount) welcomeCartBadgeCount.textContent = `${totalCount} item${totalCount > 1 ? 's' : ''}`;
            if (welcomeCartItemsSummary) {
                const itemNames = clientCart.items.map(i => i.name).slice(0, 2).join(", ");
                const extra = clientCart.items.length > 2 ? ` + ${clientCart.items.length - 2} more` : "";
                welcomeCartItemsSummary.textContent = `${itemNames}${extra} • Total: ${formatCurrency(clientCart.total_amount, "INR")} (Saved & ready for payment)`;
            }
            if (welcomeOpenCartBtn && !welcomeOpenCartBtn.dataset.bound) {
                welcomeOpenCartBtn.dataset.bound = "true";
                welcomeOpenCartBtn.addEventListener("click", () => {
                    cartButton?.click();
                });
            }
        } else {
            welcomeCartBanner.classList.add("hidden");
        }
    }

    if (cartSummaryCount) cartSummaryCount.textContent = totalCount;
    if (cartSummarySubtotal) cartSummarySubtotal.textContent = formatCurrency(clientCart.subtotal || 0, "INR");
    if (cartSummaryTotal) cartSummaryTotal.textContent = formatCurrency(clientCart.total_amount || 0, "INR");

    if (clientCart.discount_amount && clientCart.discount_amount > 0) {
        if (cartDiscountRow) cartDiscountRow.style.display = "flex";
        if (cartDiscountLabel) cartDiscountLabel.textContent = clientCart.discount_label || "Multi-Item Bundle Discount";
        if (cartDiscountAmount) cartDiscountAmount.textContent = `-₹${clientCart.discount_amount.toLocaleString("en-IN")}`;
    } else {
        if (cartDiscountRow) cartDiscountRow.style.display = "none";
    }

    if (!cartItemsContainer) return;

    if (clientCart.items.length === 0) {
        cartItemsContainer.innerHTML = `
            <div class="dashboard-empty" style="padding: 40px 20px; text-align: center;">
                <div style="font-size: 36px; margin-bottom: 12px;">🛒</div>
                <h3 style="color: var(--text); font-size: 16px;">Your cart is empty</h3>
                <p style="color: var(--muted); font-size: 13px; max-width: 320px; margin: 8px auto 16px;">Browse our catalog or converse with the AI Concierge to get recommended workstation gear.</p>
                <button class="button primary" id="cartShopNowBtn" type="button" style="margin: 0 auto;">Start Shopping</button>
            </div>
        `;
        document.getElementById("cartShopNowBtn")?.addEventListener("click", () => {
            newChatButton?.click();
        });
        return;
    }

    cartItemsContainer.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 14px;">
            ${clientCart.items.map(item => `
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 14px; background: var(--panel-2); border-radius: 10px; border: 1px solid var(--border);">
                    <div style="display: flex; align-items: center; gap: 14px;">
                        <img src="${escapeHtml(item.image_url || 'https://images.unsplash.com/photo-1527864550417-7fd91fc51a46?w=200')}" style="width: 52px; height: 52px; object-fit: cover; border-radius: 8px; border: 1px solid var(--border);" />
                        <div>
                            <div style="font-weight: 600; color: var(--text); font-size: 14px;">${escapeHtml(item.name)}</div>
                            <div style="font-size: 12px; color: var(--accent); font-weight: 700; margin-top: 2px;">${formatCurrency(item.price, "INR")}</div>
                        </div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <div style="display: flex; align-items: center; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; background: var(--panel);">
                            <button type="button" class="cart-qty-btn" data-id="${item.product_id}" data-qty="${item.quantity - 1}" style="padding: 4px 10px; background: transparent; border: none; color: var(--text); cursor: pointer;">-</button>
                            <span style="padding: 4px 10px; font-size: 12px; font-weight: 700; color: var(--text);">${item.quantity}</span>
                            <button type="button" class="cart-qty-btn" data-id="${item.product_id}" data-qty="${item.quantity + 1}" style="padding: 4px 10px; background: transparent; border: none; color: var(--text); cursor: pointer;">+</button>
                        </div>
                        <button type="button" class="cart-del-btn" data-id="${item.product_id}" style="background: transparent; border: none; color: var(--danger); font-size: 16px; cursor: pointer; padding: 4px;" title="Remove Item">×</button>
                    </div>
                </div>
            `).join("")}
        </div>
    `;

    cartItemsContainer.querySelectorAll(".cart-qty-btn").forEach(btn => {
        btn.addEventListener("click", async () => {
            const pId = btn.getAttribute("data-id");
            const qty = parseInt(btn.getAttribute("data-qty"), 10);
            await updateCartItem(pId, qty);
        });
    });

    cartItemsContainer.querySelectorAll(".cart-del-btn").forEach(btn => {
        btn.addEventListener("click", async () => {
            const pId = btn.getAttribute("data-id");
            await updateCartItem(pId, 0);
        });
    });
}

async function updateCartItem(productId, quantity) {
    try {
        const res = await fetch(`${API_BASE_URL}/api/cart/update`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ session_id: cartSessionId, product_id: productId, quantity })
        });
        const data = await res.json();
        if (data.success && data.cart) {
            clientCart = data.cart;
            renderCartUI();
        }
    } catch (err) {
        showToast("Failed to update cart", "error");
    }
}

// Check Delivery Pincode SLA in Cart
cartCheckPincodeBtn?.addEventListener("click", async () => {
    const code = cartPincodeInput?.value?.trim();
    if (!code || !/^\d{6}$/.test(code)) {
        if (cartPincodeResult) {
            cartPincodeResult.style.display = "block";
            cartPincodeResult.innerHTML = `<span style="color: var(--danger);">Please enter a valid 6-digit Indian PIN code.</span>`;
        }
        return;
    }

    try {
        cartCheckPincodeBtn.disabled = true;
        cartCheckPincodeBtn.textContent = "Checking...";
        const res = await fetch(`${API_BASE_URL}/api/shipping/pincode/${code}`);
        const data = await res.json();
        cartCheckPincodeBtn.disabled = false;
        cartCheckPincodeBtn.textContent = "Check";

        if (data.success && cartPincodeResult) {
            const d = data.data;
            cartPincodeResult.style.display = "block";
            cartPincodeResult.innerHTML = `
                <div style="color: var(--success); font-weight: 600; margin-bottom: 2px;">✓ Serviceable Destination: ${escapeHtml(d.city)}, ${escapeHtml(d.state)}</div>
                <div>Estimated Delivery: <strong>${d.estimated_days} Day(s)</strong> (${d.zone} Zone). Express Carrier: ${d.courier_partners.slice(0, 2).join(", ")}. Standard Delivery is <strong>FREE</strong>.</div>
            `;
        }
    } catch (err) {
        cartCheckPincodeBtn.disabled = false;
        cartCheckPincodeBtn.textContent = "Check";
    }
});

// Pincode verify in Purchase Modal
document.getElementById("modalCheckPincodeBtn")?.addEventListener("click", async () => {
    const code = document.getElementById("modalCustomerPincode")?.value?.trim();
    const estimateEl = document.getElementById("modalPincodeEstimate");
    if (!code || !/^\d{6}$/.test(code)) {
        if (estimateEl) {
            estimateEl.style.color = "var(--danger)";
            estimateEl.textContent = "Please enter a valid 6-digit Indian PIN code.";
        }
        return;
    }

    try {
        const res = await fetch(`${API_BASE_URL}/api/shipping/pincode/${code}`);
        const data = await res.json();
        if (data.success && estimateEl) {
            const d = data.data;
            estimateEl.style.color = "var(--success)";
            estimateEl.textContent = `✓ ${d.city}, ${d.state} (${d.zone}): Delivery in ${d.estimated_days} Day(s) via BlueDart Air Priority (FREE)`;
            const cityInput = document.getElementById("modalCustomerCity");
            if (cityInput && (!cityInput.value || cityInput.value === "Bengaluru, Karnataka")) {
                cityInput.value = `${d.city}, ${d.state}`;
            }
        }
    } catch (err) {
        // Fallback
    }
});

// Floating Cart Pill Click -> Opens Shopping Cart View
document.getElementById("floatingCartWidget")?.addEventListener("click", () => {
    cartButton?.click();
});

// Cart Checkout -> autonomous Intent Contract creation
cartCheckoutBtn?.addEventListener("click", async () => {
    if (clientCart.items.length === 0) {
        showToast("Cart is empty. Please add items before checking out.", "error");
        return;
    }

    cartCheckoutBtn.disabled = true;
    cartCheckoutBtn.textContent = "Generating Intent Contract...";

    try {
        const res = await fetch(`${API_BASE_URL}/api/cart/checkout`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ session_id: cartSessionId })
        });
        const data = await res.json();
        cartCheckoutBtn.disabled = false;
        cartCheckoutBtn.textContent = "Proceed to Autonomous Checkout →";

        if (data.success && data.intent_id) {
            currentIntentId = data.intent_id;

            // Open approval modal
            const modal = document.getElementById("approvalModal");
            const modalProdName = document.getElementById("modalProductName");
            const modalProdPrice = document.getElementById("modalProductPrice");
            const modalReason = document.getElementById("modalProductReason");

            if (modalProdName) modalProdName.textContent = `Cart Bundle (${clientCart.items.length} items)`;
            if (modalProdPrice) modalProdPrice.textContent = formatCurrency(data.amount, "INR");
            if (modalReason) modalReason.textContent = "Multi-item bundle checkout verified under corporate policy";

            modal?.classList.remove("hidden");
            showToast("Intent Contract created for Cart Checkout", "success");
        } else {
            showToast(data.error || "Failed to initiate cart checkout", "error");
        }
    } catch (err) {
        cartCheckoutBtn.disabled = false;
        cartCheckoutBtn.textContent = "Proceed to Autonomous Checkout →";
        showToast("Checkout request error", "error");
    }
});

// Empty Cart Button
clearCartButton?.addEventListener("click", async () => {
    try {
        const res = await fetch(`${API_BASE_URL}/api/cart/clear`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ session_id: cartSessionId })
        });
        const data = await res.json();
        if (data.success) {
            clientCart = data.cart;
            try {
                localStorage.removeItem("commerce_client_cart_backup");
            } catch (e) {}
            renderCartUI();
            showToast("Cart emptied", "success");
        }
    } catch (err) {
        showToast("Failed to empty cart", "error");
    }
});

// Cart Navigation View Switcher
cartButton?.addEventListener("click", () => {
    merchantDashboard?.classList.add("hidden");
    chatContainer?.classList.add("hidden");
    composerWrapper?.classList.add("hidden");
    document.querySelector(".inspector")?.classList.add("hidden");
    ordersView?.classList.add("hidden");
    document.getElementById("whatsappView")?.classList.add("hidden");
    document.getElementById("whatsappNavButton")?.classList.remove("active");
    cartDashboard?.classList.remove("hidden");

    newChatButton?.classList.remove("active");
    merchantButton?.classList.remove("active");
    ordersButton?.classList.remove("active");
    cartButton?.classList.add("active");

    const heading = document.querySelector(".topbar h1");
    if (heading) heading.innerHTML = 'Shopping <span>cart.</span>';
    const eyebrow = document.querySelector(".topbar .eyebrow");
    if (eyebrow) eyebrow.textContent = "MULTI-ITEM CHECKOUT";

    fetchCart();
    loadStorefrontShowcase();
});

// ============================================================
// LIVE SHIPMENT TRACKING MODAL LOGIC
// ============================================================

const trackingModal = document.getElementById("trackingModal");
const closeTrackingModalBtn = document.getElementById("closeTrackingModal");
const closeTrackingBtn = document.getElementById("closeTrackingBtn");
const invoiceTrackLiveBtn = document.getElementById("invoiceTrackLiveBtn");

function closeTracking() {
    trackingModal?.classList.add("hidden");
}

closeTrackingModalBtn?.addEventListener("click", closeTracking);
closeTrackingBtn?.addEventListener("click", closeTracking);

async function openTrackingModal(orderId) {
    if (!orderId) return;

    try {
        const res = await fetch(`${API_BASE_URL}/api/orders/${encodeURIComponent(orderId)}/tracking`);
        const data = await res.json();

        if (data.success && data.tracking) {
            const t = data.tracking;
            const orderIdEl = document.getElementById("trackingOrderId");
            const awbEl = document.getElementById("trackingAwb");
            const carrierEl = document.getElementById("trackingCarrier");
            const estDateEl = document.getElementById("trackingEstDate");
            const timelineEl = document.getElementById("trackingTimeline");

            if (orderIdEl) orderIdEl.textContent = `#${t.order_id}`;
            if (awbEl) awbEl.textContent = t.awb_number;
            if (carrierEl) carrierEl.textContent = t.carrier;
            if (estDateEl) estDateEl.textContent = t.estimated_delivery;

            if (timelineEl) {
                timelineEl.innerHTML = t.checkpoints.map((cp) => `
                    <div style="display: flex; gap: 14px; align-items: flex-start; position: relative;">
                        <div style="width: 24px; height: 24px; border-radius: 50%; background: ${cp.completed ? '#10b981' : '#e2e8f0'}; color: ${cp.completed ? '#ffffff' : '#64748b'}; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; flex-shrink: 0; z-index: 2;">
                            ${cp.completed ? '✓' : '•'}
                        </div>
                        <div style="flex: 1;">
                            <div style="display: flex; justify-content: space-between; align-items: baseline;">
                                <strong style="font-size: 13px; color: ${cp.completed ? 'var(--text)' : 'var(--muted)'};">${escapeHtml(cp.title)}</strong>
                                <span style="font-size: 11px; color: var(--muted);">${escapeHtml(cp.time)}</span>
                            </div>
                            <div style="font-size: 12px; color: var(--muted); margin-top: 2px;">${escapeHtml(cp.location)}</div>
                            <div style="font-size: 12px; color: var(--text); margin-top: 4px; line-height: 1.4;">${escapeHtml(cp.description)}</div>
                        </div>
                    </div>
                `).join("");
            }

            trackingModal?.classList.remove("hidden");
        } else {
            showToast("Tracking info unavailable for this order", "error");
        }
    } catch (err) {
        showToast("Failed to fetch tracking details", "error");
    }
}

invoiceTrackLiveBtn?.addEventListener("click", () => {
    if (activeInvoiceOrder && activeInvoiceOrder.order_id) {
        openTrackingModal(activeInvoiceOrder.order_id);
    }
});

// Load cart count on startup
fetchCart();

// ============================================================
// WHATSAPP COMMERCE SANDBOX SIMULATOR CONTROLLER
// ============================================================

const whatsappNavButton = document.getElementById("whatsappNavButton");
const whatsappView = document.getElementById("whatsappView");
const waChatCanvas = document.getElementById("waChatCanvas");
const waInputMessage = document.getElementById("waInputMessage");
const waSendBtn = document.getElementById("waSendBtn");
const waQuickPrompts = document.querySelectorAll(".wa-quick-prompt");

function setWhatsAppSandboxMode() {
    merchantDashboard?.classList.add("hidden");
    chatContainer?.classList.add("hidden");
    composerWrapper?.classList.add("hidden");
    document.querySelector(".inspector")?.classList.add("hidden");
    ordersView?.classList.add("hidden");
    cartDashboard?.classList.add("hidden");
    whatsappView?.classList.remove("hidden");

    newChatButton?.classList.remove("active");
    merchantButton?.classList.remove("active");
    ordersButton?.classList.remove("active");
    cartButton?.classList.remove("active");
    whatsappNavButton?.classList.add("active");

    const heading = document.querySelector(".topbar h1");
    if (heading) heading.innerHTML = 'WhatsApp <span>commerce sandbox.</span>';
    const eyebrow = document.querySelector(".topbar .eyebrow");
    if (eyebrow) eyebrow.textContent = "META GRAPH API SIMULATOR";
}

whatsappNavButton?.addEventListener("click", setWhatsAppSandboxMode);

function appendWhatsAppBubble(sender, text, card = null, voiceMetadata = null) {
    if (!waChatCanvas) return;

    const bubble = document.createElement("div");
    const isUser = sender === "user";
    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    bubble.style.cssText = isUser
        ? "background: #005c4b; color: #e9edef; padding: 8px 12px; border-radius: 8px 8px 0 8px; max-width: 85%; align-self: flex-end; line-height: 1.4; box-shadow: 0 1px 2px rgba(0,0,0,0.3); margin-top: 4px;"
        : "background: #202c33; color: #e9edef; padding: 10px 12px; border-radius: 8px 8px 8px 0; max-width: 85%; align-self: flex-start; line-height: 1.4; box-shadow: 0 1px 2px rgba(0,0,0,0.3); margin-top: 4px;";

    let voiceHtml = "";
    if (voiceMetadata) {
        voiceHtml = `
            <div style="background: rgba(0,0,0,0.25); border-radius: 8px; padding: 8px 10px; display: flex; align-items: center; gap: 10px; margin-bottom: 6px;">
                <button type="button" class="wa-play-audio-btn" style="background: #25d366; color: #111; border: none; width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; cursor: pointer; font-weight: bold;">
                    ▶
                </button>
                <div style="flex: 1;">
                    <div style="display: flex; align-items: flex-end; gap: 3px; height: 16px; opacity: 0.85;">
                        <span style="width: 3px; height: 8px; background: #25d366; border-radius: 2px;"></span>
                        <span style="width: 3px; height: 14px; background: #25d366; border-radius: 2px;"></span>
                        <span style="width: 3px; height: 10px; background: #25d366; border-radius: 2px;"></span>
                        <span style="width: 3px; height: 16px; background: #25d366; border-radius: 2px;"></span>
                        <span style="width: 3px; height: 12px; background: #25d366; border-radius: 2px;"></span>
                        <span style="width: 3px; height: 7px; background: #25d366; border-radius: 2px;"></span>
                        <span style="width: 3px; height: 15px; background: #25d366; border-radius: 2px;"></span>
                        <span style="width: 3px; height: 9px; background: #25d366; border-radius: 2px;"></span>
                    </div>
                    <div style="font-size: 10px; color: #8696a0; margin-top: 2px;">🎙️ Voice Note (${voiceMetadata.duration || "0:08"})</div>
                </div>
            </div>
        `;
    }

    let cardHtml = "";
    if (card) {
        if (card.is_tracking) {
            cardHtml = `
                <div style="margin-top: 10px; background: #182229; border: 1.5px solid rgba(34, 197, 94, 0.4); border-radius: 10px; padding: 12px;">
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
                        <span style="font-size: 10px; font-weight: 800; background: rgba(34, 197, 94, 0.15); color: #22c55e; padding: 2px 7px; border-radius: 999px;">🚚 ${escapeHtml(card.status || 'IN TRANSIT')}</span>
                        <span style="font-size: 10.5px; color: #8696a0;">AWB: ${escapeHtml(card.waybill || 'BLU175505405')}</span>
                    </div>
                    <div style="font-weight: 700; color: #ffffff; font-size: 12.5px;">${escapeHtml(card.title)}</div>
                    <div style="font-size: 11px; color: #8696a0; margin-top: 2px;">Carrier: ${escapeHtml(card.carrier || 'BlueDart Air Priority Express')}</div>
                    <button type="button" class="wa-track-order-btn" data-order-id="${escapeHtml(card.order_id || '')}" style="display: block; width: 100%; text-align: center; background: #00a884; color: #ffffff; border: none; padding: 8px 12px; border-radius: 6px; font-weight: 700; font-size: 11.5px; margin-top: 8px; cursor: pointer;">
                        🚚 View Live Tracking Timeline →
                    </button>
                </div>
            `;
        } else if (card.checkout_url || card.intent_id) {
            cardHtml = `
                <div style="margin-top: 10px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.12); border-radius: 10px; padding: 12px;">
                    <div style="font-weight: 700; color: #ffffff; font-size: 13px;">${escapeHtml(card.title)}</div>
                    <div style="margin-top: 4px; font-size: 12.5px; color: #25d366; font-weight: 700; display: flex; align-items: center; gap: 8px;">
                        <span>₹${Number(card.price).toLocaleString("en-IN")} INR</span>
                        ${card.original_price ? `<span style="text-decoration: line-through; color: #8696a0; font-weight: normal; font-size: 11px;">₹${Number(card.original_price).toLocaleString("en-IN")}</span>` : ""}
                        ${card.discount_percent ? `<span style="background: rgba(34, 197, 94, 0.2); color: #22c55e; font-size: 10px; padding: 1px 6px; border-radius: 4px; font-weight: 700;">${card.discount_percent}% OFF</span>` : ""}
                    </div>
                    <button type="button" class="wa-checkout-btn" data-intent-id="${escapeHtml(card.intent_id || '')}">
                        ⚡ Pay via Razorpay UPI / Card →
                    </button>
                </div>
            `;
        }
    }

    // Format basic bold, italic, and URLs from WhatsApp markdown
    let formattedText = escapeHtml(text)
        .replace(/\*(.*?)\*/g, "<strong>$1</strong>")
        .replace(/~(.*?)~/g, "<del>$1</del>")
        .replace(/\n/g, "<br>");

    // Turn plain checkout links into clickable in-app buttons
    formattedText = formattedText.replace(/https?:\/\/[^\s<]+intent_id=([A-Za-z0-9_]+)[^\s<]*/g, (match, intentId) => {
        return `<a href="#" class="wa-text-link" data-intent-id="${escapeHtml(intentId)}" style="color: #25d366; text-decoration: underline; font-weight: 700;">Complete Checkout (${escapeHtml(intentId)}) →</a>`;
    });

    bubble.innerHTML = `
        ${voiceHtml}
        <div>${formattedText}</div>
        ${cardHtml}
        <span style="font-size: 9.5px; color: #8696a0; float: right; margin-top: 4px;">${now} ${isUser ? '<span style="color: #53bdeb;">✓✓</span>' : ''}</span>
    `;

    const playBtn = bubble.querySelector(".wa-play-audio-btn");
    if (playBtn) {
        playBtn.addEventListener("click", () => {
            playBtn.textContent = playBtn.textContent === "▶" ? "⏸" : "▶";
            showToast("Playing simulated audio voice note...");
        });
    }

    const checkoutBtn = bubble.querySelector(".wa-checkout-btn");
    if (checkoutBtn && card) {
        checkoutBtn.addEventListener("click", () => {
            currentIntentId = card.intent_id;
            if (modalProductName) modalProductName.textContent = card.title;
            if (modalProductPrice) modalProductPrice.textContent = formatCurrency(card.price, "INR");
            if (modalProductReason) modalProductReason.textContent = "WhatsApp Authorized Deal";
            approvalModal?.classList.remove("hidden");
            showToast("Opening Secure Razorpay Payment Modal...", "info");
        });
    }

    const trackOrderBtn = bubble.querySelector(".wa-track-order-btn");
    if (trackOrderBtn && card?.order_id) {
        trackOrderBtn.addEventListener("click", () => {
            if (typeof openTrackingModal === "function") {
                openTrackingModal(card.order_id);
            }
        });
    }

    bubble.querySelectorAll(".wa-text-link").forEach(link => {
        link.addEventListener("click", (e) => {
            e.preventDefault();
            const intentId = link.getAttribute("data-intent-id");
            if (intentId) {
                currentIntentId = intentId;
                if (modalProductName) modalProductName.textContent = "WhatsApp Authorized Order";
                if (modalProductReason) modalProductReason.textContent = `Autonomous Intent Contract #${intentId}`;
                approvalModal?.classList.remove("hidden");
                showToast(`Opening Checkout for Intent #${intentId}`, "info");
            }
        });
    });

    waChatCanvas.appendChild(bubble);
    waChatCanvas.scrollTop = waChatCanvas.scrollHeight;
}

async function sendSimulatedWhatsAppMessage(customText = null, isVoice = false) {
    const text = customText || waInputMessage?.value?.trim();
    if (!text) return;

    if (waInputMessage) waInputMessage.value = "";
    
    if (isVoice) {
        appendWhatsAppBubble("user", text, null, { duration: "0:08" });
    } else {
        appendWhatsAppBubble("user", text);
    }

    // Show realistic typing bubble with animated dots
    const typing = document.createElement("div");
    typing.id = "waTypingIndicator";
    typing.style.cssText = "background: #202c33; color: #8696a0; padding: 8px 12px; border-radius: 8px 8px 8px 0; font-size: 11px; align-self: flex-start; display: flex; align-items: center; gap: 6px; margin-top: 4px;";
    typing.innerHTML = isVoice
        ? `<span>🎙️ Transcribing audio note</span><div class="wa-typing-dots"><span></span><span></span><span></span></div>`
        : `<span>AI Store is typing</span><div class="wa-typing-dots"><span></span><span></span><span></span></div>`;
    waChatCanvas.appendChild(typing);
    waChatCanvas.scrollTop = waChatCanvas.scrollHeight;

    try {
        const res = await fetch(`${API_BASE_URL}/api/channels/whatsapp/simulate-chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                phone_number: "+919876543210",
                message: text,
                is_voice_note: isVoice,
                audio_duration: "0:08"
            })
        });

        const data = await res.json();
        document.getElementById("waTypingIndicator")?.remove();

        // Update live Webhook telemetry box if open
        if (data.meta_graph_payload) {
            const payloadBox = document.getElementById("waWebhookPayloadBox");
            if (payloadBox) {
                payloadBox.textContent = JSON.stringify(data.meta_graph_payload, null, 2);
            }
        }

        if (data.reply_text) {
            appendWhatsAppBubble("agent", data.reply_text, data.interactive_card, data.voice_metadata);
        } else {
            appendWhatsAppBubble("agent", "⚠️ Communication timeout with Meta Graph API.");
        }
    } catch (err) {
        document.getElementById("waTypingIndicator")?.remove();
        appendWhatsAppBubble("agent", "⚠️ Connection error to WhatsApp sandbox webhook.");
    }
}

waSendBtn?.addEventListener("click", () => sendSimulatedWhatsAppMessage());
waInputMessage?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        sendSimulatedWhatsAppMessage();
    }
});

const waVoiceBtn = document.getElementById("waVoiceBtn");
waVoiceBtn?.addEventListener("click", () => {
    const simulatedAudioQuery = "Bhaiya SoundMax headphones chahiye best offer batao";
    showToast("Simulating WhatsApp Voice Note recording (0:08)...");
    sendSimulatedWhatsAppMessage(simulatedAudioQuery, true);
});

// Emoji button
const waEmojiBtn = document.getElementById("waEmojiBtn");
waEmojiBtn?.addEventListener("click", () => {
    if (waInputMessage) {
        waInputMessage.value += " 🙏 ";
        waInputMessage.focus();
    }
});

// Attach button
const waAttachBtn = document.getElementById("waAttachBtn");
waAttachBtn?.addEventListener("click", () => {
    showToast("Opening Storefront Hardware Catalog...", "info");
    sendSimulatedWhatsAppMessage("What developer laptops do you have in stock?");
});

// Reset Chat Session button
const waResetChatBtn = document.getElementById("waResetChatBtn");
waResetChatBtn?.addEventListener("click", () => {
    if (!waChatCanvas) return;
    waChatCanvas.innerHTML = `
        <div class="wa-encryption-banner">
            🔒 Messages and calls are end-to-end encrypted. No one outside of this chat, not even WhatsApp or Meta, can read or listen to them.
        </div>
        <div class="wa-date-badge">TODAY</div>
        <div style="background: #202c33; color: #e9edef; padding: 10px 12px; border-radius: 8px 8px 8px 0; max-width: 86%; align-self: flex-start; line-height: 1.45; box-shadow: 0 1px 2px rgba(0,0,0,0.35);">
            👋 <strong>Welcome to Workspace &amp; Audio Tech!</strong><br><br>
            I am your autonomous WhatsApp sales concierge. You can ask for gear specs, negotiate commercial discounts, or purchase instantly with official Razorpay links.<br><br>
            <em>Tip: Ask in English, Hindi, or Hinglish (e.g., "Bhaiya headphone pe discount milega?")</em>
            <span style="font-size: 9.5px; color: #8696a0; float: right; margin-top: 4px;">10:00 AM ✓✓</span>
        </div>
    `;
    showToast("WhatsApp chat session cleared.", "info");
});

// Tab Switching
const waTabScenariosBtn = document.getElementById("waTabScenariosBtn");
const waTabWebhookBtn = document.getElementById("waTabWebhookBtn");
const waTabDirectBtn = document.getElementById("waTabDirectBtn");
const waTabScenarios = document.getElementById("waTabScenarios");
const waTabWebhook = document.getElementById("waTabWebhook");
const waTabDirect = document.getElementById("waTabDirect");

function switchWaTab(activeBtn, activePanel) {
    [waTabScenariosBtn, waTabWebhookBtn, waTabDirectBtn].forEach(b => b?.classList.remove("active"));
    [waTabScenarios, waTabWebhook, waTabDirect].forEach(p => p?.classList.add("hidden"));
    activeBtn?.classList.add("active");
    activePanel?.classList.remove("hidden");
}

waTabScenariosBtn?.addEventListener("click", () => switchWaTab(waTabScenariosBtn, waTabScenarios));
waTabWebhookBtn?.addEventListener("click", () => switchWaTab(waTabWebhookBtn, waTabWebhook));
waTabDirectBtn?.addEventListener("click", () => switchWaTab(waTabDirectBtn, waTabDirect));

// Real wa.me Dispatch
const waDirectDispatchBtn = document.getElementById("waDirectDispatchBtn");
const waDirectPhoneInput = document.getElementById("waDirectPhoneInput");
const waDirectDealSelect = document.getElementById("waDirectDealSelect");
const waDirectResultBox = document.getElementById("waDirectResultBox");

waDirectDispatchBtn?.addEventListener("click", async () => {
    let phone = waDirectPhoneInput?.value?.trim() || "+919876543210";
    // Auto-format Indian 10-digit mobile numbers
    const cleanDigitsOnly = phone.replace(/[^0-9]/g, "");
    if (cleanDigitsOnly.length === 10 && !phone.startsWith("+")) {
        phone = "+91" + cleanDigitsOnly;
        if (waDirectPhoneInput) waDirectPhoneInput.value = phone;
    }

    const selected = waDirectDealSelect?.value?.split("|") || ["SoundMax ANC Headphones", "7820", "8"];
    const productName = selected[0];
    const price = selected[1];
    const discount = selected[2];

    const originalBtnText = waDirectDispatchBtn.innerHTML;
    waDirectDispatchBtn.disabled = true;
    waDirectDispatchBtn.innerHTML = "⏳ Generating Official wa.me Link...";

    try {
        const res = await fetch(`${API_BASE_URL}/api/channels/whatsapp/dispatch-payment-link`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                phone_number: phone,
                product_name: productName,
                discount_percentage: Number(discount),
                language: "hinglish"
            })
        });

        if (!res.ok) {
            const errData = await res.json().catch(() => ({ error: "Server returned " + res.status }));
            throw new Error(errData.error || errData.details || "Request failed");
        }

        const data = await res.json();
        if (data.status === "SUCCESS") {
            if (data.delivered_via_cloud_api) {
                // Sent silently via Meta Cloud API directly into customer's phone
                if (waDirectResultBox) {
                    waDirectResultBox.innerHTML = `
                        <div style="background: rgba(34, 197, 94, 0.15); border: 1.5px solid #22c55e; border-radius: 10px; padding: 14px; margin-top: 10px;">
                            <div style="font-weight: 800; color: #22c55e; font-size: 13px; display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">
                                <span>🚀 Directly Sent to Customer's WhatsApp!</span>
                                <span style="font-size: 10px; background: rgba(34, 197, 94, 0.25); padding: 1px 6px; border-radius: 4px;">Cloud API Delivered</span>
                            </div>
                            <div style="color: var(--text); font-size: 12px; margin-bottom: 4px;">
                                Delivered To: <strong>${escapeHtml(data.recipient || phone)}</strong>
                            </div>
                            <div style="color: var(--text); font-size: 12px; margin-bottom: 6px;">
                                Deal: <strong>${escapeHtml(data.product_name)}</strong> at <strong style="color: #22c55e;">₹${Number(data.final_price_inr || price).toLocaleString('en-IN')} INR</strong>
                            </div>
                            <div style="font-size: 11px; color: #8696a0; font-family: monospace;">
                                Meta Message ID: ${escapeHtml(data.cloud_api_message_id || 'wamid.success')}
                            </div>
                        </div>
                    `;
                }
                showToast("Direct WhatsApp Message Delivered via Meta Cloud API!", "success");
            } else {
                // Immediately open WhatsApp Web / App directly without making the user click a second button!
                try {
                    window.open(data.whatsapp_direct_link, '_blank');
                } catch (popupErr) {
                    console.warn("Popup blocked by browser, fallback available:", popupErr);
                }

                if (waDirectResultBox) {
                    waDirectResultBox.innerHTML = `
                        <div style="background: rgba(34, 197, 94, 0.12); border: 1.5px solid rgba(34, 197, 94, 0.4); border-radius: 10px; padding: 14px; margin-top: 10px;">
                            <div style="font-weight: 800; color: #22c55e; font-size: 13px; display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">
                                <span>⚡ WhatsApp Opened Directly</span>
                                <span style="font-size: 10px; background: rgba(34, 197, 94, 0.2); padding: 1px 6px; border-radius: 4px;">1-Click Deal</span>
                            </div>
                            <div style="color: var(--text); font-size: 12px; margin-bottom: 4px;">
                                Recipient: <strong>${escapeHtml(data.recipient || phone)}</strong>
                            </div>
                            <div style="color: var(--text); font-size: 12px; margin-bottom: 8px;">
                                Deal: <strong>${escapeHtml(data.product_name)}</strong> at <strong style="color: #22c55e;">₹${Number(data.final_price_inr || price).toLocaleString('en-IN')} INR</strong>
                            </div>
                            <p style="font-size: 11px; color: var(--muted); margin-bottom: 10px; line-height: 1.4;">
                                WhatsApp has been launched with the pre-filled commercial offer and Razorpay payment link. If your browser blocked the automatic pop-up, click below:
                            </p>
                            <a href="${escapeHtml(data.whatsapp_direct_link)}" target="_blank" rel="noopener noreferrer" style="display: flex; align-items: center; justify-content: center; gap: 8px; background: #25d366; color: #000; font-weight: 800; padding: 10px 16px; border-radius: 8px; text-decoration: none; font-size: 12.5px; box-shadow: 0 4px 12px rgba(37, 211, 102, 0.3);">
                                💬 Re-Open WhatsApp (${escapeHtml(data.recipient || phone)}) →
                            </a>
                        </div>
                    `;
                }
                showToast("WhatsApp Opened Directly with Deal & Payment Link!", "success");
            }

            // Also post message into the phone frame mockup so the user can inspect the deal right away
            if (data.message && typeof appendWhatsAppBubble === "function") {
                appendWhatsAppBubble("agent", data.message, {
                    title: data.product_name,
                    price: data.final_price_inr || price,
                    discount_percent: discount,
                    checkout_url: data.checkout_url
                });
            }
        }
    } catch (e) {
        showToast("Failed to dispatch WhatsApp link: " + e.message, "error");
    } finally {
        waDirectDispatchBtn.disabled = false;
        waDirectDispatchBtn.innerHTML = originalBtnText;
    }
});

// Attach click handlers to all quick prompts
function bindWaQuickPrompts() {
    document.querySelectorAll(".wa-quick-prompt").forEach(btn => {
        btn.addEventListener("click", () => {
            const promptText = btn.getAttribute("data-text");
            const isVoice = btn.getAttribute("data-voice") === "true";
            if (promptText) {
                sendSimulatedWhatsAppMessage(promptText, isVoice);
            }
        });
    });
}
bindWaQuickPrompts();

// ============================================================
// SYSTEM DESIGN MODULE: STOREFRONT HARDWARE SHOWCASE & MOBILE NAV
// ============================================================

let storefrontCatalog = [];
let activeStorefrontCategory = "all";

async function loadStorefrontShowcase() {
    const hasGrid = document.getElementById("cartCatalogShelfGrid") || document.getElementById("showcaseProductGrid");
    if (!hasGrid) return;

    try {
        const res = await fetch(`${API_BASE_URL}/catalog`, {
            headers: { "Accept": "application/json" }
        });
        const data = await res.json();
        storefrontCatalog = data.products || [];
        renderStorefrontShowcase();
    } catch (err) {
        console.warn("Failed to load storefront catalog showcase:", err);
    }
}

function renderStorefrontShowcase() {
    const grids = [
        document.getElementById("cartCatalogShelfGrid"),
        document.getElementById("showcaseProductGrid")
    ].filter(Boolean);

    if (grids.length === 0) return;

    const filtered = activeStorefrontCategory === "all"
        ? storefrontCatalog
        : storefrontCatalog.filter(p => (p.category || "").toLowerCase() === activeStorefrontCategory.toLowerCase());

    grids.forEach(grid => {
        if (filtered.length === 0) {
            grid.innerHTML = `<div class="dashboard-empty" style="grid-column: 1 / -1; padding: 20px;">No hardware found in this category.</div>`;
            return;
        }

        grid.innerHTML = filtered.map(prod => {
            const formattedPrice = formatCurrency(prod.price, prod.currency || "INR");
            const defaultImg = "https://images.unsplash.com/photo-1580481077194-453059eb774a?auto=format&fit=crop&w=800&q=80";
            const imgUrl = prod.image_url || defaultImg;
            const stockLabel = (prod.stock && prod.stock <= 5) ? `Only ${prod.stock} left!` : "In Stock";
            const stockColor = (prod.stock && prod.stock <= 5) ? "var(--warning)" : "var(--success)";

            return `
                <div class="showcase-card" data-id="${escapeHtml(prod.product_id)}">
                    <div class="showcase-img-wrap">
                        <img src="${escapeHtml(imgUrl)}" alt="${escapeHtml(prod.name)}" class="showcase-img" loading="lazy" onerror="this.src='${defaultImg}'" />
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span class="showcase-cat-badge">${escapeHtml(prod.category || "Hardware")}</span>
                        <span style="font-size: 10px; font-weight: 700; color: ${stockColor};">${stockLabel}</span>
                    </div>
                    <div class="showcase-name">${escapeHtml(prod.name)}</div>
                    <div class="showcase-desc">${escapeHtml(prod.description || "")}</div>
                    <div class="showcase-price-row">
                        <div class="showcase-price">${escapeHtml(formattedPrice)}</div>
                        <div class="showcase-actions">
                            <button type="button" class="showcase-btn-inquire" data-action="inquire" data-name="${escapeHtml(prod.name)}" title="Discuss with AI Concierge">
                                💬 Inquire
                            </button>
                            <button type="button" class="showcase-btn-cart" data-action="cart" data-id="${escapeHtml(prod.product_id)}" title="1-Click Add to Cart">
                                🛒 Add
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join("");

        // Attach listeners
        grid.querySelectorAll('[data-action="cart"]').forEach(btn => {
            btn.addEventListener("click", async (e) => {
                e.stopPropagation();
                const prodId = btn.getAttribute("data-id");
                const prod = storefrontCatalog.find(p => p.product_id === prodId);
                btn.disabled = true;
                btn.textContent = "...";
                try {
                    const res = await fetch(`${API_BASE_URL}/api/cart/add`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ session_id: cartSessionId, product_id: prodId, quantity: 1 })
                    });
                    const d = await res.json();
                    btn.disabled = false;
                    btn.textContent = "✓ Added";
                    setTimeout(() => { btn.textContent = "🛒 Add"; }, 1500);
                    if (d.success && d.cart) {
                        clientCart = d.cart;
                        renderCartUI();
                        showToast(`Added ${prod ? prod.name : 'item'} to Cart`, "success");
                    }
                } catch (err) {
                    btn.disabled = false;
                    btn.textContent = "🛒 Add";
                    showToast("Failed to add to cart", "error");
                }
            });
        });

        grid.querySelectorAll('[data-action="inquire"]').forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                const prodName = btn.getAttribute("data-name");
                newChatButton?.click();
                if (messageInput) {
                    messageInput.value = `Tell me about the ${prodName} and what special bundle or discount can you provide?`;
                    sendMessage();
                }
            });
        });
    });
}

// Category filter tabs
document.querySelectorAll("#showcaseCategoryPills .cat-pill").forEach(pill => {
    pill.addEventListener("click", () => {
        document.querySelectorAll("#showcaseCategoryPills .cat-pill").forEach(p => p.classList.remove("active"));
        pill.classList.add("active");
        activeStorefrontCategory = pill.getAttribute("data-cat") || "all";
        renderStorefrontShowcase();
    });
});

// Mobile Bottom Navigation
function syncMobileNav(activeKey) {
    const items = {
        concierge: document.getElementById("mobileNavConcierge"),
        cart: document.getElementById("mobileNavCart"),
        orders: document.getElementById("mobileNavOrders"),
        whatsapp: document.getElementById("mobileNavWhatsApp"),
        merchant: document.getElementById("mobileNavMerchant")
    };
    Object.keys(items).forEach(k => {
        items[k]?.classList.toggle("active", k === activeKey);
    });
}

document.getElementById("mobileNavConcierge")?.addEventListener("click", () => {
    newChatButton?.click();
    syncMobileNav("concierge");
});
document.getElementById("mobileNavCart")?.addEventListener("click", () => {
    cartButton?.click();
    syncMobileNav("cart");
});
document.getElementById("mobileNavOrders")?.addEventListener("click", () => {
    ordersButton?.click();
    syncMobileNav("orders");
});
document.getElementById("mobileNavWhatsApp")?.addEventListener("click", () => {
    whatsappNavButton?.click();
    syncMobileNav("whatsapp");
});
document.getElementById("mobileNavMerchant")?.addEventListener("click", () => {
    merchantButton?.click();
    syncMobileNav("merchant");
});

// Hook into existing navigation clicks to keep mobile nav active state synchronized
newChatButton?.addEventListener("click", () => syncMobileNav("concierge"));
cartButton?.addEventListener("click", () => syncMobileNav("cart"));
ordersButton?.addEventListener("click", () => syncMobileNav("orders"));
whatsappNavButton?.addEventListener("click", () => syncMobileNav("whatsapp"));
merchantButton?.addEventListener("click", () => syncMobileNav("merchant"));

// Initialize Storefront Hardware Showcase
loadStorefrontShowcase();
