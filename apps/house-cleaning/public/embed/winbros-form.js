/**
 * WinBros Lead Capture Form — Embeddable Widget
 *
 * Drop this on any page:
 *   <div id="winbros-lead-form"></div>
 *   <script src="https://your-osiris-url/embed/winbros-form.js"></script>
 *
 * Self-contained, zero dependencies, Shadow DOM for CSS isolation.
 */
(function () {
  "use strict";

  var API_URL = (function () {
    var scripts = document.getElementsByTagName("script");
    var src = scripts[scripts.length - 1].src;
    // Derive base URL from script src: https://domain.com/embed/winbros-form.js → https://domain.com
    var url = new URL(src);
    return url.origin + "/api/webhooks/website/winbros";
  })();

  var COOLDOWN_MS = 30000;
  var lastSubmitTime = 0;

  var STYLES = "\n\
    :host { display: block; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }\n\
    * { box-sizing: border-box; margin: 0; padding: 0; }\n\
    .wf-container { max-width: 480px; margin: 0 auto; padding: 24px; background: #fff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }\n\
    .wf-title { font-size: 22px; font-weight: 700; color: #1a1a1a; margin-bottom: 4px; }\n\
    .wf-subtitle { font-size: 14px; color: #666; margin-bottom: 20px; }\n\
    .wf-field { margin-bottom: 14px; }\n\
    .wf-label { display: block; font-size: 13px; font-weight: 600; color: #333; margin-bottom: 4px; }\n\
    .wf-required { color: #e53e3e; }\n\
    .wf-input, .wf-select, .wf-textarea { width: 100%; padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 15px; color: #1a1a1a; background: #fafafa; transition: border-color 0.2s; outline: none; }\n\
    .wf-input:focus, .wf-select:focus, .wf-textarea:focus { border-color: #2563eb; background: #fff; }\n\
    .wf-input.wf-error, .wf-select.wf-error, .wf-textarea.wf-error { border-color: #e53e3e; }\n\
    .wf-textarea { min-height: 80px; resize: vertical; }\n\
    .wf-error-msg { font-size: 12px; color: #e53e3e; margin-top: 3px; }\n\
    .wf-hp { position: absolute; left: -9999px; }\n\
    .wf-btn { display: block; width: 100%; padding: 12px; background: #2563eb; color: #fff; border: none; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer; transition: background 0.2s; margin-top: 8px; }\n\
    .wf-btn:hover { background: #1d4ed8; }\n\
    .wf-btn:disabled { background: #93c5fd; cursor: not-allowed; }\n\
    .wf-success { text-align: center; padding: 32px 16px; }\n\
    .wf-success-icon { font-size: 48px; margin-bottom: 12px; }\n\
    .wf-success-title { font-size: 20px; font-weight: 700; color: #16a34a; margin-bottom: 8px; }\n\
    .wf-success-text { font-size: 14px; color: #666; line-height: 1.5; }\n\
    .wf-error-banner { background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 12px 16px; margin-bottom: 14px; font-size: 13px; color: #991b1b; }\n\
  ";

  function createForm(shadow) {
    var form = document.createElement("form");
    form.setAttribute("novalidate", "");
    form.innerHTML =
      '<div class="wf-container">' +
        '<div class="wf-title">Get a Free Estimate</div>' +
        '<div class="wf-subtitle">Fill out the form and we\'ll get back to you quickly.</div>' +
        '<div id="wf-error-banner" class="wf-error-banner" style="display:none"></div>' +
        '<div class="wf-field">' +
          '<label class="wf-label">Name <span class="wf-required">*</span></label>' +
          '<input type="text" name="name" class="wf-input" placeholder="Your full name" required autocomplete="name">' +
        '</div>' +
        '<div class="wf-field">' +
          '<label class="wf-label">Phone <span class="wf-required">*</span></label>' +
          '<input type="tel" name="phone" class="wf-input" placeholder="(555) 123-4567" required autocomplete="tel">' +
        '</div>' +
        '<div class="wf-field">' +
          '<label class="wf-label">Email</label>' +
          '<input type="email" name="email" class="wf-input" placeholder="you@example.com" autocomplete="email">' +
        '</div>' +
        '<div class="wf-field">' +
          '<label class="wf-label">Service Interest</label>' +
          '<select name="service_type" class="wf-select">' +
            '<option value="">Select a service...</option>' +
            '<option value="Window Cleaning">Window Cleaning</option>' +
            '<option value="Pressure Washing">Pressure Washing</option>' +
            '<option value="Gutter Cleaning">Gutter Cleaning</option>' +
            '<option value="Screen Repair">Screen Repair</option>' +
          '</select>' +
        '</div>' +
        '<div class="wf-field">' +
          '<label class="wf-label">Message</label>' +
          '<textarea name="message" class="wf-textarea" placeholder="Tell us about your project..."></textarea>' +
        '</div>' +
        '<div class="wf-hp"><input type="text" name="website" tabindex="-1" autocomplete="off"></div>' +
        '<button type="submit" class="wf-btn">Request Estimate</button>' +
      '</div>';

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      handleSubmit(form, shadow);
    });

    return form;
  }

  function validate(form) {
    var errors = [];
    var name = form.querySelector('[name="name"]');
    var phone = form.querySelector('[name="phone"]');

    // Reset
    name.classList.remove("wf-error");
    phone.classList.remove("wf-error");

    if (!name.value.trim()) {
      name.classList.add("wf-error");
      errors.push("Name is required");
    }

    var digits = phone.value.replace(/\D/g, "");
    if (digits.length < 10) {
      phone.classList.add("wf-error");
      errors.push("Please enter a valid phone number");
    }

    return errors;
  }

  function handleSubmit(form, shadow) {
    var now = Date.now();
    if (now - lastSubmitTime < COOLDOWN_MS) {
      showError(shadow, "Please wait a moment before submitting again.");
      return;
    }

    var errors = validate(form);
    if (errors.length > 0) {
      showError(shadow, errors.join(". "));
      return;
    }

    // Honeypot check
    var hp = form.querySelector('[name="website"]');
    if (hp && hp.value) {
      // Bot detected — show fake success
      showSuccess(shadow);
      return;
    }

    var btn = form.querySelector(".wf-btn");
    btn.disabled = true;
    btn.textContent = "Sending...";
    hideError(shadow);

    // Capture attribution data
    var params = new URLSearchParams(window.location.search);
    var attribution = {
      referrer: document.referrer || null,
      landing_page: window.location.href,
      utm_source: params.get("utm_source"),
      utm_medium: params.get("utm_medium"),
      utm_campaign: params.get("utm_campaign"),
      utm_content: params.get("utm_content"),
      utm_term: params.get("utm_term"),
    };

    var data = {
      name: form.querySelector('[name="name"]').value.trim(),
      phone: form.querySelector('[name="phone"]').value.trim(),
      email: form.querySelector('[name="email"]').value.trim(),
      service_type: form.querySelector('[name="service_type"]').value,
      message: form.querySelector('[name="message"]').value.trim(),
      attribution: attribution,
    };

    var xhr = new XMLHttpRequest();
    xhr.open("POST", API_URL, true);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.timeout = 15000;

    xhr.onload = function () {
      if (xhr.status >= 200 && xhr.status < 300) {
        lastSubmitTime = Date.now();
        showSuccess(shadow);
      } else {
        btn.disabled = false;
        btn.textContent = "Request Estimate";
        showError(shadow, "Something went wrong. Please try again or call us directly.");
      }
    };

    xhr.onerror = function () {
      btn.disabled = false;
      btn.textContent = "Request Estimate";
      showError(shadow, "Network error. Please check your connection and try again.");
    };

    xhr.ontimeout = function () {
      btn.disabled = false;
      btn.textContent = "Request Estimate";
      showError(shadow, "Request timed out. Please try again.");
    };

    xhr.send(JSON.stringify(data));
  }

  function showError(shadow, msg) {
    var banner = shadow.querySelector("#wf-error-banner");
    if (banner) {
      banner.textContent = msg;
      banner.style.display = "block";
    }
  }

  function hideError(shadow) {
    var banner = shadow.querySelector("#wf-error-banner");
    if (banner) {
      banner.style.display = "none";
    }
  }

  function showSuccess(shadow) {
    var container = shadow.querySelector(".wf-container");
    if (container) {
      container.innerHTML =
        '<div class="wf-success">' +
          '<div class="wf-success-icon">&#10003;</div>' +
          '<div class="wf-success-title">Thank You!</div>' +
          '<div class="wf-success-text">We received your request and will get back to you shortly. Keep an eye on your phone for a text from us!</div>' +
        '</div>';
    }
  }

  function init() {
    var host = document.getElementById("winbros-lead-form");
    if (!host) return;

    var shadow = host.attachShadow({ mode: "open" });

    var style = document.createElement("style");
    style.textContent = STYLES;
    shadow.appendChild(style);

    var form = createForm(shadow);
    shadow.appendChild(form);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
