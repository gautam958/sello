// Base API configuration. Change this to your hosted backend URI if deploying static assets to GitHub Pages.
const API_BASE_URL =
  window.location.origin === "https://gautam958.github.io"
    ? "https://your-deployed-backend-api.com/api"
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
      html += `<a href="admin.html">Item Management</a>`;
    }
    html += `<span style="margin-left: 1rem; font-weight: bold; color: var(--primary-color);">👋 ${user.username}</span>`;
    html += `<button id="logout-btn" class="btn" style="background-color: var(--danger-color); margin-left: 1rem;">Logout</button>`;
  } else {
    html += `<a href="login.html" class="btn">Login</a>`;
    html += `<a href="signup.html" class="btn" style="margin-left: 0.75rem;">Sign Up</a>`;
  }
  nav.innerHTML = html;

  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      sessionStorage.removeItem("sello_user");
      window.location.href = "index.html";
    });
  }
}

// ---------------- MARKET PAGE LOGIC ----------------
async function loadMarketplaceItems() {
  const grid = document.getElementById("items-grid");
  if (!grid) return;

  try {
    const response = await fetch(`${API_BASE_URL}/items`);
    const items = await response.json();

    // Filter out items set to disabled for non-admin viewers
    const visibleItems = items.filter((item) => item.enabled);

    if (visibleItems.length === 0) {
      grid.innerHTML =
        "<p>No items found available for purchase matching criteria.</p>";
      return;
    }

    grid.innerHTML = visibleItems
      .map(
        (item) => `
            <div class="card ${item.status === "Booked" ? "disabled" : ""}">
                <span class="status-badge ${item.status === "Booked" ? "status-booked" : "status-available"}">${item.status}</span>
                <img src="${item.image.startsWith("http") ? item.image : window.location.origin + item.image}" alt="${item.name}" class="card-img" onerror="this.src='https://placehold.co/600x400?text=No+Image'">
                <div class="card-content">
                    <h3 class="card-title">${item.name}</h3>
                    <p class="card-desc">${item.description}</p>
                    <div class="card-footer">
                        <span class="price">$${parseFloat(item.price).toFixed(2)}</span>
                        <button class="btn book-btn" data-id="${item.id}" data-name="${item.name}" data-price="${item.price}" data-highest-bid="${item.highestBid || 0}">
                            Bid Now
                        </button>
                    </div>
                </div>
            </div>
        `,
      )
      .join("");

    document.querySelectorAll(".book-btn").forEach((btn) => {
      btn.addEventListener("click", handleBooking);
    });
  } catch (err) {
    grid.innerHTML =
      '<p style="color: var(--danger-color);">Error fetching product parameters from storage layer.</p>';
    console.error(err);
  }
}

async function handleBooking(e) {
  const user = getSessionUser();
  if (!user) {
    alert("Please login to place bids.");
    window.location.href = "login.html";
    return;
  }

  const itemId = e.target.getAttribute("data-id");
  const itemName = e.target.getAttribute("data-name");
  const itemPrice = parseFloat(e.target.getAttribute("data-price"));

  // Fetch full item data to get bids array for calculating max bid
  try {
    const response = await fetch(`${API_BASE_URL}/items`);
    const items = await response.json();
    const item = items.find((i) => i.id === itemId);
    if (item) {
      const maxBid = getMaxBidFromArray(item.bids);
      showBidModal(itemId, itemName, itemPrice, maxBid, user);
    }
  } catch (err) {
    console.error("Error fetching item data:", err);
  }
}

