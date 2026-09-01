// ============================================================
// AI COMMERCE ENGINE
// Frontend Application
// ============================================================

// Backend URL
const API_BASE_URL = "http://127.0.0.1:8000";


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


        // ====================================================
        // UPDATE PIPELINE
        // ====================================================

        activatePipeline(pipelinePolicy);


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
// OPEN APPROVAL MODAL
// ============================================================

function openApprovalModal(product) {

    if (!product) {
        return;
    }


    currentProduct = product;


    modalProductName.textContent =
        product.name;


    modalProductReason.textContent =
        product.reason;


    modalProductPrice.textContent =
        formatCurrency(
            product.price,
            product.currency
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

    actions.appendChild(checkoutButton);
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
    const keyId =
        payment.key_id ||
        window.RAZORPAY_KEY_ID;

    if (!keyId) {

        addMessage(
            "agent",
            "✓ Razorpay order is ready. Add the public Razorpay Key ID to enable Checkout."
        );

        return;
    }

    try {

        await loadRazorpayScript();

        const options = {

            key: keyId,

            amount:
                Number(payment.amount || 0) * 100,

            currency:
                payment.currency || "INR",

            name:
                "Commerce AI",

            description:
                currentProduct?.name ||
                "AI Commerce purchase",

            order_id:
                payment.order_id,

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
                                    razorpay_payment_id: response.razorpay_payment_id,
                                    razorpay_order_id: response.razorpay_order_id,
                                    razorpay_signature: response.razorpay_signature
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
                    "Razorpay reported a payment failure.",
                    "warning"
                );

                addMessage(
                    "agent",
                    "⚠️ Razorpay reported that the payment could not be completed."
                );
            }
        );

        razorpay.open();

    } catch (error) {

        console.error(error);

        addMessage(
            "agent",
            `⚠️ ${error.message}`
        );
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
            event.status === "approved"
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
            event.status || "";

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

        payment_created:
            "Razorpay order created",

        payment_failed:
            "Payment creation failed",

        execution_blocked:
            "Execution blocked"
    };

    return labels[event] || event;
}


// ============================================================
// NEW CHAT
// ============================================================

function startNewChat() {

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

ordersButton.addEventListener(
    "click",
    () => {

        if (!lastPayment) {

            addMessage(
                "agent",
                "No order has been created in this session yet."
            );

            return;
        }

        const orderId =
            lastPayment.order_id || "—";

        const amount =
            formatCurrency(
                lastPayment.amount,
                lastPayment.currency
            );

        addMessage(
            "agent",
            `Latest order: ${orderId} • ${amount} • ${lastPayment.status || "created"}`
        );

        if (lastAuditTrail.length) {
            renderAuditTrail(lastAuditTrail);
        }
    }
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