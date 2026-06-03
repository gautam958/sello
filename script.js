// Base API configuration. Change this to your hosted backend URI if deploying static assets to GitHub Pages.
const API_BASE_URL =
  window.location.origin === "https://gautam958.github.io"
    ? "https://sello-bkh7dwd8avecbyd9.eastasia-01.azurewebsites.net/api"
    : "/api";

// Application state configuration initialization
function initApp(page) {
  setupNavbar();

  if (page === "market") {
    loadMarketplaceItems();
  } else if (page === "login") {
    setupLoginHandler();
  } else if (page === "signup") {
    setupSignupHandler();
  } else if (page === "admin") {
    checkAdminAccess();
    loadAdminDashboard();
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
  let html = `<a href="index.html">Home</a>`;

  if (user) {
    if (user.role === "admin") {
      html += `<a href="admin.html">Item Management Dashboard</a>`;
    }
    html += `<span style="margin-left: 1rem; font-weight: 600; color: var(--primary-color);">👋 ${user.username} (${user.role})</span>`;
    html += `<button id="logout-btn" class="btn" style="background-color: var(--danger-color); margin-left: 1rem;">Logout</button>`;
  } else {
    html += `<a href="login.html">Login</a>`;
    html += `<a href="signup.html" class="btn">Register</a>`;
  }
  nav.innerHTML = html;

  document.getElementById("logout-btn")?.addEventListener("click", () => {
    sessionStorage.removeItem("sello_user");
    window.location.href = "index.html";
  });
}

// ---------------- MARKET PLACE VIEW ENGINE ----------------
let currentTargetBidId = null;

async function loadMarketplaceItems() {
  const grid = document.getElementById("items-grid");
  if (!grid) return;

  try {
    const response = await fetch(`${API_BASE_URL}/items`);
    const items = await response.json();
    const visibleItems = items.filter((item) => item.enabled);

    if (visibleItems.length === 0) {
      grid.innerHTML =
        "<p>No active inventory listings have been published matching visibility scopes.</p>";
      return;
    }

    grid.innerHTML = visibleItems
      .map((item) => {
        const topBidValue = getMaxBidFromArray(item.bids);
        const processingBaselinePrice =
          topBidValue > 0 ? topBidValue : item.price;

        // FIXED: Replaces the lowercase database string folder with the capitalized folder name hosted on your server
        let imgSrc = "https://placehold.co/600x400?text=No+Image";
        if (item.image) {
          imgSrc = item.image.startsWith("http")
            ? item.image
            : item.image.replace("/images/", "/Images/");
        }

        return `
          <div class="card">
              <span class="status-badge status-available">Active Offers</span>
              <img src="${imgSrc}" alt="${item.name}" class="card-img" onerror="this.src='https://placehold.co/600x400?text=No+Image'">
              <div class="card-content">
                  <h3 class="card-title">${item.name}</h3>
                  <p class="card-desc">${item.description}</p>
                  <p style="font-size:0.85rem; color:#64748b; margin-bottom:0.5rem;">Total Bids Count: <strong>${item.bids ? item.bids.length : 0}</strong></p>
                  <div class="card-footer">
                      <div>
                          <span style="font-size:0.75rem; display:block; color:#64748b;">Current Allocation Value</span>
                          <span class="price">$${parseFloat(processingBaselinePrice).toFixed(2)}</span>
                      </div>
                      <button class="btn open-bid-modal-btn" data-id="${item.id}" data-name="${item.name}" data-price="${item.price}" data-highest="${topBidValue}">
                          Book / Place Bid
                      </button>
                  </div>
              </div>
          </div>
        `;
      })
      .join("");

    // Safe dynamic binding call loop
    setupModalTriggers();
  } catch (err) {
    grid.innerHTML =
      '<p style="color: var(--danger-color);">Network framework connection exception encountered.</p>';
  }
}

function setupModalTriggers() {
  document.querySelectorAll(".open-bid-modal-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const user = getSessionUser();
      if (!user) {
        alert(
          "Unauthorized access layer block. Please log into an active account structure.",
        );
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
        `$${baselinePrice.toFixed(2)}`;
      document.getElementById("modal-highest-bid").innerText =
        highestBidValue > 0 ? `$${highestBidValue.toFixed(2)}` : "None";
      document.getElementById("bid-amount").value =
        dynamicDefaultValue.toFixed(2);

      document.getElementById("bid-modal").style.display = "flex";
    });
  });
}

