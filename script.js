// Base API configuration. Change this to your hosted backend URI if deploying static assets to GitHub Pages.
const API_BASE_URL =
  window.location.origin === "https://gautam958.github.io"
    ? "https://sello-bkh7dwd8avecbyd9.eastasia-01.azurewebsites.net/api"
    : "/api";

// Auth base URL - same server but without /api
const AUTH_BASE_URL =
  window.location.origin === "https://gautam958.github.io"
    ? "https://sello-bkh7dwd8avecbyd9.eastasia-01.azurewebsites.net"
    : "";

// Host that serves uploaded images. Images live at `/images`, a sibling of `/api`,
// on the same server, so derive it by stripping the trailing `/api` from the API base.
const ASSET_BASE_URL = API_BASE_URL.replace(/\/api\/?$/, "");

// Resolve a stored image value to a usable src. Handles full URLs, values already
// prefixed with `/images/` or `/Images/`, and bare filenames from new uploads.
function resolveImageSrc(image, fallback) {
  if (!image) return fallback;
  if (image.startsWith("http")) return image;
  const filename = image
    .replace(/^\/?(images|Images)\//, "")
    .replace(/^\/+/, "");
  return `${ASSET_BASE_URL}/images/${filename}`;
}

// Auth header helper — sends the token stored on login for admin operations.
function getAuthHeaders() {
  const token = sessionStorage.getItem("sello_token");
  return token ? { Authorization: "Bearer " + token } : {};
}

// Escape user-supplied text before injecting into HTML.
function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Application state configuration initialization
function initApp(page) {
  // Handle Google OAuth callback
  handleGoogleOAuthCallback();

  setupNavbar();
  trackVisit();
  startCountdown();

  if (page === "market") {
    loadMarketplaceItems();
    initLiveActivity();
    loadUserWishlist();
    setupWishlistButtons();
  } else if (page === "login") {
    setupLoginHandler();
  } else if (page === "signup") {
    setupSignupHandler();
  } else if (page === "admin") {
    checkAdminAccess();
    loadAdminDashboard();
    initAdminStatusControls();
  } else if (page === "users") {
    checkAdminAccess();
    loadAdminUsers();
  } else if (page === "logs") {
    checkAdminAccess();
    loadAdminLogs();
  } else if (page === "visitors") {
    checkAdminAccess();
    loadAdminVisitors();
  } else if (page === "wishlist") {
    loadUserWishlistPage();
  } else if (page === "admin-wishlist") {
    checkAdminAccess();
  }
}

// Handle Google OAuth callback - extract token and user from URL params
function handleGoogleOAuthCallback() {
  const params = new URLSearchParams(window.location.search);
  const googleToken = params.get("google_token");
  const googleUser = params.get("google_user");

  if (googleToken && googleUser) {
    try {
      // Store the token and user in sessionStorage
      sessionStorage.setItem("sello_token", googleToken);
      sessionStorage.setItem("sello_user", googleUser);

      // Clean up URL parameters
      const cleanUrl = window.location.pathname + window.location.hash;
      window.history.replaceState({}, document.title, cleanUrl);

      // Show success toast
      const userData = JSON.parse(googleUser);
      showToast(
        `Welcome, ${userData.googleName || userData.username}! Signed in with Google.`,
      );
    } catch (e) {
      console.error("Error handling Google OAuth callback:", e);
    }
  }

  // Handle error params
  const error = params.get("error");
  if (error) {
    const errorMessages = {
      google_auth_failed: "Google sign-in failed. Please try again.",
      google_auth_error: "An error occurred during Google sign-in.",
      google_oauth_not_configured:
        "Google sign-in is not configured. Please contact the administrator.",
    };
    const message =
      errorMessages[error] || "Authentication failed. Please try again.";
    showToast(message, "error");

    // Clean up URL parameters
    const cleanUrl = window.location.pathname + window.location.hash;
    window.history.replaceState({}, document.title, cleanUrl);
  }
}

// ─── User Wishlist Page ─────────────────────────────────────────────────────
async function loadUserWishlistPage() {
  const grid = document.getElementById("wishlist-grid");
  const emptyEl = document.getElementById("wishlist-empty");

  if (!grid) return;

  const user = getSessionUser();
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  try {
    const res = await fetch(`${API_BASE_URL}/wishlist`, {
      headers: getAuthHeaders(),
    });

    if (!res.ok) {
      grid.innerHTML =
        '<p style="color:#ef4444;text-align:center;">Unable to load wishlist.</p>';
      return;
    }

    const wishlist = await res.json();

    if (wishlist.length === 0) {
      grid.style.display = "none";
      emptyEl.style.display = "block";
      return;
    }

    emptyEl.style.display = "none";
    grid.style.display = "grid";

    grid.innerHTML = wishlist
      .map((w) => {
        const imgSrc = resolveImageSrc(
          w.itemImage,
          "https://placehold.co/600x400?text=No+Image",
        );
        return `
        <div class="card" data-id="${w.itemId}">
          <div class="card-img-wrapper">
            <img src="${imgSrc}" alt="${escapeHtml(w.itemName)}" class="card-img" onerror="this.src='https://placehold.co/600x400?text=No+Image'; this.onerror=null;">
          </div>
          <div class="card-content">
            <h3 class="card-title">${escapeHtml(w.itemName)}</h3>
            <p style="font-size: 0.9rem; color: #64748b; margin-bottom: 0.5rem;">Added ${new Date(w.addedAt).toLocaleDateString()}</p>
            <p style="font-size: 1.1rem; font-weight: 700; color: var(--primary);">HK$${parseFloat(w.itemPrice).toFixed(2)}</p>
            <div class="card-footer" style="gap: 0.5rem;">
              <a href="index.html" class="btn" style="flex:1;">View Item</a>
              <button class="btn remove-wishlist-btn" data-item-id="${w.itemId}" style="background-color: #64748b;">Remove</button>
            </div>
          </div>
        </div>
      `;
      })
      .join("");

    // Remove button handlers
    document.querySelectorAll(".remove-wishlist-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const itemId = btn.dataset.itemId;
        try {
          const res = await fetch(`${API_BASE_URL}/wishlist/${itemId}`, {
            method: "DELETE",
            headers: getAuthHeaders(),
          });
          if (res.ok) {
            btn.closest(".card").remove();
            showToast("Removed from wishlist");
            // Check if empty
            if (grid.querySelectorAll(".card").length === 0) {
              grid.style.display = "none";
              emptyEl.style.display = "block";
            }
          }
        } catch (err) {
          showToast("Failed to remove");
        }
      });
    });
  } catch (err) {
    grid.innerHTML =
      '<p style="color:#ef4444;text-align:center;">Error loading wishlist.</p>';
  }
}

// ─── Countdown Timer ───────────────────────────────────────────────────────
const SALE_END_DATE = new Date("2026-06-14T23:59:59");

function startCountdown() {
  const countdownEl = document.getElementById("countdown-text");
  const marqueeStartEl = document.getElementById("marquee-countdown");
  const marqueeEndEl = document.getElementById("marquee-countdown-end");

  if (!countdownEl && !marqueeStartEl) return;

  function update() {
    const now = new Date();
    const diff = SALE_END_DATE - now;

    if (diff <= 0) {
      if (countdownEl) countdownEl.textContent = "Sale has ended!";
      if (marqueeStartEl)
        marqueeStartEl.textContent =
          "🚚 Sale has ended! Pickup remaining items by June 16.";
      if (marqueeEndEl) marqueeEndEl.textContent = "";
      return;
    }

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    const shortText =
      days > 0
        ? `${days}d ${hours}h ${minutes}m ${seconds}s left`
        : `${hours}h ${minutes}m ${seconds}s left`;
    const marqueeText = `⏰ Sale ends in ${shortText} —`;

    if (countdownEl) countdownEl.textContent = shortText;
    if (marqueeStartEl) marqueeStartEl.textContent = marqueeText;
    if (marqueeEndEl) marqueeEndEl.textContent = marqueeText;
  }

  update();
  setInterval(update, 1000);
}

// ─── Wishlist Functions ─────────────────────────────────────────────────────
let userWishlist = [];

