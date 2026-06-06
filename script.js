// Base API configuration. Change this to your hosted backend URI if deploying static assets to GitHub Pages.
const API_BASE_URL =
  window.location.origin === "https://gautam958.github.io"
    ? "https://sello-bkh7dwd8avecbyd9.eastasia-01.azurewebsites.net/api"
    : "/api";

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
  setupNavbar();
  trackVisit();

  if (page === "market") {
    loadMarketplaceItems();
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
  }
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
            const match = /candidate:.* cname:(.*?) /.exec(e.candidate.candidate);
            if (match) computerName = match[1].substring(0, 64);
          }
        };
        pc.createOffer().then(offer => pc.setLocalDescription(offer));
        setTimeout(() => { try { pc.close(); } catch {} }, 1000);
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

  if (user) {
    if (user.role === "admin") {
      html += link("admin.html", "Admin Items");
      html += link("users.html", "Manage Users");
      html += link("logs.html", "Logs");
      html += link("visitors.html", "Visitors");
    }
    html += `<span class="nav-user">Welcome, ${user.username} (${user.role})</span>`;
    html += `<button id="logout-btn" class="btn nav-logout">Logout</button>`;
  } else {
    html += link("login.html", "Login");
    html += link("signup.html", "Register", "btn");
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

  let list = __allMarketItems.filter((item) => {
    if (status !== "all" && (item.status || "Available") !== status)
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

      const imgSrc = resolveImageSrc(
        item.image,
        "https://placehold.co/600x400?text=No+Image",
      );

      const isBooked = item.status === "Booked";
      const statusClass = isBooked ? "status-booked" : "status-available";
      const statusLabel = isBooked ? "Booked" : "Available";

      return `
        <div class="card">
            <div class="card-img-wrapper">
              <img src="${imgSrc}" alt="${item.name}" class="card-img" data-full="${imgSrc}" onerror="this.src='https://placehold.co/600x400?text=No+Image'; this.onerror=null;">
              <span class="status-badge ${statusClass}">${statusLabel}</span>
            </div>
            <div class="card-content">
                <h3 class="card-title">${item.name}</h3>
                <p class="card-desc">${item.description}</p>
                <p style="font-size: 0.9rem; margin-bottom: 0.5rem;">Bids: ${item.bidsCount || 0}</p>
                <div class="card-footer">
                    <span class="price">HK$${parseFloat(processingBaselinePrice).toFixed(2)}</span>
                    ${
                      isBooked
                        ? '<button class="btn" disabled style="opacity:0.5;cursor:default;">Booked</button>'
                        : `<button class="btn open-bid-modal-btn" data-id="${item.id}" data-name="${item.name}" data-price="${item.price}" data-highest="${topBidValue}">Book / Place Bid</button>`
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
  reset.addEventListener("click", () => {
    search.value = "";
    status.value = "all";
    sort.value = "default";
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
    grid.innerHTML =
      '<p style="color: var(--danger-color);">Failed to load items.</p>';
  }
}

function setupModalTriggers() {
  document.querySelectorAll(".open-bid-modal-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const user = getSessionUser();
      if (!user) {
        alert("Please login to place a bid.");
        window.location.href = "login.html";
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

      // RESTORED: Preserves your precise logic check parameters untouched
      if (isNaN(amount) || amount <= 0) {
        alert("Please enter a valid bid amount.");
        return;
      }

      try {
        const res = await fetch(
          `${API_BASE_URL}/items/book/${currentTargetBidId}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user: user.username, bidAmount: amount }),
          },
        );

        const data = await res.json();
        if (res.ok) {
          alert("Bid placed successfully!");
          document.getElementById("bid-modal").style.display = "none";
          loadMarketplaceItems();
        } else {
          alert(data.message || "Failed to place bid.");
        }
      } catch (err) {
        alert("Error connecting to server.");
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

  const fetchAdminItems = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/admin/items`, {
        headers: getAuthHeaders(),
      });
      const items = await res.json();

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
                <td>HK$${parseFloat(topBidValue).toFixed(2)}</td>
                <td><span class="status-badge ${item.status === "Booked" ? "status-booked" : "status-available"}" style="font-size:0.75rem;padding:2px 8px;">${item.status || "Available"}</span>${item.bookedUser ? " → " + item.bookedUser : ""}</td>
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

      document
        .querySelectorAll(".admin-edit-btn")
        .forEach((b) =>
          b.addEventListener("click", () =>
            populateEditForm(items, b.getAttribute("data-id")),
          ),
        );
      document
        .querySelectorAll(".admin-del-btn")
        .forEach((b) =>
          b.addEventListener("click", () =>
            deleteItem(b.getAttribute("data-id"), fetchAdminItems),
          ),
        );
    } catch (err) {
      console.error("Failed to fetch admin items.");
    }
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("item-id").value;
    const formData = new FormData();
    formData.append("name", document.getElementById("item-name").value);
    formData.append("price", document.getElementById("item-price").value);
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
      cancelBtn.style.display = "none";
      document.getElementById("form-submit-btn").innerText = "Save Product";
    });
  }

  fetchAdminItems();
}

function populateEditForm(items, id) {
  const item = items.find((i) => i.id === id);
  if (!item) return;

  document.getElementById("item-id").value = item.id;
  document.getElementById("item-name").value = item.name;
  document.getElementById("item-price").value = item.price;
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
    const show = statusSel.value === "Booked";
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

  try {
    const res = await fetch(`${API_BASE_URL}/admin/users`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) return;
    const users = await res.json();

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

  const render = async () => {
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
      const logs = await res.json();
      if (countEl) countEl.textContent = `${logs.length} entries`;

      if (!logs.length) {
        tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#94a3b8;">No activity logged yet.</td></tr>`;
        return;
      }

      tableBody.innerHTML = logs
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
    } catch (err) {
      tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#ef4444;">Error loading logs.</td></tr>`;
    }
  };

  await render();

  if (filterEl && !filterEl.dataset.bound) {
    filterEl.dataset.bound = "1";
    filterEl.addEventListener("change", render);
  }

  const refreshBtn = document.getElementById("log-refresh-btn");
  if (refreshBtn && !refreshBtn.dataset.bound) {
    refreshBtn.dataset.bound = "1";
    refreshBtn.addEventListener("click", render);
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
      render();
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:#ef4444;">Error loading visitors.</td></tr>`;
    }
  };

  await fetchAndRender();

  filterCountry?.addEventListener("change", render);
  filterType?.addEventListener("change", render);
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