// Global Static Declarations for Modal Escape Controls
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

      // RESTORED: Exactly copies your original validation rule parameters
      if (isNaN(amount) || amount <= 0) {
        alert("Please assign a valid positive currency metric layout.");
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
          alert("Bid written successfully. Notification processing triggered!");
          document.getElementById("bid-modal").style.display = "none";
          loadMarketplaceItems();
        } else {
          alert(data.message || "Bidding submission tracking collision event.");
        }
      } catch (err) {
        alert("Could not interface with data handling nodes.");
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
          window.location.href =
            data.user.role === "admin" ? "admin.html" : "index.html";
        } else {
          errText.innerText = data.message;
          errText.style.display = "block";
        }
      } catch (err) {
        errText.innerText = "Connection initialization validation error.";
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
      const errText = document.getElementById("signup-error");

      if (password !== confirmPass) {
        errText.innerText = "Error matching verification key sequence fields.";
        errText.style.display = "block";
        return;
      }

      try {
        const res = await fetch(`${API_BASE_URL}/signup`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, email, password }),
        });

        const data = await res.json();
        if (res.ok) {
          alert(
            "Registration configuration successfully written. Redirecting to login portal context.",
          );
          window.location.href = "login.html";
        } else {
          errText.innerText = data.message;
          errText.style.display = "block";
        }
      } catch (err) {
        errText.innerText =
          "Operational server failure during account creations lifecycle.";
        errText.style.display = "block";
      }
    });
}

// ---------------- ADMIN BOARD DASHBOARD UTILITIES ----------------
function checkAdminAccess() {
  const user = getSessionUser();
  if (!user || user.role !== "admin") {
    alert(
      "Access restriction layer violation. Root credentials signature missing.",
    );
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
      const res = await fetch(`${API_BASE_URL}/items`);
      const items = await res.json();

      tableBody.innerHTML = items
        .map((item) => {
          const topBidValue = getMaxBidFromArray(item.bids);
          const historyRows =
            item.bids && item.bids.length > 0
              ? item.bids
                  .map(
                    (b) =>
                      `<div style="border-bottom:1px dashed #cbd5e1; padding:2px; font-size:0.75rem;">👤 <strong>${b.userId}</strong>: <span style="color:var(--success-color);font-weight:bold;">$${b.bidAmount}</span></div>`,
                  )
                  .join("")
              : '<span style="color:#94a3b8; font-style:italic;">No historical bid nodes</span>';

          // FIXED: Replaces the lowercase database string folder with the capitalized folder name inside admin view
          let adminImgSrc = "https://placehold.co/50?text=No+Img";
          if (item.image) {
            adminImgSrc = item.image.startsWith("http")
              ? item.image
              : item.image.replace("/images/", "/Images/");
          }

          return `
            <tr>
                <td><img src="${adminImgSrc}" style="width:50px; height:50px; object-fit:cover; border-radius:4px;" onerror="this.src='https://placehold.co/50?text=No+Img'"></td>
                <td><strong>${item.name}</strong></td>
                <td style="max-width:200px; font-size:0.8rem; overflow:hidden; text-overflow:ellipsis;">${item.description}</td>
                <td>$${parseFloat(item.price).toFixed(2)}</td>
                <td style="font-weight:700; color:var(--primary-color)">$${parseFloat(topBidValue).toFixed(2)}</td>
                <td>${item.enabled ? "🟢 Visible" : "🔴 Suspended"}</td>
                <td><div style="max-height:80px; overflow-y:auto; background:#f8fafc; padding:4px; border-radius:4px;">${historyRows}</div></td>
                <td class="actions-cell">
                    <button class="btn admin-edit-btn" data-id="${item.id}" style="background-color:#eab308; padding:0.25rem 0.5rem; font-size:0.8rem;">Edit</button>
                    <button class="btn admin-del-btn" data-id="${item.id}" style="background-color:var(--danger-color); padding:0.25rem 0.5rem; font-size:0.8rem;">Delete</button>
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
      console.error("Dashboard list mapping context error.");
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

    const fileInput = document.getElementById("item-image");
    if (fileInput.files[0]) formData.append("image", fileInput.files[0]);

    const url = id
      ? `${API_BASE_URL}/admin/items/${id}`
      : `${API_BASE_URL}/admin/items`;
    const method = id ? "PUT" : "POST";

    try {
      const response = await fetch(url, { method, body: formData });
      if (response.ok) {
        alert("Product record set updated matching definitions.");
        form.reset();
        document.getElementById("item-id").value = "";
        if (cancelBtn) cancelBtn.style.display = "none";
        document.getElementById("form-submit-btn").innerText = "Save Product";
        fetchAdminItems();
      } else {
        alert("Database transaction operation layout tracking fault.");
      }
    } catch (err) {
      console.error(err);
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

  document.getElementById("form-submit-btn").innerText =
    "Update Product Configuration";
  const cancelBtn = document.getElementById("form-cancel-btn");
  if (cancelBtn) cancelBtn.style.display = "inline-block";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deleteItem(id, callback) {
  if (
    !confirm(
      "Are you certain you wish to completely drop this product configuration parameter node?",
    )
  )
    return;
  try {
    const res = await fetch(`${API_BASE_URL}/admin/items/${id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      alert("Item entry completely expunged from context tracking records.");
      callback();
    }
  } catch (err) {
    console.error(err);
  }
}