async function loadUserWishlist() {
  try {
    const res = await fetch(`${API_BASE_URL}/wishlist`, {
      headers: getAuthHeaders(),
    });
    if (res.ok) {
      userWishlist = await res.json();
      updateWishlistButtons();
    }
  } catch (err) {
    // Silently fail
  }
}

function updateWishlistButtons() {
  document.querySelectorAll(".wishlist-btn").forEach((btn) => {
    const itemId = btn.dataset.id;
    const isWishlisted = userWishlist.some((w) => w.itemId === itemId);
    btn.classList.toggle("active", isWishlisted);
    btn.title = isWishlisted ? "Remove from Wishlist" : "Add to Wishlist";
  });
}

function setupWishlistButtons() {
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest(".wishlist-btn");
    if (!btn) return;

    const user = getSessionUser();
    if (!user) {
      // Use inline auth modal instead of redirecting
      openAuthModal();
      return;
    }

    const itemId = btn.dataset.id;
    const isActive = btn.classList.contains("active");

    try {
      if (isActive) {
        // Remove from wishlist
        const res = await fetch(`${API_BASE_URL}/wishlist/${itemId}`, {
          method: "DELETE",
          headers: getAuthHeaders(),
        });
        if (res.ok) {
          userWishlist = userWishlist.filter((w) => w.itemId !== itemId);
          btn.classList.remove("active");
          btn.title = "Add to Wishlist";
          showToast("Removed from wishlist");
        }
      } else {
        // Add to wishlist
        const res = await fetch(`${API_BASE_URL}/wishlist`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...getAuthHeaders(),
          },
          body: JSON.stringify({ itemId }),
        });
        if (res.ok) {
          const newEntry = {
            id: Date.now().toString(),
            itemId,
            itemName: btn.dataset.name,
          };
          userWishlist.push(newEntry);
          btn.classList.add("active");
          btn.title = "Remove from Wishlist";
          showToast("Added to wishlist!");
        } else {
          const data = await res.json();
          showToast(data.message || "Failed to add to wishlist");
        }
      }
    } catch (err) {
      showToast("Something went wrong");
    }
  });
}

function showAuthRequiredModal(message) {
  const modal = document.createElement("div");
  modal.className = "bid-modal";
  modal.style.display = "flex";
  modal.innerHTML = `
    <div class="modal-content" style="max-width: 400px; text-align: center;">
      <span class="close-btn" onclick="this.closest('.bid-modal').remove()">&times;</span>
      <h2 style="margin-bottom: 1rem;">Login Required</h2>
      <p style="color: #64748b; margin-bottom: 1.5rem;">${message}</p>
      <div style="display: flex; gap: 1rem; justify-content: center;">
        <a href="login.html" class="btn">Login</a>
        <a href="signup.html" class="btn" style="background-color: #64748b;">Sign Up</a>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.remove();
  });
}

function showToast(message) {
  const existing = document.querySelector(".toast-message");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.className = "toast-message";
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    bottom: 2rem;
    left: 50%;
    transform: translateX(-50%);
    background: var(--secondary);
    color: #fff;
    padding: 0.75rem 1.5rem;
    border-radius: 999px;
    font-size: 0.9rem;
    font-weight: 600;
    z-index: 9999;
    animation: toastSlideUp 0.3s ease;
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

// ─── Live Activity Sidebar (recent bids panel) ──────────────────────────────
let liveInterval = null;

function initLiveActivity() {
  const panel = document.getElementById("live-activity-panel");
  const toggle = document.getElementById("live-panel-toggle");

  if (!panel || !toggle) return;

  // Toggle panel collapse
  toggle.addEventListener("click", () => {
    panel.classList.toggle("collapsed");
    toggle.textContent = panel.classList.contains("collapsed") ? "▲" : "▼";
  });

  // Initial load
  fetchAndShuffleLiveBids();

  // Refresh every 15 seconds
  if (liveInterval) clearInterval(liveInterval);
  liveInterval = setInterval(fetchAndShuffleLiveBids, 15000);
}

async function fetchAndShuffleLiveBids() {
  const container = document.getElementById("live-bids-container");
  if (!container) return;

  try {
    const res = await fetch(`${API_BASE_URL}/recent-bids`);
    if (!res.ok) return;

    const bids = await res.json();
    renderLiveBids(bids, container);
  } catch (err) {
    // Silently fail - live panel is non-critical
  }
}

function renderLiveBids(bids, container) {
  if (!bids || bids.length === 0) {
    container.innerHTML = '<div class="live-empty">No bids yet</div>';
    return;
  }

  container.innerHTML = bids
    .map((bid, index) => {
      const imgSrc = resolveImageSrc(
        bid.itemImage,
        "https://placehold.co/80x60?text=No+Image",
      );
      // Status badge only for non-Available items
      const statusBadge =
        bid.itemStatus && bid.itemStatus !== "Available"
          ? `<span class="live-bid-status-badge live-bid-status-${bid.itemStatus.toLowerCase().replace(/\s+/g, "-")}">${bid.itemStatus.toUpperCase()}</span>`
          : "";
      return `
    <div class="live-bid-item fade-in" style="animation-delay: ${index * 80}ms" onclick="scrollToItem('${bid.itemId}')">
      <img src="${imgSrc}" alt="${escapeHtml(bid.itemName)}" class="live-bid-img" onerror="this.src='https://placehold.co/80x60?text=No+Image'; this.onerror=null;">
      <div class="live-bid-content">
        <div class="live-bid-amount">HK$ ${bid.amount.toLocaleString()} ${statusBadge}</div>
        <div class="live-bid-name">${escapeHtml(bid.itemName)}</div>
        <div class="live-bid-time">${formatTimeAgo(bid.timestamp)}</div>
      </div>
    </div>
  `;
    })
    .join("");
}

function scrollToItem(itemId) {
  const itemCard = document.querySelector(`.card[data-id="${itemId}"]`);
  if (itemCard) {
    itemCard.scrollIntoView({ behavior: "smooth", block: "center" });
    itemCard.style.boxShadow = "0 0 0 3px var(--primary)";
    setTimeout(() => {
      itemCard.style.boxShadow = "";
    }, 2000);
  }
}

function formatTimeAgo(timestamp) {
  if (!timestamp) return "";
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diff = Math.floor((now - then) / 1000);

  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// Fire-and-forget page view ping to the analytics endpoint. A stable visitor
// id is kept in localStorage so the server can distinguish new vs returning.
function trackVisit() {
  try {
    let vid = localStorage.getItem("sello_vid");
    if (!vid) {
      vid =
        (crypto?.randomUUID?.() ||
          Date.now().toString(36) + Math.random().toString(36).slice(2)) + "";
      localStorage.setItem("sello_vid", vid);
    }

    // Computer name is not reliably available in browsers for privacy reasons.
    // This field will typically be empty unless the user is on a local network
    // where hostname can be detected via WebRTC.
    let computerName = "";
    if (typeof RTCPeerConnection !== "undefined") {
      try {
        const pc = new RTCPeerConnection({ iceServers: [] });
        pc.createDataChannel("");
        pc.onicecandidate = (e) => {
          if (e.candidate) {
            const match = /candidate:.* cname:(.*?) /.exec(
              e.candidate.candidate,
            );
            if (match) computerName = match[1].substring(0, 64);
          }
        };
        pc.createOffer().then((offer) => pc.setLocalDescription(offer));
        setTimeout(() => {
          try {
            pc.close();
          } catch {}
        }, 1000);
      } catch {}
    }

    fetch(`${API_BASE_URL}/track`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeaders(),
      },
      body: JSON.stringify({
        visitorId: vid,
        path: location.pathname + location.search,
        referrer: document.referrer || "",
        computerName,
      }),
      keepalive: true,
    }).catch(() => {});
  } catch (e) {
    /* analytics must never break the page */
  }
}

function getSessionUser() {
  const userJson = sessionStorage.getItem("sello_user");
  return userJson ? JSON.parse(userJson) : null;
}

// Helper function to get max bid from bids array
function getMaxBidFromArray(bidsArray) {
  if (!bidsArray || bidsArray.length === 0) return 0;
  return Math.max(...bidsArray.map((bid) => bid.bidAmount || 0));
}

function setupNavbar() {
  const nav = document.getElementById("nav-menu");
  if (!nav) return;

  const user = getSessionUser();
  const current = window.location.pathname.split("/").pop() || "index.html";
  const link = (href, label, extra = "") => {
    const classes = [extra, current === href ? "active" : ""]
      .filter(Boolean)
      .join(" ");
    return `<a href="${href}"${classes ? ` class="${classes}"` : ""}>${label}</a>`;
  };

  let html = link("index.html", "Home");
  html += link("contact.html", "Contact");

  if (user) {
    if (user.role === "admin") {
      html += link("admin.html", "Admin Items");
      html += link("users.html", "Manage Users");
      html += link("logs.html", "Logs");
      html += link("visitors.html", "Visitors");
      html += link("admin-wishlist.html", "Wishlists");
    } else {
      // Regular user - show wishlist link
      html += link("wishlist.html", "♥ Wishlist");
    }

    // User info with profile picture support
    let userInfo = `<span class="nav-user">`;

    // Add Google profile picture if available
    if (user.googlePicture) {
      userInfo += `<img src="${user.googlePicture}" alt="Profile" class="nav-user-avatar" />`;
    } else {
      // Fall back to initial avatar
      const initial = (user.username || "U").charAt(0).toUpperCase();
      userInfo += `<span class="nav-user-initial">${initial}</span>`;
    }

    userInfo += `<span class="nav-user-name">Welcome, ${user.googleName || user.username} (${user.role})</span>`;
    userInfo += `</span>`;
    html += userInfo;
    html += `<button id="logout-btn" class="btn nav-logout">Logout</button>`;
  } else {
    html += link("login.html", "Login");
  }
  nav.innerHTML = html;

  // Mobile hamburger toggle (injected once into the header).
  const header = nav.closest("header") || document.querySelector("header");
  let toggle = document.getElementById("nav-toggle");
  if (!toggle && header) {
    toggle = document.createElement("button");
    toggle.id = "nav-toggle";
    toggle.className = "nav-toggle";
    toggle.type = "button";
    toggle.setAttribute("aria-label", "Toggle navigation menu");
    toggle.setAttribute("aria-controls", "nav-menu");
    toggle.setAttribute("aria-expanded", "false");
    toggle.innerHTML = "<span></span><span></span><span></span>";
    header.insertBefore(toggle, nav);
    toggle.addEventListener("click", () => {
      const open = nav.classList.toggle("open");
      toggle.classList.toggle("active", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  // Close the mobile menu after navigating.
  nav.querySelectorAll("a, button").forEach((el) =>
    el.addEventListener("click", () => {
      nav.classList.remove("open");
      toggle?.classList.remove("active");
      toggle?.setAttribute("aria-expanded", "false");
    }),
  );

  document.getElementById("logout-btn")?.addEventListener("click", () => {
    sessionStorage.removeItem("sello_user");
    sessionStorage.removeItem("sello_token");
    window.location.href = "index.html";
  });
}

// ---------------- MARKET PLACE VIEW ENGINE ----------------
let currentTargetBidId = null;

let __allMarketItems = [];
let __featuredItemId = null;

function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function applyItemFilters() {
  const searchEl = document.getElementById("filter-search");
  const statusEl = document.getElementById("filter-status");
  const sortEl = document.getElementById("filter-sort");
  const search = (searchEl?.value || "").trim().toLowerCase();
  const status = statusEl?.value || "all";
  const sort = sortEl?.value || "default";
  const onSaleEl = document.getElementById("filter-onsale");
  const onSaleOnly = onSaleEl?.checked || false;

  let list = __allMarketItems.filter((item) => {
    if (status !== "all" && (item.status || "Available") !== status)
      return false;
    if (onSaleOnly && !(parseInt(item.discount, 10) > 0))
      return false;
    if (search) {
      const hay = `${item.name || ""} ${item.description || ""}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  if (sort === "price-asc") {
    list.sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
  } else if (sort === "price-desc") {
    list.sort((a, b) => parseFloat(b.price) - parseFloat(a.price));
  } else if (sort === "bids-desc") {
    list.sort((a, b) => (b.bidsCount || 0) - (a.bidsCount || 0));
  } else if (sort === "name-asc") {
    list.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  } else if (sort === "discount-desc") {
    list.sort((a, b) => (parseInt(b.discount, 10) || 0) - (parseInt(a.discount, 10) || 0));
  } else {
    // default: pin featured item on top, shuffle the rest randomly
    const featured = list.find((i) => i.id === __featuredItemId);
    const rest = list.filter((i) => i.id !== __featuredItemId);
    const shuffled = shuffleArray(rest);
    list = featured ? [featured, ...shuffled] : shuffled;
  }

  renderMarketplaceItems(list);
}

