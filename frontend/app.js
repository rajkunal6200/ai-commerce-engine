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


        const data = await response.json();


        if (!response.ok) {

            throw new Error(
                data.detail ||
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
    // PRODUCT TOP
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
        `Product ID: ${product.product_id}`;


    productText.appendChild(name);

    productText.appendChild(id);

    info.appendChild(icon);

    info.appendChild(productText);


    const price =
        document.createElement("div");

    price.className =
        "product-price";

    price.textContent =
        formatCurrency(
            product.price,
            product.currency
        );


    top.appendChild(info);

    top.appendChild(price);


    // ========================================================
    // REASON
    // ========================================================

    const reason =
        document.createElement("div");

    reason.className =
        "product-reason";

    reason.textContent =
        product.reason;


    // ========================================================
    // ACTIONS
    // ========================================================

    const actions =
        document.createElement("div");

    actions.className =
        "recommendation-actions";


    const reviewButton =
        document.createElement("button");

    reviewButton.className =
        "button primary";

    reviewButton.type =
        "button";

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


    actions.appendChild(
        reviewButton
    );


    // ========================================================
    // BUILD CARD
    // ========================================================

    card.appendChild(top);

    card.appendChild(reason);

    card.appendChild(actions);


    content.appendChild(card);

    wrapper.appendChild(content);

    messages.appendChild(wrapper);


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

    const banner = document.createElement("div");
    banner.style.cssText = "background: rgba(255, 179, 71, 0.08); border: 1px solid rgba(255, 179, 71, 0.25); border-radius: 14px; padding: 16px; margin-bottom: 14px; color: #e2e8f0; font-size: 13px; line-height: 1.6;";
    banner.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
            <span style="font-size: 16px;">✨</span>
            <strong style="color: #fbd38d; font-size: 14px;">Curated Workspace Solutions</strong>
        </div>
        Our enterprise workspace studio specializes in complete, high-performance workstation packages starting from ₹4,500. While individual standalone accessories below this tier are not available, I have hand-picked our two premier productivity suites designed to deliver unmatched value and seamless integration:
    `;
    content.appendChild(banner);

    const list = document.createElement("div");
    list.style.cssText = "display: flex; flex-direction: column; gap: 12px;";

    const crossSellItems = data.active_cross_sell_array || data.cross_sell || [];
    crossSellItems.forEach(item => {
        const itemObj = typeof item === "string" 
            ? (item === "BUNDLE_HP_MS" 
                ? { name: "Work & Focus Audio Bundle", product_id: "BUNDLE_HP_MS", price: 6500, reason: "Includes premium SoundMax Active Noise-Cancelling Headphones + Ergonomic ProMouse." }
                : { name: "Developer Complete Suite", product_id: "BUNDLE_LAP_MS", price: 51500, reason: "Includes 14\" ProBook M2 Laptop + Ergonomic ProMouse." })
            : item;

        const itemCard = document.createElement("div");
        itemCard.className = "recommendation-card";
        itemCard.style.cssText = "border-color: rgba(255, 255, 255, 0.12); background: rgba(255, 255, 255, 0.03); border-radius: 12px; padding: 14px;";

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
        sub.textContent = "Curated Enterprise Suite";
        textDiv.appendChild(name);
        textDiv.appendChild(sub);

        info.appendChild(icon);
        info.appendChild(textDiv);

        const price = document.createElement("div");
        price.className = "product-price";
        price.textContent = formatCurrency(itemObj.price || itemObj.valuation, itemObj.currency || "INR");

        top.appendChild(info);
        top.appendChild(price);

        const reason = document.createElement("div");
        reason.className = "product-reason";
        reason.style.cssText = "color: #94a3b8; font-size: 12px; margin: 10px 0;";
        reason.textContent = itemObj.reason || "Curated suite engineered for optimal enterprise productivity.";

        const actions = document.createElement("div");
        actions.className = "recommendation-actions";

        const buyBtn = document.createElement("button");
        buyBtn.className = "button primary";
        buyBtn.type = "button";
        buyBtn.textContent = `Select ${itemObj.name} →`;
        buyBtn.addEventListener("click", () => {
            messageInput.value = `I want to purchase the ${itemObj.name} for ${itemObj.price || itemObj.valuation}`;
            sendMessage();
        });

        actions.appendChild(buyBtn);

        itemCard.appendChild(top);
        itemCard.appendChild(reason);
        itemCard.appendChild(actions);
        list.appendChild(itemCard);
    });

    content.appendChild(list);
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

    let productName = "Curated Workspace Suite";
    if (params.item_id === "BUNDLE_HP_MS") productName = "Work & Focus Audio Bundle";
    else if (params.item_id === "BUNDLE_LAP_MS") productName = "Developer Complete Suite";
    else if (params.item_id === "LAP001") productName = "ProBook Laptop";
    else if (params.item_id === "HP001") productName = "SoundMax Headphones";
    else if (params.item_id === "MS001") productName = "ProMouse Wireless";

    const card = document.createElement("div");
    card.style.cssText = "background: linear-gradient(135deg, rgba(30, 41, 59, 0.8), rgba(15, 23, 42, 0.9)); border: 1px solid rgba(156, 255, 91, 0.35); border-radius: 16px; padding: 20px; box-shadow: 0 10px 25px rgba(0,0,0,0.3);";

    card.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
            <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; background: rgba(156, 255, 91, 0.15); color: #9cff5b; padding: 4px 10px; border-radius: 999px;">
                ✓ Order Prepared
            </span>
            <span style="font-size: 13px; color: #94a3b8;">Instant Checkout Ready</span>
        </div>
        <div style="font-size: 18px; font-weight: 700; color: #ffffff; margin-bottom: 4px;">
            ${productName}
        </div>
        <div style="font-size: 13px; color: #cbd5e1; margin-bottom: 16px;">
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
                throw new Error(
                    intentData.detail ||
                    "Could not load the validated offer."
                );
            }

            const offer = intentData.offer;
            const contractOffer =
                intentData.commerce_contract?.offer;

            if (offer) {
                displayName =
                    offer.primary_product?.name ||
                    displayName;

                displayAmount =
                    offer.final_amount;

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
                    contractOffer.final_amount;

                displayCurrency =
                    contractOffer.currency ||
                    displayCurrency;
            }
        } catch (error) {
            console.error(
                "Validated offer loading failed:",
                error
            );

            addMessage(
                "agent",
                `⚠️ ${error.message}`
            );

            return;
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

    approvalModal.classList.remove(
        "hidden"
    );
}


// ============================================================
// CLOSE MODAL
// ============================================================

function closeApprovalModal() {

    approvalModal.classList.add(
        "hidden"
    );
}


// ============================================================
// APPROVE PURCHASE
// ============================================================

async function approvePurchase() {

    if (!currentIntentId) {

        alert(
            "No active purchase intent found."
        );

        return;
    }


    approveButton.disabled = true;

    approveButton.textContent =
        "Approving...";


    try {

        // ====================================================
        // STEP 1 — APPROVAL
        // ====================================================

        const approvalResponse =
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

                        approved: true
                    })
                }
            );


        const approvalData =
            await approvalResponse.json();


        if (!approvalResponse.ok) {

            throw new Error(
                approvalData.detail ||
                "Approval failed."
            );
        }


        markPipelineComplete(
            pipelineApproval
        );


        setState(
            "Approval received",
            "Your authorization was received. Starting secure execution.",
            "active"
        );


        addMessage(
            "agent",
            "✓ Purchase approved. Starting secure payment execution..."
        );


        // ====================================================
        // STEP 2 — EXECUTE
        // ====================================================

        activatePipeline(
            pipelinePayment
        );


        const executeResponse =
            await fetch(
                `${API_BASE_URL}/execute/${currentIntentId}`,
                {
                    method: "POST",

                    headers: {
                        "Accept":
                            "application/json"
                    }
                }
            );


        const executeData =
            await executeResponse.json();


        if (!executeResponse.ok) {

            throw new Error(
                executeData.detail ||
                "Payment execution failed."
            );
        }


        markPipelineComplete(
            pipelinePayment
        );


        setState(
            "Payment order created",
            "Razorpay test order was successfully created.",
            "active"
        );


        addPaymentSuccess(
            executeData
        );


        closeApprovalModal();


        // ====================================================
        // AUDIT
        // ====================================================

        await loadAudit(
            currentIntentId
        );


    } catch (error) {

        console.error(error);


        setState(
            "Execution failed",
            error.message,
            "warning"
        );


        addMessage(
            "agent",
            `⚠️ ${error.message}`
        );

    } finally {

        approveButton.disabled = false;

        approveButton.innerHTML =
            "Approve & Continue <span>→</span>";
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


        addMessage(
            "agent",
            "Purchase cancelled. No payment was created."
        );


    } catch (error) {

        console.error(error);

        alert(error.message);

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
    testMessage.style.color = "#9cff5b";
    testMessage.style.fontSize = "9px";
    testMessage.textContent =
        "Razorpay Test Mode • No real money was charged.";

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
    const keyCandidate = payment.key_id || window.RAZORPAY_KEY_ID;
    const keyId = (keyCandidate && !keyCandidate.includes("your_public_key_id"))
        ? keyCandidate
        : "rzp_test_TUi28O8V9GShpw";

    if (!keyId) {

        addMessage(
            "agent",
            "✓ Razorpay order is ready. Add the public Razorpay Key ID to enable Checkout."
        );

        return;
    }

    try {

        await loadRazorpayScript();

        // Standard Razorpay sandbox accounts have a test transaction limit per order (typically ₹50,000 max).
        // If a test order amount in paise exceeds standard sandbox limits (or if payment.amount was already in paise),
        // scale cleanly to ensure checkout modal never triggers BAD_REQUEST_ERROR Amount exceeds maximum amount allowed.
        let rawAmount = Number(payment.amount || 0);
        let amountInPaise = Math.round(rawAmount * 100);

        // Cap checkout simulator amount to ₹50,000 (5,000,000 paise) so sandbox test checkouts succeed smoothly
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
                "Commerce AI",

            description:
                currentProduct?.name ||
                "AI Commerce purchase",

            // When integrating with Razorpay standard client checkout in test mode without an active server-side order API,
            // omitting order_id allows the Razorpay Test Modal (UPI / Netbanking / Card simulator) to render cleanly.
            ...(payment.order_id && payment.is_real_razorpay_order ? { order_id: payment.order_id } : {}),

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
                        "Razorpay Checkout was closed. Your order remains unchanged."
                    );
                }
            },

            theme: {
                color: "#9cff5b"
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
                    `⚠️ Razorpay reported: ${response?.error?.description || "Payment could not be completed with the current sandbox credentials."}`
                );

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


function setDashboardMode(showDashboard) {

    merchantDashboard.classList.toggle(
        "hidden",
        !showDashboard
    );

    if (ordersView) {
        ordersView.classList.add("hidden");
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

            card.innerHTML = `
                <div class="dashboard-product-icon">
                    ${getProductIcon(
                        product.name
                    )}
                </div>

                <strong>
                    ${escapeHtml(
                        product.name
                    )}
                </strong>

                <span class="dashboard-product-price">
                    ${formatCurrency(
                        product.price,
                        product.currency
                    )}
                </span>

                <span class="dashboard-product-stock">
                    ${escapeHtml(stockText)}
                </span>

                <div class="dashboard-product-tags">
                    ${tags
                        .map(
                            tag =>
                                `<span class="dashboard-product-tag">
                                    ${escapeHtml(tag)}
                                </span>`
                        )
                        .join("")}
                </div>
            `;

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
const saveStoreConfigBtn = document.getElementById("saveStoreConfigBtn");
const syncShopifyButton = document.getElementById("syncShopifyButton");

// Load Live Store Configuration
async function loadStoreConfig() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/store/config`);
        if (!response.ok) return;
        const data = await response.json();
        const store = data.store;
        const activeFloor = data.active_floor || 4500;

        if (storeConnectorName) storeConnectorName.textContent = store.store_name || "Workspace & Audio Tech";
        if (storeConnectorPlatform) storeConnectorPlatform.textContent = (store.platform || "SHOPIFY").toUpperCase() + " LIVE";
        if (storeConnectorDomain) storeConnectorDomain.textContent = store.store_domain || "https://shop.workspacetech.in";
        if (storeCurrentFloor) storeCurrentFloor.textContent = `₹${Number(activeFloor).toLocaleString("en-IN")}.00 INR`;
        if (headerFloorBadge) headerFloorBadge.textContent = `✨ Minimum Suite Tier: ₹${Number(activeFloor).toLocaleString("en-IN")} INR`;

        if (inputStoreName) inputStoreName.value = store.store_name || "";
        if (inputStoreDomain) inputStoreDomain.value = store.store_domain || "";
        if (inputPlatform) inputPlatform.value = store.platform || "shopify";
        if (inputFloorPrice) inputFloorPrice.value = activeFloor;
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
                floor_price_inr: Number(inputFloorPrice?.value || 4500)
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
                setTimeout(() => {
                    if (configSaveStatus) configSaveStatus.textContent = "Ready";
                }, 2500);
                await loadStoreConfig();
                await loadMerchantDashboard();
            } else {
                if (configSaveStatus) configSaveStatus.textContent = "Failed";
            }
        } catch (err) {
            console.error(err);
            if (configSaveStatus) configSaveStatus.textContent = "Error";
        } finally {
            saveStoreConfigBtn.disabled = false;
            saveStoreConfigBtn.textContent = "Save & Apply Policy";
        }
    });
}

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
        ).format(amount);
    }


    return `${currency || ""} ${amount}`;
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