function showBidModal(itemId, itemName, itemPrice, highestBid, user) {
  const modal = document.getElementById("bid-modal");
  const bidAmountInput = document.getElementById("bid-amount");
  const minBidValue = itemPrice * 0.5;

  document.getElementById("modal-item-name").innerText = itemName;
  document.getElementById("modal-item-price").innerText =
    `$${itemPrice.toFixed(2)}`;
  document.getElementById("modal-highest-bid").innerText =
    highestBid > 0 ? `$${highestBid.toFixed(2)}` : "No bids yet";

  bidAmountInput.value = itemPrice.toFixed(2);
  bidAmountInput.min = minBidValue.toFixed(2);
  bidAmountInput.step = "0.01";

  modal.style.display = "flex";

  document.getElementById("modal-submit-btn").onclick = async () => {
    const bidAmount = parseFloat(bidAmountInput.value);

    if (isNaN(bidAmount) || bidAmount <= 0 || bidAmount < minBidValue) {
      alert(
        `Bid must be greater than 0  and could be not less then 5-10% of the original price ($${minBidValue.toFixed(2)}).`,
      );
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/items/bid/${itemId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user: user.username, bidAmount }),
      });

      const data = await response.json();
      if (response.ok) {
        alert(`Bid of $${bidAmount.toFixed(2)} placed successfully!`);
        modal.style.display = "none";
        loadMarketplaceItems();
      } else {
        alert(data.message || "Failed to place bid.");
      }
    } catch (error) {
      console.error("Bid placement error:", error);
      alert("Error placing bid.");
    }
  };

  document.getElementById("modal-cancel-btn-button").onclick = () => {
    modal.style.display = "none";
  };
}

// Catch outside modal clicks
window.addEventListener("click", (event) => {
  const modal = document.getElementById("bid-modal");
  if (event.target === modal) {
    modal.style.display = "none";
  }
});

// ---------------- LOGIN PAGE LOGIC ----------------
function setupLoginHandler() {
  const form = document.getElementById("login-form");
  const errText = document.getElementById("login-error");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value;

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
    } catch (error) {
      errText.innerText =
        "Unable to establish server-side backend context communication.";
      errText.style.display = "block";
    }
  });
}

function setupSignupHandler() {
  const form = document.getElementById("signup-form");
  const errText = document.getElementById("signup-error");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const username = document.getElementById("signup-username").value.trim();
    const email = document.getElementById("signup-email").value.trim();
    const password = document.getElementById("signup-password").value;
    const confirmPassword = document.getElementById(
      "signup-confirm-password",
    ).value;

    if (!username || !email || !password || !confirmPassword) {
      errText.innerText = "All fields are required.";
      errText.style.display = "block";
      return;
    }

    if (!email.includes("@")) {
      errText.innerText = "Please enter a valid email address.";
      errText.style.display = "block";
      return;
    }

    if (password !== confirmPassword) {
      errText.innerText = "Passwords do not match.";
      errText.style.display = "block";
      return;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, email }),
      });
      const data = await res.json();

      if (res.ok) {
        alert("Registration successful. Please log in.");
        window.location.href = "login.html";
      } else {
        errText.innerText = data.message || "Registration failed.";
        errText.style.display = "block";
      }
    } catch (error) {
      errText.innerText = "Unable to contact server for registration.";
      errText.style.display = "block";
      console.error(error);
    }
  });
}

// ---------------- ADMIN PANEL LOGIC ----------------
function checkAdminAccess() {
  const user = getSessionUser();
  if (!user || user.role !== "admin") {
    alert("Access denied. Administrator privileges required.");
    window.location.href = "index.html";
  }
}