function renderMarketplaceItems(visibleItems) {
  const grid = document.getElementById("items-grid");
  if (!grid) return;

  if (visibleItems.length === 0) {
    grid.innerHTML = "<p>No items match your filters.</p>";
    return;
  }

  grid.innerHTML = visibleItems
    .map((item) => {
      const topBidValue = item.highestBid || 0;
      const processingBaselinePrice = item.price;
      const discount = parseInt(item.discount, 10) || 0;
      const hasDiscount = discount > 0 && discount <= 90;
      const discountedPrice = hasDiscount
        ? (processingBaselinePrice * (1 - discount / 100)).toFixed(2)
        : null;

      const imgSrc = resolveImageSrc(
        item.image,
        "https://placehold.co/600x400?text=No+Image",
      );

      const statusClass =
        item.status === "Booked"
          ? "status-booked"
          : item.status === "Pickup Scheduled"
            ? "status-pickup"
            : item.status === "Sold"
              ? "status-sold"
              : "status-available";
      const statusLabel = item.status || "Available";
      const canBid = item.status === "Available";

      const priceHTML = hasDiscount
        ? `<div class="price-container">
              <span class="price-old">HK$${parseFloat(processingBaselinePrice).toFixed(2)}</span>
              <span class="price-new">HK$${discountedPrice}</span>
              <span class="discount-badge">${discount}% OFF</span>
           </div>`
        : `<span class="price">HK$${parseFloat(processingBaselinePrice).toFixed(2)}</span>`;

      return `
        <div class="card" data-id="${item.id}">
            <div class="card-img-wrapper">
              <img src="${imgSrc}" alt="${item.name}" class="card-img" data-full="${imgSrc}" onerror="this.src='https://placehold.co/600x400?text=No+Image'; this.onerror=null;">
              <span class="status-badge ${statusClass}">${statusLabel}</span>
              <button class="wishlist-btn" data-id="${item.id}" data-name="${escapeHtml(item.name)}" title="Add to Wishlist">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                </svg>
              </button>
            </div>
            <div class="card-content">
                <h3 class="card-title">${item.name}</h3>
                <p class="card-desc">${item.description}</p>
                <p style="font-size: 0.9rem; margin-bottom: 0.5rem;">Bids: ${item.bidsCount || 0}</p>
                <div class="card-footer">
                    ${priceHTML}
                    ${
                      canBid
                        ? `<button class="btn btn-status-available open-bid-modal-btn" data-id="${item.id}" data-name="${item.name}" data-price="${item.price}" data-highest="${topBidValue}">Book / Place Bid</button>`
                        : `<button class="btn btn-status-${item.status.toLowerCase().replace(/\s+/g, "-")}" disabled>${item.status}</button>`
                    }
                </div>
            </div>
        </div>
      `;
    })
    .join("");

  setupModalTriggers();
  setupImageLightbox();
}

function setupItemFilterControls() {
  const search = document.getElementById("filter-search");
  const status = document.getElementById("filter-status");
  const sort = document.getElementById("filter-sort");
  const reset = document.getElementById("filter-reset");
  if (!search || search.dataset.bound === "1") return;
  search.dataset.bound = "1";
  search.addEventListener("input", applyItemFilters);
  status.addEventListener("change", applyItemFilters);
  sort.addEventListener("change", applyItemFilters);
  const onSaleCheckbox = document.getElementById("filter-onsale");
  if (onSaleCheckbox) onSaleCheckbox.addEventListener("change", applyItemFilters);
  reset.addEventListener("click", () => {
    search.value = "";
    status.value = "all";
    sort.value = "default";
    const onSaleReset = document.getElementById("filter-onsale");
    if (onSaleReset) onSaleReset.checked = false;
    applyItemFilters();
  });
}