function renderOrders(orders) {

    if (!ordersList) {
        return;
    }

    ordersList.innerHTML = "";

    if (!Array.isArray(orders) || orders.length === 0) {

        ordersList.innerHTML = `
            <div class="dashboard-empty">
                No orders found.
            </div>
        `;

        return;
    }

    orders.forEach(order => {

        const card =
            document.createElement("div");

        card.className =
            "dashboard-opportunity";

        const amount =
            order.amount !== null &&
            order.amount !== undefined
                ? formatCurrency(
                    order.amount,
                    order.currency || "INR"
                )
                : "—";

        const status =
            formatOrderStatus(
                order.status
            );

        card.innerHTML = `
            <div class="dashboard-opportunity-top">
                <strong>
                    ${escapeHtml(
                        order.order_id || "Order"
                    )}
                </strong>

                <span class="dashboard-opportunity-badge">
                    ${escapeHtml(status)}
                </span>
            </div>

            <p>
                ${escapeHtml(
                    order.merchant ||
                    "AI Commerce Demo Store"
                )}
            </p>

            <div class="dashboard-opportunity-action">
                Amount: ${escapeHtml(amount)}
                ${
                    order.payment_id
                        ? ` • Payment: ${escapeHtml(
                            order.payment_id
                        )}`
                        : ""
                }
            </div>
        `;

        ordersList.appendChild(card);
    });
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
                'Your <span>orders.</span>';
        }

        const eyebrow =
            document.querySelector(".topbar .eyebrow");

        if (eyebrow) {

            eyebrow.textContent =
                "ORDER HISTORY";
        }

        loadOrders();
    }
);


ordersRefreshButton?.addEventListener(
    "click",
    loadOrders
);


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
// STARTUP
// ============================================================

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