async function loadAdminDashboard() {
  const tableBody = document.getElementById("admin-items-table");
  const form = document.getElementById("product-form");
  const cancelBtn = document.getElementById("form-cancel-btn");
  if (!tableBody) return;

  // Load items function
  const fetchAdminItems = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/items`);
      const items = await response.json();

      tableBody.innerHTML = items
        .map((item) => {
          const bidsCount = (item.bids && item.bids.length) || 0;
          const maxBid = getMaxBidFromArray(item.bids);
          const highestBidDisplay =
            maxBid > 0 ? `$${maxBid.toFixed(2)}` : "No bids";
          const bidsHtml =
            item.bids && item.bids.length > 0
              ? item.bids
                  .map(
                    (bid) =>
                      `<li><strong>${bid.userId}</strong>: $${bid.bidAmount.toFixed(2)} (${new Date(bid.timestamp).toLocaleDateString()})</li>`,
                  )
                  .join("")
              : "<li>No bids placed yet</li>";

          return `
                <tr>
                    <td><img src="${item.image}" style="width:50px; height:50px; object-fit:cover;" onerror="this.src='https://placehold.co/50?text=Err'"></td>
                    <td><strong>${item.name}</strong></td>
                    <td style="max-width:200px; font-size:0.85rem;">${item.description}</td>
                    <td>$${parseFloat(item.price).toFixed(2)}</td>
                    <td><strong>${highestBidDisplay}</strong><br/><span style="font-size:0.8rem; color:#64748b;">${bidsCount} bid(s)</span></td>
                    <td>${item.enabled ? "🟢 Visible" : "🔴 Suspended"}</td>
                    <td style="font-size:0.85rem; max-width:300px;">
                        <details>
                            <summary style="cursor: pointer; color: var(--primary-color); font-weight:600;">View Bids</summary>
                            <ul style="margin-top:0.5rem; padding-left:1.5rem; list-style: none;">
                                ${bidsHtml}
                            </ul>
                        </details>
                    </td>
                    <td class="actions-cell">
                        <button class="btn edit-btn" data-id="${item.id}" style="background-color:#eab308; padding:0.25rem 0.5rem; font-size:0.8rem;">Edit</button>
                        <button class="btn del-btn" data-id="${item.id}" style="background-color:var(--danger-color); padding:0.25rem 0.5rem; font-size:0.8rem;">Delete</button>
                    </td>
                </tr>
            `;
        })
        .join("");

      // Assign events
      document
        .querySelectorAll(".edit-btn")
        .forEach((b) =>
          b.addEventListener("click", () =>
            populateEditForm(items, b.getAttribute("data-id")),
          ),
        );
      document
        .querySelectorAll(".del-btn")
        .forEach((b) =>
          b.addEventListener("click", () =>
            deleteItem(b.getAttribute("data-id")),
          ),
        );
    } catch (err) {
      console.error(
        "Inventory generation processing parsing configuration issue",
        err,
      );
    }
  };

  // Form payload operation
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("item-id").value;
    const name = document.getElementById("item-name").value;
    const price = document.getElementById("item-price").value;
    const description = document.getElementById("item-desc").value;
    const status = document.getElementById("item-status").value;
    const enabled = document.getElementById("item-enabled").checked;
    const imageFile = document.getElementById("item-image").files[0];

    const formData = new FormData();
    formData.append("name", name);
    formData.append("price", price);
    formData.append("description", description);
    formData.append("status", status);
    formData.append("enabled", enabled);
    if (imageFile) formData.append("image", imageFile);

    const url = id
      ? `${API_BASE_URL}/admin/items/${id}`
      : `${API_BASE_URL}/admin/items`;
    const method = id ? "PUT" : "POST";

    try {
      const res = await fetch(url, { method, body: formData });
      if (res.ok) {
        alert("Product parameter mapping updated.");
        form.reset();
        document.getElementById("item-id").value = "";
        cancelBtn.style.display = "none";
        document.getElementById("form-submit-btn").innerText = "Save Product";
        fetchAdminItems();
      } else {
        alert(
          "Failed saving database mutations inside operational execution contexts.",
        );
      }
    } catch (error) {
      console.error(error);
    }
  });

  cancelBtn.addEventListener("click", () => {
    form.reset();
    document.getElementById("item-id").value = "";
    cancelBtn.style.display = "none";
    document.getElementById("form-submit-btn").innerText = "Save Product";
  });

  fetchAdminItems();
}

function populateEditForm(items, id) {
  const item = items.find((i) => i.id === id);
  if (!item) return;

  document.getElementById("item-id").value = item.id;
  document.getElementById("item-name").value = item.name;
  document.getElementById("item-price").value = item.price;
  document.getElementById("item-desc").value = item.description;
  document.getElementById("item-status").value = item.status;
  document.getElementById("item-enabled").checked = item.enabled;

  document.getElementById("form-submit-btn").innerText =
    "Update Product Configuration";
  document.getElementById("form-cancel-btn").style.display = "inline-block";
}

async function deleteItem(id) {
  if (!confirm("Are you certain you wish to delete this entry?")) return;
  try {
    const res = await fetch(`${API_BASE_URL}/admin/items/${id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      alert("Item entry completely expunged.");
      loadAdminDashboard();
    }
  } catch (error) {
    console.error(error);
  }
}