async function loadMarketplaceItems() {
  const grid = document.getElementById("items-grid");
  if (!grid) return;

  try {
    const response = await fetch(`${API_BASE_URL}/items`);
    const items = await response.json();
    __allMarketItems = Array.isArray(items) ? items : [];
    // Pin the first item from the server response as the featured one.
    __featuredItemId = __allMarketItems.length ? __allMarketItems[0].id : null;

    setupItemFilterControls();
    applyItemFilters();
  } catch (err) {
    grid.innerHTML = `
      <div class="catalog-error-panel">
        <div class="error-header">
          <div class="error-header-icon">⚠️</div>
          <div class="error-header-text">
            <h3>We are updating our catalog</h3>
            <p>We will be back soon</p>
          </div>
        </div>
        <div class="error-body">
          <div class="error-body-title">Troubleshooting Steps</div>
          <ul class="troubleshoot-list">
            <li>
              <span class="step-icon">1</span>
              <div>
                <strong>Hard Refresh</strong><br>
                Press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd> (Windows) or <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd> (Mac)
              </div>
            </li>
            <li>
              <span class="step-icon">2</span>
              <div>
                <strong>Clear Browser Cache</strong><br>
                Settings → Privacy → Clear browsing data, then refresh
              </div>
            </li>
            <li>
              <span class="step-icon">3</span>
              <div>
                <strong>Try Incognito Mode</strong><br>
                Open in a private/incognito window to avoid cached issues
              </div>
            </li>
            <li>
              <span class="step-icon">4</span>
              <div>
                <strong>Check Your Connection</strong><br>
                Ensure stable internet and try again shortly
              </div>
            </li>
          </ul>
        </div>
        <div class="error-footer">
          <p>Still having issues? <a href="contact.html">Contact us</a></p>
        </div>
      </div>
    `;
  }
}

// Store pending bid item for after auth
let pendingBidItem = null;

function setupModalTriggers() {
  document.querySelectorAll(".open-bid-modal-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const user = getSessionUser();
      if (!user) {
        // Store the bid item info for after auth
        pendingBidItem = {
          id: btn.getAttribute("data-id"),
          name: btn.getAttribute("data-name"),
          price: parseFloat(btn.getAttribute("data-price")),
          highest: parseFloat(btn.getAttribute("data-highest")),
        };
        // Show inline auth modal instead of redirecting
        openAuthModal();
        return;
      }

      const buttonTarget = e.currentTarget;
      currentTargetBidId = buttonTarget.getAttribute("data-id");
      const baselinePrice = parseFloat(buttonTarget.getAttribute("data-price"));
      const highestBidValue = parseFloat(
        buttonTarget.getAttribute("data-highest"),
      );
      const dynamicDefaultValue =
        highestBidValue > 0 ? highestBidValue + 1.0 : baselinePrice;

      document.getElementById("modal-item-name").innerText =
        buttonTarget.getAttribute("data-name");
      document.getElementById("modal-item-price").innerText =
        `HK$${baselinePrice.toFixed(2)}`;
      document.getElementById("modal-highest-bid").innerText =
        highestBidValue > 0 ? `HK$${highestBidValue.toFixed(2)}` : "None";
      document.getElementById("bid-amount").value =
        dynamicDefaultValue.toFixed(2);

      document.getElementById("bid-modal").style.display = "flex";
    });
  });
}

// ─── Inline Auth Modal Functions ────────────────────────────────────────────

function openAuthModal() {
  const modal = document.getElementById("auth-modal");
  if (!modal) return;

  // Reset forms
  document.getElementById("auth-login-form").style.display = "block";
  document.getElementById("auth-signup-form").style.display = "none";
  document.getElementById("auth-login-error").style.display = "none";
  document.getElementById("auth-signup-error").style.display = "none";
  document.getElementById("auth-loading").style.display = "none";

  // Clear inputs
  [
    "auth-username",
    "auth-password",
    "auth-new-username",
    "auth-new-email",
    "auth-new-mobile",
    "auth-new-password",
    "auth-confirm-password",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });

  // Set login tab as active
  document.getElementById("tab-login").classList.add("active");
  document.getElementById("tab-login").style.color = "var(--primary)";
  document.getElementById("tab-login").style.borderBottom =
    "2px solid var(--primary)";
  document.getElementById("tab-signup").classList.remove("active");
  document.getElementById("tab-signup").style.color = "#64748b";
  document.getElementById("tab-signup").style.borderBottom = "none";

  modal.style.display = "flex";
}

function closeAuthModal() {
  const modal = document.getElementById("auth-modal");
  if (modal) modal.style.display = "none";
  pendingBidItem = null;
}

// Tab switching
document.addEventListener("DOMContentLoaded", () => {
  // Initialize Google Sign-In buttons with correct auth URL
  ["google-signin-btn", "google-signup-btn", "google-auth-btn"].forEach(
    (id) => {
      const btn = document.getElementById(id);
      if (btn) {
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          const authPath = btn.dataset.authUrl || "/auth/google";
          // When on GitHub Pages, send full return URL; otherwise just path
          const returnPath = window.location.pathname.replace(
            /\/[^\/]*$/,
            "/index.html",
          );
          const returnUrl = AUTH_BASE_URL
            ? `${window.location.origin}${returnPath}`
            : "index.html";
          window.location.href =
            AUTH_BASE_URL +
            authPath +
            "?return=" +
            encodeURIComponent(returnUrl);
        });
      }
    },
  );

  document.getElementById("tab-login")?.addEventListener("click", () => {
    document.getElementById("auth-login-form").style.display = "block";
    document.getElementById("auth-signup-form").style.display = "none";
    document.getElementById("tab-login").classList.add("active");
    document.getElementById("tab-login").style.color = "var(--primary)";
    document.getElementById("tab-login").style.borderBottom =
      "2px solid var(--primary)";
    document.getElementById("tab-signup").classList.remove("active");
    document.getElementById("tab-signup").style.color = "#64748b";
    document.getElementById("tab-signup").style.borderBottom = "none";
    document.getElementById("auth-login-error").style.display = "none";
  });

  document.getElementById("tab-signup")?.addEventListener("click", () => {
    document.getElementById("auth-login-form").style.display = "none";
    document.getElementById("auth-signup-form").style.display = "block";
    document.getElementById("tab-signup").classList.add("active");
    document.getElementById("tab-signup").style.color = "var(--primary)";
    document.getElementById("tab-signup").style.borderBottom =
      "2px solid var(--primary)";
    document.getElementById("tab-login").classList.remove("active");
    document.getElementById("tab-login").style.color = "#64748b";
    document.getElementById("tab-login").style.borderBottom = "none";
    document.getElementById("auth-signup-error").style.display = "none";
  });

  // Close button
  document
    .getElementById("auth-modal-close")
    ?.addEventListener("click", closeAuthModal);

  // Inline Login Form Handler
  document
    .getElementById("auth-login-form")
    ?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const username = document.getElementById("auth-username").value.trim();
      const password = document.getElementById("auth-password").value;
      const errorEl = document.getElementById("auth-login-error");
      const loadingEl = document.getElementById("auth-loading");

      errorEl.style.display = "none";
      loadingEl.style.display = "block";

      try {
        const res = await fetch(`${API_BASE_URL}/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
        });

        const data = await res.json();
        loadingEl.style.display = "none";

        if (res.ok) {
          // Login successful - store session
          sessionStorage.setItem("sello_user", JSON.stringify(data.user));
          sessionStorage.setItem("sello_token", data.token);

          closeAuthModal();
          setupNavbar();

          // If there was a pending bid, open the bid modal
          if (pendingBidItem) {
            openBidModalFromItem(pendingBidItem);
            pendingBidItem = null;
          }
        } else {
          errorEl.textContent =
            data.message || "Login failed. Please try again.";
          errorEl.style.display = "block";
        }
      } catch (err) {
        loadingEl.style.display = "none";
        errorEl.textContent = "Connection error. Please try again.";
        errorEl.style.display = "block";
      }
    });

  // Inline Signup Form Handler
  document
    .getElementById("auth-signup-form")
    ?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const username = document
        .getElementById("auth-new-username")
        .value.trim();
      const email = document.getElementById("auth-new-email").value.trim();
      const mobile = document.getElementById("auth-new-mobile").value.trim();
      const password = document.getElementById("auth-new-password").value;
      const confirmPassword = document.getElementById(
        "auth-confirm-password",
      ).value;
      const errorEl = document.getElementById("auth-signup-error");
      const loadingEl = document.getElementById("auth-loading");

      errorEl.style.display = "none";

      if (password !== confirmPassword) {
        errorEl.textContent = "Passwords do not match.";
        errorEl.style.display = "block";
        return;
      }

      loadingEl.style.display = "block";

      try {
        const res = await fetch(`${API_BASE_URL}/signup`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, email, mobile, password }),
        });

        const data = await res.json();
        loadingEl.style.display = "none";

        if (res.ok) {
          // Signup successful - auto login
          const loginRes = await fetch(`${API_BASE_URL}/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password }),
          });

          if (loginRes.ok) {
            const loginData = await loginRes.json();
            sessionStorage.setItem(
              "sello_user",
              JSON.stringify(loginData.user),
            );
            sessionStorage.setItem("sello_token", loginData.token);

            closeAuthModal();
            setupNavbar();

            // If there was a pending bid, open the bid modal
            if (pendingBidItem) {
              openBidModalFromItem(pendingBidItem);
              pendingBidItem = null;
            }
          } else {
            // Signup succeeded but auto-login failed - switch to login tab
            showToast("Account created! Please login.");
            document.getElementById("tab-login").click();
            document.getElementById("auth-username").value = username;
          }
        } else {
          errorEl.textContent =
            data.message || "Signup failed. Please try again.";
          errorEl.style.display = "block";
        }
      } catch (err) {
        loadingEl.style.display = "none";
        errorEl.textContent = "Connection error. Please try again.";
        errorEl.style.display = "block";
      }
    });
});

