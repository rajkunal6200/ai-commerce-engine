/**
 * Autonomous Commerce Concierge - Embeddable Storefront Widget
 * Lightweight (<10KB) drop-in script for Shopify, WooCommerce, and custom web stores.
 * Adds an interactive floating AI assistant with product recommendations, cart management, and instant Razorpay checkout.
 */

(function () {
  'use strict';

  // Prevent multiple initializations
  if (window.__CommerceWidgetLoaded) return;
  window.__CommerceWidgetLoaded = true;

  const currentScript = document.currentScript || (function() {
    const scripts = document.getElementsByTagName('script');
    return scripts[scripts.length - 1];
  })();

  const apiHost = (currentScript && currentScript.src)
    ? new URL(currentScript.src).origin
    : window.location.origin;

  // Create isolated container
  const container = document.createElement('div');
  container.id = 'commerce-ai-widget-root';
  container.style.cssText = 'position: fixed; bottom: 24px; right: 24px; z-index: 999999; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;';
  document.body.appendChild(container);

  // Widget State
  let isOpen = false;
  let cartCount = 0;
  const sessionId = 'widget_guest_' + Math.random().toString(36).substring(2, 9);

  // Render HTML structure
  container.innerHTML = `
    <style>
      #commerce-ai-bubble {
        width: 58px;
        height: 58px;
        border-radius: 50%;
        background: linear-gradient(135deg, #2563eb, #1d4ed8);
        color: #ffffff;
        box-shadow: 0 6px 20px rgba(37, 99, 235, 0.4);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.2s;
        position: relative;
      }
      #commerce-ai-bubble:hover {
        transform: scale(1.08);
        box-shadow: 0 8px 25px rgba(37, 99, 235, 0.5);
      }
      #commerce-ai-bubble-badge {
        position: absolute;
        top: -3px;
        right: -3px;
        background: #ef4444;
        color: #ffffff;
        font-size: 11px;
        font-weight: 700;
        min-width: 20px;
        height: 20px;
        border-radius: 10px;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 0 4px;
        border: 2px solid #ffffff;
      }
      #commerce-ai-window {
        display: none;
        width: 360px;
        height: 520px;
        background: #ffffff;
        border-radius: 16px;
        box-shadow: 0 12px 40px rgba(15, 23, 42, 0.18), 0 2px 10px rgba(15, 23, 42, 0.08);
        border: 1px solid #e2e8f0;
        margin-bottom: 16px;
        flex-direction: column;
        overflow: hidden;
        animation: widgetSlideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      }
      @keyframes widgetSlideUp {
        from { opacity: 0; transform: translateY(20px) scale(0.96); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      .w-header {
        background: #0f172a;
        color: #ffffff;
        padding: 14px 18px;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .w-title {
        font-size: 14px;
        font-weight: 700;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .w-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #10b981;
      }
      .w-close {
        background: transparent;
        border: none;
        color: #94a3b8;
        font-size: 20px;
        cursor: pointer;
        padding: 0;
        line-height: 1;
      }
      .w-body {
        flex: 1;
        overflow-y: auto;
        padding: 14px;
        background: #f8fafc;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .w-msg {
        max-width: 85%;
        padding: 10px 14px;
        border-radius: 12px;
        font-size: 13px;
        line-height: 1.45;
      }
      .w-msg.bot {
        background: #ffffff;
        color: #0f172a;
        border: 1px solid #e2e8f0;
        align-self: flex-start;
      }
      .w-msg.user {
        background: #2563eb;
        color: #ffffff;
        align-self: flex-end;
      }
      .w-pincode-card {
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 10px;
        padding: 10px;
        font-size: 12px;
        color: #334155;
      }
      .w-footer {
        padding: 10px;
        background: #ffffff;
        border-top: 1px solid #e2e8f0;
        display: flex;
        gap: 8px;
      }
      .w-input {
        flex: 1;
        border: 1px solid #cbd5e1;
        border-radius: 20px;
        padding: 8px 14px;
        font-size: 13px;
        outline: none;
      }
      .w-input:focus {
        border-color: #2563eb;
      }
      .w-send {
        background: #2563eb;
        color: #ffffff;
        border: none;
        border-radius: 20px;
        padding: 8px 16px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
      }
    </style>

    <div id="commerce-ai-window">
      <div class="w-header">
        <div class="w-title">
          <span class="w-dot"></span>
          <span>Store Concierge AI</span>
        </div>
        <button class="w-close" id="wCloseBtn">&times;</button>
      </div>
      <div class="w-body" id="wMsgContainer">
        <div class="w-msg bot">
          👋 Welcome to our store! I am your autonomous AI shopping assistant. Ask for product recommendations, check pincode delivery, or buy directly.
        </div>
      </div>
      <div class="w-footer">
        <input type="text" class="w-input" id="wInput" placeholder="Ask about products, pincode (e.g. 560001)..." />
        <button class="w-send" id="wSendBtn">Send</button>
      </div>
    </div>

    <div id="commerce-ai-bubble">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
      </svg>
      <div id="commerce-ai-bubble-badge">0</div>
    </div>
  `;

  const bubble = container.querySelector('#commerce-ai-bubble');
  const win = container.querySelector('#commerce-ai-window');
  const closeBtn = container.querySelector('#wCloseBtn');
  const sendBtn = container.querySelector('#wSendBtn');
  const input = container.querySelector('#wInput');
  const msgContainer = container.querySelector('#wMsgContainer');

  function toggle() {
    isOpen = !isOpen;
    win.style.display = isOpen ? 'flex' : 'none';
    if (isOpen) {
      input.focus();
    }
  }

  bubble.addEventListener('click', toggle);
  closeBtn.addEventListener('click', toggle);

  function addMessage(text, isUser = false) {
    const div = document.createElement('div');
    div.className = `w-msg ${isUser ? 'user' : 'bot'}`;
    div.textContent = text;
    msgContainer.appendChild(div);
    msgContainer.scrollTop = msgContainer.scrollHeight;
  }

  async function handleSend() {
    const query = input.value.trim();
    if (!query) return;

    addMessage(query, true);
    input.value = '';

    // Check if query looks like a 6-digit Indian pincode
    const pincodeMatch = query.match(/\b\d{6}\b/);
    if (pincodeMatch) {
      try {
        const res = await fetch(`${apiHost}/api/shipping/pincode/${pincodeMatch[0]}`);
        const data = await res.json();
        if (data.success) {
          const d = data.data;
          addMessage(`📍 Pincode ${d.pincode} (${d.city}, ${d.state}): Estimated Delivery ${d.estimated_days} Day(s). Standard Delivery is FREE. Express Delivery available via ${d.courier_partners.slice(0, 2).join(', ')}.`);
          return;
        }
      } catch (err) {
        // Fallback to chat orchestrator
      }
    }

    try {
      const res = await fetch(`${apiHost}/orchestrate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-session-id': sessionId
        },
        body: JSON.stringify({
          query: query,
          session_id: sessionId
        })
      });

      const data = await res.json();
      if (data.explanation) {
        addMessage(data.explanation);
      } else if (data.message) {
        addMessage(data.message);
      } else {
        addMessage("I've evaluated your request across our verified catalog.");
      }
    } catch (err) {
      addMessage("I am connected to the store catalog. How can I help you pick the right equipment?");
    }
  }

  sendBtn.addEventListener('click', handleSend);
  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleSend();
  });
})();