function openBidModalFromItem(item) {
  currentTargetBidId = item.id;
  const highestBidValue = item.highest > 0 ? item.highest : item.price;
  const dynamicDefaultValue =
    highestBidValue > 0 ? highestBidValue + 1.0 : item.price;

  document.getElementById("modal-item-name").innerText = item.name;
  document.getElementById("modal-item-price").innerText =
    `HK$${item.price.toFixed(2)}`;
  document.getElementById("modal-highest-bid").innerText =
    highestBidValue > 0 ? `HK$${highestBidValue.toFixed(2)}` : "None";
  document.getElementById("bid-amount").value = dynamicDefaultValue.toFixed(2);

  document.getElementById("bid-modal").style.display = "flex";
}

document.addEventListener("DOMContentLoaded", () => {
  document
    .querySelectorAll("#modal-cancel-btn, #modal-cancel-btn-button")
    .forEach((btn) => {
      btn.addEventListener("click", () => {
        document.getElementById("bid-modal").style.display = "none";
      });
    });

  document
    .getElementById("modal-submit-btn")
    ?.addEventListener("click", async () => {
      const user = getSessionUser();
      const amount = parseFloat(document.getElementById("bid-amount").value);

      if (isNaN(amount) || amount <= 0) {
        showToast("Please enter a valid bid amount.");
        return;
      }

      try {
        const res = await fetch(
          `${API_BASE_URL}/items/book/${currentTargetBidId}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...getAuthHeaders(),
            },
            body: JSON.stringify({ bidAmount: amount }),
          },
        );

        const data = await res.json();
        if (res.ok) {
          showToast("Bid placed successfully!");
          document.getElementById("bid-modal").style.display = "none";
          loadMarketplaceItems();
        } else {
          showToast(data.message || "Failed to place bid.");
        }
      } catch (err) {
        showToast("Error connecting to server.");
      }
    });
});

// ---------------- USER LOGINS HANDLERS ----------------
function setupLoginHandler() {
  document
    .getElementById("login-form")
    .addEventListener("submit", async (e) => {
      e.preventDefault();
      const username = document.getElementById("username").value.trim();
      const password = document.getElementById("password").value;
      const errText = document.getElementById("login-error");

      try {
        const res = await fetch(`${API_BASE_URL}/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
        });

        const data = await res.json();
        if (res.ok) {
          sessionStorage.setItem("sello_user", JSON.stringify(data.user));
          if (data.token) sessionStorage.setItem("sello_token", data.token);
          window.location.href =
            data.user.role === "admin" ? "admin.html" : "index.html";
        } else {
          errText.innerText = data.message;
          errText.style.display = "block";
        }
      } catch (err) {
        errText.innerText = "An error occurred during login.";
        errText.style.display = "block";
      }
    });
}

function setupSignupHandler() {
  document
    .getElementById("signup-form")
    .addEventListener("submit", async (e) => {
      e.preventDefault();
      const username = document.getElementById("signup-username").value.trim();
      const email = document.getElementById("signup-email").value.trim();
      const password = document.getElementById("signup-password").value;
      const confirmPass = document.getElementById(
        "signup-confirm-password",
      ).value;
      const mobile = document.getElementById("signup-mobile").value.trim();
      const errText = document.getElementById("signup-error");

      if (!mobile) {
        errText.innerText = "Mobile number is required.";
        errText.style.display = "block";
        return;
      }

      if (password !== confirmPass) {
        errText.innerText = "Passwords do not match.";
        errText.style.display = "block";
        return;
      }

      try {
        const res = await fetch(`${API_BASE_URL}/signup`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, email, password, mobile }),
        });

        const data = await res.json();
        if (res.ok) {
          alert("Registration successful! Please login.");
          window.location.href = "login.html";
        } else {
          errText.innerText = data.message;
          errText.style.display = "block";
        }
      } catch (err) {
        errText.innerText = "An error occurred during signup.";
        errText.style.display = "block";
      }
    });
}

// ---------------- ADMIN BOARD DASHBOARD UTILITIES ----------------
function checkAdminAccess() {
  const user = getSessionUser();
  if (!user || user.role !== "admin") {
    alert("Access denied.");
    window.location.href = "index.html";
  }
}

async function loadAdminDashboard() {
  const tableBody = document.getElementById("admin-items-table");
  const form = document.getElementById("product-form");
  if (!tableBody) return;

  const cancelBtn = document.getElementById("form-cancel-btn");

  let __adminAllItems = [];

  const renderAdminItemsTable = (items) => {
    tableBody.innerHTML = items
      .map((item) => {
        const topBidValue = getMaxBidFromArray(item.bids);
        const historyRows =
          item.bids && item.bids.length > 0
            ? item.bids
                .map(
                  (b) =>
                    `<div style="border-bottom: 1px dashed #ccc; padding: 2px;">${b.userId}: HK$${b.bidAmount}</div>`,
                )
                .join("")
            : "No bids yet";

        const adminImgSrc = resolveImageSrc(
          item.image,
          "https://placehold.co/50?text=No+Img",
        );

        return `
          <tr>
              <td><img src="${adminImgSrc}" style="width:50px; height:50px; object-fit:cover; border-radius:4px;" onerror="this.src='https://placehold.co/50?text=No+Img'; this.onerror=null;"></td>
              <td>${item.name}</td>
              <td>${item.description}</td>
              <td>HK$${parseFloat(item.price).toFixed(2)}</td>
              <td>${item.discount ? item.discount + '%' : '—'}</td>
              <td>HK$${parseFloat(topBidValue).toFixed(2)}</td>
              <td><span class="status-badge ${
                item.status === "Booked"
                  ? "status-booked"
                  : item.status === "Pickup Scheduled"
                    ? "status-pickup"
                    : item.status === "Sold"
                      ? "status-sold"
                      : "status-available"
              }" style="font-size:0.75rem;padding:2px 8px;">${item.status || "Available"}</span>${item.bookedUser ? " → " + item.bookedUser : ""}</td>
              <td>${item.enabled ? "Enabled" : "Disabled"}</td>
              <td>${historyRows}</td>
              <td class="actions-cell">
                  <button class="btn admin-edit-btn" data-id="${item.id}" style="background-color: #eab308; padding: 0.25rem 0.5rem; font-size: 0.8rem;">Edit</button>
                  <button class="btn admin-del-btn" data-id="${item.id}" style="background-color: var(--danger-color); padding: 0.25rem 0.5rem; font-size: 0.8rem;">Delete</button>
              </td>
          </tr>
        `;
      })
      .join("");
  };

  const filterAdminItems = () => {
    const search =
      document.getElementById("admin-items-search")?.value.toLowerCase() || "";
    const statusFilter =
      document.getElementById("admin-items-filter-status")?.value || "all";
    const visibilityFilter =
      document.getElementById("admin-items-filter-visibility")?.value || "all";

    const filtered = __adminAllItems.filter((item) => {
      const matchesSearch =
        !search ||
        item.name.toLowerCase().includes(search) ||
        item.description.toLowerCase().includes(search);
      const matchesStatus =
        statusFilter === "all" || item.status === statusFilter;
      const matchesVisibility =
        visibilityFilter === "all" ||
        (visibilityFilter === "Enabled" && item.enabled) ||
        (visibilityFilter === "Disabled" && !item.enabled);
      return matchesSearch && matchesStatus && matchesVisibility;
    });

    renderAdminItemsTable(filtered);
  };

  const fetchAdminItems = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/admin/items`, {
        headers: getAuthHeaders(),
      });
      const items = await res.json();
      __adminAllItems = items;
      renderAdminItemsTable(items);

      // Add filter event listeners
      document
        .getElementById("admin-items-search")
        ?.addEventListener("input", filterAdminItems);
      document
        .getElementById("admin-items-filter-status")
        ?.addEventListener("change", filterAdminItems);
      document
        .getElementById("admin-items-filter-visibility")
        ?.addEventListener("change", filterAdminItems);
    } catch (e) {
      tableBody.innerHTML =
        '<tr><td colspan="9" style="color:red;">Failed to load items.</td></tr>';
    }
  };

  // Event delegation for admin table buttons (buttons are rendered dynamically)
  document.addEventListener("click", (e) => {
    if (e.target.classList.contains("admin-edit-btn")) {
      const itemId = e.target.getAttribute("data-id");
      const item = __adminAllItems.find((i) => i.id === itemId);
      if (item) populateEditForm(item);
    }
    if (e.target.classList.contains("admin-del-btn")) {
      const itemId = e.target.getAttribute("data-id");
      deleteItem(itemId, fetchAdminItems);
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("item-id").value;
    const formData = new FormData();
    formData.append("name", document.getElementById("item-name").value);
    formData.append("price", document.getElementById("item-price").value);
    formData.append("discount", document.getElementById("item-discount").value || "0");
    formData.append("description", document.getElementById("item-desc").value);
    formData.append("enabled", document.getElementById("item-enabled").checked);
    formData.append("status", document.getElementById("item-status").value);
    const bookedUserEl = document.getElementById("item-booked-user");
    formData.append("bookedUser", bookedUserEl ? bookedUserEl.value : "");

    const fileInput = document.getElementById("item-image");
    if (fileInput.files[0]) formData.append("image", fileInput.files[0]);

    const url = id
      ? `${API_BASE_URL}/admin/items/${id}`
      : `${API_BASE_URL}/admin/items`;
    const method = id ? "PUT" : "POST";

    try {
      const response = await fetch(url, {
        method,
        body: formData,
        headers: getAuthHeaders(),
      });
      if (response.ok) {
        alert("Product saved successfully.");
        form.reset();
        document.getElementById("item-id").value = "";
        if (cancelBtn) cancelBtn.style.display = "none";
        document.getElementById("form-submit-btn").innerText = "Save Product";
        fetchAdminItems();
      } else {
        alert("Failed to save product.");
      }
    } catch (error) {
      console.error(error);
    }
  });

  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => {
      form.reset();
      document.getElementById("item-id").value = "";
      document.getElementById("item-discount").value = "";
      cancelBtn.style.display = "none";
      document.getElementById("form-submit-btn").innerText = "Save Product";
    });
  }

  fetchAdminItems();
}

function populateEditForm(itemOrItems, id) {
  // Support both: populateEditForm(item) or populateEditForm(items, id)
  const item = id ? itemOrItems.find((i) => i.id === id) : itemOrItems;
  if (!item) return;

  document.getElementById("item-id").value = item.id;
  document.getElementById("item-name").value = item.name;
  document.getElementById("item-price").value = item.price;
  document.getElementById("item-discount").value = item.discount || "";
  document.getElementById("item-desc").value = item.description;
  document.getElementById("item-enabled").checked = item.enabled;

  const statusSel = document.getElementById("item-status");
  if (statusSel) {
    statusSel.value = item.status || "Available";
    statusSel.dispatchEvent(new Event("change"));
  }
  const bookedUserSel = document.getElementById("item-booked-user");
  if (bookedUserSel && item.bookedUser) bookedUserSel.value = item.bookedUser;

  document.getElementById("form-submit-btn").innerText = "Update Product";
  const cancelBtn = document.getElementById("form-cancel-btn");
  if (cancelBtn) cancelBtn.style.display = "inline-block";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// Populate admin user dropdown and toggle visibility based on status.
async function initAdminStatusControls() {
  const statusSel = document.getElementById("item-status");
  const bookedGroup = document.getElementById("booked-user-group");
  const bookedUserSel = document.getElementById("item-booked-user");
  if (!statusSel || !bookedGroup || !bookedUserSel) return;

  try {
    const res = await fetch(`${API_BASE_URL}/admin/users`, {
      headers: getAuthHeaders(),
    });
    const users = await res.json();
    bookedUserSel.innerHTML =
      '<option value="">-- Select User --</option>' +
      users
        .filter((u) => u.role !== "admin")
        .map(
          (u) =>
            `<option value="${u.username}">${u.username} | ${u.email || "no email"} | ${u.mobile || "no mobile"}</option>`,
        )
        .join("");
  } catch (e) {
    console.error("Could not load users for dropdown.");
  }

  const toggle = () => {
    const show =
      statusSel.value === "Booked" ||
      statusSel.value === "Pickup Scheduled" ||
      statusSel.value === "Sold";
    bookedGroup.style.display = show ? "" : "none";
    bookedUserSel.required = show;
  };
  statusSel.addEventListener("change", toggle);
  toggle();
}

// Image lightbox — clicking a card image opens a full-size overlay.
function setupImageLightbox() {
  document.querySelectorAll(".card-img").forEach((img) => {
    img.style.cursor = "pointer";
    img.addEventListener("click", () => {
      const lb = document.getElementById("image-lightbox");
      if (!lb) return;
      document.getElementById("lightbox-img").src = img.src;
      lb.style.display = "flex";
    });
  });
}

async function deleteItem(id, callback) {
  if (!confirm("Are you sure you want to delete this item?")) return;
  try {
    const res = await fetch(`${API_BASE_URL}/admin/items/${id}`, {
      method: "DELETE",
      headers: getAuthHeaders(),
    });
    if (res.ok) {
      alert("Item deleted successfully.");
      callback();
    }
  } catch (err) {
    console.error(err);
  }
}

// ─── ADMIN USER MANAGEMENT ───────────────────────────────────────
async function loadAdminUsers() {
  const tableBody = document.getElementById("admin-users-table");
  if (!tableBody) return;

  const searchEl = document.getElementById("users-search");
  const roleFilterEl = document.getElementById("users-filter-role");
  let __allUsers = [];

  const renderUsers = (users) => {
    tableBody.innerHTML = users
      .map(
        (u) => `
        <tr>
          <td>${escapeHtml(u.username)}</td>
          <td>${u.email ? escapeHtml(u.email) : "—"}</td>
          <td>${u.mobile ? escapeHtml(u.mobile) : "—"}</td>
          <td>${
            u.password
              ? `<span class="pwd-cell" style="font-family:monospace;">
                   <span class="pwd-dots">••••••••</span>
                   <span class="pwd-text" style="display:none;">${escapeHtml(u.password)}</span>
                   <button type="button" class="pwd-toggle" style="margin-left:6px;border:none;background:none;color:var(--primary-color,#4f46e5);cursor:pointer;font-size:0.75rem;">show</button>
                 </span>`
              : '<span style="color:#94a3b8;font-size:0.75rem;">reset to set</span>'
          }</td>
          <td><span class="status-badge ${
            u.role === "admin" ? "status-booked" : "status-available"
          }" style="position:static;width:auto;min-width:0;border-radius:2rem;font-size:0.7rem;padding:2px 10px;">${u.role}</span></td>
          <td>${u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—"}</td>
          <td>${u.lastLogin ? new Date(u.lastLogin).toLocaleString() : "—"}</td>
          <td class="actions-cell">
            <button class="btn user-edit-btn" data-username="${u.username}" style="background-color:#eab308;padding:0.25rem 0.5rem;font-size:0.8rem;">Edit</button>
            ${u.role !== "admin" ? `<button class="btn user-del-btn" data-username="${u.username}" style="background-color:var(--danger-color);padding:0.25rem 0.5rem;font-size:0.8rem;">Delete</button>` : ""}
          </td>
        </tr>
      `,
      )
      .join("");

    document
      .querySelectorAll(".user-edit-btn")
      .forEach((btn) =>
        btn.addEventListener("click", () =>
          editUser(users, btn.getAttribute("data-username")),
        ),
      );
    document
      .querySelectorAll(".user-del-btn")
      .forEach((btn) =>
        btn.addEventListener("click", () =>
          deleteUser(btn.getAttribute("data-username")),
        ),
      );
    document.querySelectorAll(".pwd-toggle").forEach((btn) =>
      btn.addEventListener("click", () => {
        const cell = btn.closest(".pwd-cell");
        const dots = cell.querySelector(".pwd-dots");
        const text = cell.querySelector(".pwd-text");
        const showing = text.style.display !== "none";
        text.style.display = showing ? "none" : "inline";
        dots.style.display = showing ? "inline" : "none";
        btn.textContent = showing ? "show" : "hide";
      }),
    );
  };

  const filterUsers = () => {
    const search = searchEl ? searchEl.value.toLowerCase().trim() : "";
    const role = roleFilterEl ? roleFilterEl.value : "all";

    const filtered = __allUsers.filter((u) => {
      const matchesSearch =
        !search ||
        (u.username || "").toLowerCase().includes(search) ||
        (u.email || "").toLowerCase().includes(search) ||
        (u.mobile || "").toLowerCase().includes(search);
      const matchesRole = role === "all" || u.role === role;
      return matchesSearch && matchesRole;
    });

    renderUsers(filtered);
  };

  try {
    const res = await fetch(`${API_BASE_URL}/admin/users`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) return;
    __allUsers = await res.json();
    renderUsers(__allUsers);

    // Bind filter event listeners
    if (searchEl && !searchEl.dataset.bound) {
      searchEl.dataset.bound = "1";
      searchEl.addEventListener("input", filterUsers);
    }
    if (roleFilterEl && !roleFilterEl.dataset.bound) {
      roleFilterEl.dataset.bound = "1";
      roleFilterEl.addEventListener("change", filterUsers);
    }
  } catch (err) {
    console.error("Failed to load users.");
  }

  const createForm = document.getElementById("user-create-form");
  if (createForm && !createForm.dataset.bound) {
    createForm.dataset.bound = "1";
    createForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const payload = {
        username: document.getElementById("new-user-username").value.trim(),
        email: document.getElementById("new-user-email").value.trim(),
        mobile: document.getElementById("new-user-mobile").value.trim(),
        role: document.getElementById("new-user-role").value,
        password: document.getElementById("new-user-password").value,
      };
      try {
        const res = await fetch(`${API_BASE_URL}/admin/users`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getAuthHeaders() },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          alert("User created.");
          createForm.reset();
          loadAdminUsers();
        } else {
          const data = await res.json();
          alert(data.message || "Failed to create user.");
        }
      } catch (err) {
        alert("Error creating user.");
      }
    });
  }

  const editForm = document.getElementById("user-edit-form");
  const cancelBtn = document.getElementById("user-edit-cancel");
  if (editForm && !editForm.dataset.bound) {
    editForm.dataset.bound = "1";
    editForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const username = document.getElementById("edit-user-orig-username").value;
      const payload = {
        email: document.getElementById("edit-user-email").value,
        mobile: document.getElementById("edit-user-mobile").value,
        role: document.getElementById("edit-user-role").value,
        password: document.getElementById("edit-user-password").value,
      };
      try {
        const res = await fetch(
          `${API_BASE_URL}/admin/users/${encodeURIComponent(username)}`,
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              ...getAuthHeaders(),
            },
            body: JSON.stringify(payload),
          },
        );
        if (res.ok) {
          alert("User updated.");
          document.getElementById("user-edit-panel").style.display = "none";
          loadAdminUsers();
        } else {
          const data = await res.json();
          alert(data.message || "Failed to update user.");
        }
      } catch (err) {
        alert("Error updating user.");
      }
    });
    if (cancelBtn)
      cancelBtn.addEventListener("click", () => {
        document.getElementById("user-edit-panel").style.display = "none";
      });
  }
}

function editUser(users, username) {
  const user = users.find((u) => u.username === username);
  if (!user) return;
  document.getElementById("edit-user-orig-username").value = user.username;
  document.getElementById("edit-user-username").value = user.username;
  document.getElementById("edit-user-email").value = user.email || "";
  document.getElementById("edit-user-mobile").value = user.mobile || "";
  document.getElementById("edit-user-role").value = user.role;
  document.getElementById("edit-user-password").value = "";
  document.getElementById("user-edit-panel").style.display = "";
  document
    .getElementById("user-edit-panel")
    .scrollIntoView({ behavior: "smooth" });
}

async function deleteUser(username) {
  if (!confirm(`Delete user "${username}"?`)) return;
  try {
    const res = await fetch(
      `${API_BASE_URL}/admin/users/${encodeURIComponent(username)}`,
      { method: "DELETE", headers: getAuthHeaders() },
    );
    if (res.ok) {
      alert("User deleted.");
      loadAdminUsers();
    } else {
      const data = await res.json();
      alert(data.message || "Failed to delete user.");
    }
  } catch (err) {
    alert("Error deleting user.");
  }
}

// ─── ADMIN ACTIVITY LOGS ─────────────────────────────────────────
// Map each log type to a badge colour so admins can scan the feed quickly.
const LOG_TYPE_COLORS = {
  signup: "#2563eb",
  login: "#16a34a",
  login_failed: "#f59e0b",
  bid: "#7c3aed",
  booking: "#0891b2",
  email_sent: "#0ea5e9",
  email_failed: "#dc2626",
  user: "#0d9488",
  item: "#64748b",
  error: "#ef4444",
  log: "#94a3b8",
};

async function loadAdminLogs() {
  const tableBody = document.getElementById("admin-logs-table");
  if (!tableBody) return;

  const filterEl = document.getElementById("log-type-filter");
  const countEl = document.getElementById("log-count");
  const type = filterEl ? filterEl.value : "";

  const searchEl = document.getElementById("log-search");
  let __logsCache = [];

  const render = async (cachedLogs) => {
    const selectedType = filterEl ? filterEl.value : type;
    const search = searchEl ? searchEl.value.toLowerCase().trim() : "";

    let logs;
    if (cachedLogs) {
      logs = cachedLogs;
    } else {
      const qs = selectedType
        ? `?type=${encodeURIComponent(selectedType)}`
        : "";
      try {
        const res = await fetch(`${API_BASE_URL}/admin/logs${qs}`, {
          headers: getAuthHeaders(),
        });
        if (!res.ok) {
          tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#ef4444;">Unable to load logs (${res.status}).</td></tr>`;
          return;
        }
        logs = await res.json();
        __logsCache = logs;
      } catch (err) {
        tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#ef4444;">Error loading logs.</td></tr>`;
        return;
      }
    }

    let filtered = logs;
    if (search) {
      filtered = filtered.filter((l) => {
        const hay =
          `${l.user || ""} ${l.message || ""} ${l.details || ""} ${l.type || ""}`.toLowerCase();
        return hay.includes(search);
      });
    }

    if (countEl) countEl.textContent = `${filtered.length} entries`;

    if (!filtered.length) {
      tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#94a3b8;">No activity logged yet.</td></tr>`;
      return;
    }

    tableBody.innerHTML = filtered
      .map((l) => {
        const color = LOG_TYPE_COLORS[l.type] || "#64748b";
        return `
            <tr>
              <td style="white-space:nowrap;font-size:0.8rem;color:#475569;">${new Date(l.timestamp).toLocaleString()}</td>
              <td><span style="display:inline-block;background:${color};color:#fff;border-radius:2rem;font-size:0.7rem;font-weight:600;padding:2px 10px;text-transform:uppercase;">${escapeHtml(l.type)}</span></td>
              <td>${l.user ? escapeHtml(l.user) : "—"}</td>
              <td>${escapeHtml(l.message)}</td>
              <td style="font-size:0.8rem;color:#64748b;">${l.details ? escapeHtml(l.details) : "—"}</td>
            </tr>
          `;
      })
      .join("");
  };

  const fetchLogsAndRender = async () => {
    const selectedType = filterEl ? filterEl.value : type;
    const qs = selectedType ? `?type=${encodeURIComponent(selectedType)}` : "";
    try {
      const res = await fetch(`${API_BASE_URL}/admin/logs${qs}`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#ef4444;">Unable to load logs (${res.status}).</td></tr>`;
        return;
      }
      __logsCache = await res.json();
      render(__logsCache);
    } catch (err) {
      tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#ef4444;">Error loading logs.</td></tr>`;
    }
  };

  await fetchLogsAndRender();

  if (filterEl && !filterEl.dataset.bound) {
    filterEl.dataset.bound = "1";
    filterEl.addEventListener("change", fetchLogsAndRender);
  }

  if (searchEl && !searchEl.dataset.bound) {
    searchEl.dataset.bound = "1";
    searchEl.addEventListener("input", () => render(__logsCache));
  }

  const refreshBtn = document.getElementById("log-refresh-btn");
  if (refreshBtn && !refreshBtn.dataset.bound) {
    refreshBtn.dataset.bound = "1";
    refreshBtn.addEventListener("click", fetchLogsAndRender);
  }

  const clearBtn = document.getElementById("log-clear-btn");
  if (clearBtn && !clearBtn.dataset.bound) {
    clearBtn.dataset.bound = "1";
    clearBtn.addEventListener("click", async () => {
      if (!confirm("Clear all activity logs? This cannot be undone.")) return;
      try {
        const res = await fetch(`${API_BASE_URL}/admin/logs`, {
          method: "DELETE",
          headers: getAuthHeaders(),
        });
        if (res.ok) {
          alert("Logs cleared.");
          render();
        } else {
          alert("Failed to clear logs.");
        }
      } catch (err) {
        alert("Error clearing logs.");
      }
    });
  }
}

// ─── Admin: Visitors dashboard ─────────────────────────────────
async function loadAdminVisitors() {
  const tbody = document.getElementById("admin-visitors-table");
  if (!tbody) return;

  const kpiTotal = document.getElementById("kpi-total");
  const kpiNewToday = document.getElementById("kpi-new-today");
  const kpiReturning = document.getElementById("kpi-returning");
  const kpiActive = document.getElementById("kpi-active");
  const kpiCountries = document.getElementById("kpi-countries");
  const filterCountry = document.getElementById("visitor-country-filter");
  const filterType = document.getElementById("visitor-type-filter");
  const refreshBtn = document.getElementById("visitor-refresh-btn");
  const clearBtn = document.getElementById("visitor-clear-btn");

  let cache = [];

  const render = () => {
    const country = filterCountry?.value || "";
    const type = filterType?.value || "";
    const startToday = new Date();
    startToday.setHours(0, 0, 0, 0);
    const ACTIVE_MS = 5 * 60 * 1000;
    const now = Date.now();

    const total = cache.length;
    const newToday = cache.filter(
      (v) => new Date(v.firstSeen) >= startToday,
    ).length;
    const returning = cache.filter((v) => (v.visitCount || 1) > 1).length;
    const active = cache.filter(
      (v) => now - new Date(v.lastSeen).getTime() <= ACTIVE_MS,
    ).length;
    const countries = new Set(cache.map((v) => v.country).filter(Boolean));

    if (kpiTotal) kpiTotal.textContent = total;
    if (kpiNewToday) kpiNewToday.textContent = newToday;
    if (kpiReturning) kpiReturning.textContent = returning;
    if (kpiActive) kpiActive.textContent = active;
    if (kpiCountries) kpiCountries.textContent = countries.size;

    // Populate country filter once.
    if (filterCountry && !filterCountry.dataset.filled) {
      const opts = ['<option value="">All countries</option>'].concat(
        [...countries]
          .sort()
          .map(
            (c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`,
          ),
      );
      filterCountry.innerHTML = opts.join("");
      filterCountry.dataset.filled = "1";
    }

    let rows = cache;
    if (country) rows = rows.filter((v) => v.country === country);
    if (type === "new") rows = rows.filter((v) => (v.visitCount || 1) === 1);
    if (type === "returning")
      rows = rows.filter((v) => (v.visitCount || 1) > 1);
    if (type === "loggedin") rows = rows.filter((v) => v.user);

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:#94a3b8;">No visitors match these filters.</td></tr>`;
      return;
    }

    tbody.innerHTML = rows
      .map((v) => {
        const isReturning = (v.visitCount || 1) > 1;
        const badge = isReturning
          ? '<span style="background:#0ea5e9;color:#fff;border-radius:2rem;font-size:0.7rem;font-weight:600;padding:2px 10px;">RETURNING</span>'
          : '<span style="background:#22c55e;color:#fff;border-radius:2rem;font-size:0.7rem;font-weight:600;padding:2px 10px;">NEW</span>';
        const loc =
          [v.city, v.region, v.country].filter(Boolean).join(", ") || "—";
        const computerDisplay = v.computerName
          ? escapeHtml(v.computerName)
          : '<span style="color:#94a3b8;">—</span>';
        return `
          <tr>
            <td style="white-space:nowrap;font-size:0.8rem;color:#475569;">${new Date(v.lastSeen).toLocaleString()}</td>
            <td>${badge}</td>
            <td>${v.user ? escapeHtml(v.user) : '<span style="color:#94a3b8;">anonymous</span>'}</td>
            <td>${escapeHtml(loc)}</td>
            <td style="font-size:0.8rem;">${escapeHtml(v.device || "")} · ${escapeHtml(v.browser || "")} · ${escapeHtml(v.os || "")}</td>
            <td style="font-size:0.8rem;">${computerDisplay}</td>
            <td style="font-size:0.8rem;">${escapeHtml(v.lastPath || "")}</td>
            <td style="font-size:0.8rem;color:#64748b;">${escapeHtml(v.referrer || "—")}</td>
            <td style="text-align:center;font-weight:600;">${v.pageViews || 1} <span style="color:#94a3b8;font-weight:400;">/ ${v.visitCount || 1}</span></td>
          </tr>
        `;
      })
      .join("");
  };

  const searchEl = document.getElementById("visitor-search");

  const renderWithSearch = () => {
    const search = searchEl ? searchEl.value.toLowerCase().trim() : "";
    // Temporarily override cache to include search filtering
    const origCache = cache;
    if (search) {
      cache = cache.filter((v) => {
        const hay =
          `${v.user || ""} ${v.city || ""} ${v.region || ""} ${v.country || ""} ${v.device || ""} ${v.browser || ""} ${v.os || ""} ${v.computerName || ""} ${v.lastPath || ""} ${v.referrer || ""}`.toLowerCase();
        return hay.includes(search);
      });
    }
    render();
    cache = origCache;
  };

  const fetchAndRender = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/admin/visitors`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:#ef4444;">Unable to load visitors (${res.status}).</td></tr>`;
        return;
      }
      cache = await res.json();
      // Reset country filter so it repopulates with fresh data.
      if (filterCountry) delete filterCountry.dataset.filled;
      renderWithSearch();
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:#ef4444;">Error loading visitors.</td></tr>`;
    }
  };

  await fetchAndRender();

  filterCountry?.addEventListener("change", renderWithSearch);
  filterType?.addEventListener("change", renderWithSearch);
  if (searchEl && !searchEl.dataset.bound) {
    searchEl.dataset.bound = "1";
    searchEl.addEventListener("input", renderWithSearch);
  }
  refreshBtn?.addEventListener("click", fetchAndRender);
  clearBtn?.addEventListener("click", async () => {
    if (!confirm("Clear all visitor records? This cannot be undone.")) return;
    try {
      const res = await fetch(`${API_BASE_URL}/admin/visitors`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        cache = [];
        render();
      } else {
        alert("Failed to clear visitors.");
      }
    } catch {
      alert("Error clearing visitors.");
    }
  });
}
