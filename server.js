const express = require("express");
const fs = require("fs-extra");
const path = require("path");
const cors = require("cors");
const multer = require("multer");
const nodemailer = require("nodemailer");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware setups
// Allow requests from your GitHub Pages site
app.use(
  cors({
    origin: "https://gautam958.github.io",
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
  }),
);

app.use(express.json());
app.use(express.static(__dirname));
// Path Definitions
const USERS_FILE = path.join(__dirname, "users.json");
const ITEMS_FILE = path.join(__dirname, "items.json");
const UPLOAD_DIR = path.join(__dirname, "Images");

// Ensure image upload architecture structure space exists
fs.ensureDirSync(UPLOAD_DIR);

// Storage Engine Config for Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});
const upload = multer({ storage: storage });

// Email Transporter Layer Initialization (Configure via environment files optimally)
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "gautam958@gmail.com", // Replace with system outbox email account
    pass: "whnp dbfr xfvy xusm", // Replace with system security App Password (NOT regular password)
  },
});

// Verify email connection on startup
transporter.verify((error, success) => {
  if (error) {
    console.error(
      "❌ EMAIL SERVICE OFFLINE - Check credentials:",
      error.message,
    );
    console.error(
      "⚠️  Note: Gmail requires an APP-SPECIFIC PASSWORD, not your regular password.",
    );
    console.error(
      "📱 Generate one at: https://myaccount.google.com/apppasswords",
    );
  } else {
    console.log("✅ EMAIL SERVICE ONLINE - Ready to send notifications");
  }
});

// Helper validation handlers
const readData = async (file) => JSON.parse(await fs.readFile(file, "utf8"));
const writeData = async (file, data) =>
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf8");

const requireAuth = (req, res, next) => {
  const { user } = req.body;
  if (!user || typeof user !== "string" || !user.trim()) {
    return res
      .status(401)
      .json({ message: "Authentication required to book items." });
  }
  next();
};

// ---------------- REST APIS ENDPOINTS ----------------

app.get("/", (req, res) => {
  res.send("API is running");
});

// USER REGISTRATION ROOT
app.post("/api/register", async (req, res) => {
  const { username, password, email } = req.body;
  const normalizedEmail = email ? email.trim().toLowerCase() : "";

  if (
    !username ||
    !username.trim() ||
    !password ||
    !normalizedEmail ||
    !normalizedEmail.includes("@")
  ) {
    return res.status(400).json({
      message: "Username, password, and a valid email address are required.",
    });
  }

  try {
    const users = await readData(USERS_FILE);
    const existingUsername = users.find((u) => u.username === username);
    const existingEmail = users.find((u) => u.email === normalizedEmail);
    if (existingUsername) {
      return res
        .status(409)
        .json({ message: "This username is already registered." });
    }
    if (existingEmail) {
      return res
        .status(409)
        .json({ message: "This email is already registered." });
    }

    const newUser = {
      username,
      password,
      email: normalizedEmail,
      role: "user",
      createdAt: new Date().toISOString(),
    };

    users.push(newUser);
    await writeData(USERS_FILE, users);

    const mailOptions = {
      from: "gautam958@gmail.com",
      to: "gautam958@gmail.com",
      subject: `New user registered: ${username}`,
      html: `
        <h2>New registration received</h2>
        <p><strong>Username:</strong> ${username}</p>
        <p><strong>Email:</strong> ${normalizedEmail}</p>
        <p><strong>Role:</strong> user</p>
        <p><strong>Registered at:</strong> ${new Date().toUTCString()}</p>
      `,
    };

    try {
      await transporter.sendMail(mailOptions);
      console.log("✅ Signup notification email sent to admin");
    } catch (emailError) {
      console.error("❌ Signup notification email failed:", emailError.message);
    }

    const cleanUser = {
      username: newUser.username,
      email: newUser.email,
      role: newUser.role,
      createdAt: newUser.createdAt,
    };

    res
      .status(201)
      .json({ message: "Registration successful.", user: cleanUser });
  } catch (err) {
    res.status(500).json({ message: "Unable to complete registration." });
  }
});

// USER SIGN IN ROOT
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  try {
    const users = await readData(USERS_FILE);
    const userIndex = users.findIndex(
      (u) => u.username === username && u.password === password,
    );

    if (userIndex === -1) {
      return res
        .status(401)
        .json({ message: "Invalid transactional security identifiers." });
    }

    users[userIndex].lastLogin = new Date().toISOString();
    await writeData(USERS_FILE, users);

    // Delete password from client transmission parameters
    const cleanUser = { ...users[userIndex] };
    delete cleanUser.password;

    res.json({ message: "Authentication mapping verified.", user: cleanUser });
  } catch (err) {
    res.status(500).json({ message: "Internal server logic context error." });
  }
});

// READ OPERATIONS ITEMS
app.get("/api/items", async (req, res) => {
  try {
    const items = await readData(ITEMS_FILE);
    res.json(items);
  } catch (err) {
    res.status(500).json({ message: "Data fetch failed." });
  }
});

// ORDER AND BOOK TRANSACTION PROCESS HANDLER
app.post("/api/items/book/:id", requireAuth, async (req, res) => {
  const itemId = req.params.id;
  const { user } = req.body;

  try {
    const users = await readData(USERS_FILE);
    const bookingUser = users.find((u) => u.username === user);
    if (!bookingUser || !bookingUser.email) {
      return res.status(401).json({
        message:
          "Booking requires a logged-in account with a registered email.",
      });
    }

    const items = await readData(ITEMS_FILE);
    const target = items.find((i) => i.id === itemId);

    if (!target)
      return res
        .status(404)
        .json({ message: "Target profile object missing." });
    if (target.status === "Booked")
      return res
        .status(400)
        .json({ message: "Collision event: Resource locked." });

    // Mutation parameters mapping configuration
    target.status = "Booked";
    await writeData(ITEMS_FILE, items);

    // Dispatches system transactional email to the booking user
    const mailOptions = {
      from: "gautam958@gmail.com",
      to: bookingUser.email,
      subject: `Your Sello booking is confirmed: ${target.name}`,
      headers: {
        "X-Priority": "1",
        "X-MSMail-Priority": "High",
        Importance: "high",
      },
      html: `
                <h2>Booking Confirmation</h2>
                <hr/>
                <p><strong>Item:</strong> ${target.name}</p>
                <p><strong>Price:</strong> $${target.price}</p>
                <p><strong>Status:</strong> ${target.status}</p>
                <p><strong>Booked by:</strong> ${bookingUser.username}</p>
                <p><strong>Recipient email:</strong> ${bookingUser.email}</p>
                <p><strong>Timestamp:</strong> ${new Date().toUTCString()}</p>
            `,
    };

    try {
      await transporter.sendMail(mailOptions);
      console.log("✅ Booking confirmation email sent to:", bookingUser.email);
    } catch (emailError) {
      console.error(
        "❌ Booking confirmation email failed:",
        emailError.message,
      );
    }

    res.json({
      message: "Asset booking confirmed successfully.",
      item: target,
    });
  } catch (err) {
    res
      .status(500)
      .json({ message: "Error mapping allocation tracking mutations." });
  }
});

// ADMIN: CREATE OPERATION
app.post("/api/admin/items", upload.single("image"), async (req, res) => {
  try {
    const items = await readData(ITEMS_FILE);
    const newItem = {
      id: Date.now().toString(),
      name: req.body.name,
      description: req.body.description,
      price: parseFloat(req.body.price),
      status: req.body.status || "Available",
      image: req.file ? `/images/${req.file.filename}` : "/images/default.jpg",
      enabled: req.body.enabled === "true",
      bids: [],
      highestBid: 0,
    };

    items.push(newItem);
    await writeData(ITEMS_FILE, items);
    res.status(211).json(newItem);
  } catch (err) {
    res
      .status(500)
      .json({ message: "Failure appending parameters context matrix." });
  }
});

// PLACE BID ENDPOINT
app.post("/api/items/bid/:id", requireAuth, async (req, res) => {
  const itemId = req.params.id;
  const { user, bidAmount } = req.body;

  try {
    const users = await readData(USERS_FILE);
    const biddingUser = users.find((u) => u.username === user);
    if (!biddingUser || !biddingUser.email) {
      return res.status(401).json({
        message:
          "Bidding requires a logged-in account with a registered email.",
      });
    }

    const items = await readData(ITEMS_FILE);
    const target = items.find((i) => i.id === itemId);

    if (!target) return res.status(404).json({ message: "Item not found." });

    if (!target.enabled)
      return res
        .status(400)
        .json({ message: "Item is not available for bidding." });

    const bidAmountNum = parseFloat(bidAmount);
    const minBidPrice = target.price * 0.5;

    if (isNaN(bidAmountNum) || bidAmountNum <= 0) {
      return res.status(400).json({
        message: "Bid amount must be greater than 0.",
      });
    }

    if (bidAmountNum < minBidPrice) {
      return res.status(400).json({
        message: `Bid must be greater than 0  and could be not less then 5-10% of the original price ($${minBidPrice.toFixed(2)}).`,
      });
    }

    if (!target.bids) target.bids = [];
    if (target.highestBid === undefined) target.highestBid = 0;

    target.bids.push({
      userId: biddingUser.username,
      bidAmount: bidAmountNum,
      timestamp: new Date().toISOString(),
    });

    // Calculate highest bid as max from bids array
    target.highestBid = Math.max(
      ...target.bids.map((bid) => bid.bidAmount || 0),
    );
    await writeData(ITEMS_FILE, items);

    const mailOptions = {
      from: "gautam958@gmail.com",
      to: biddingUser.email,
      subject: `Your bid on ${target.name} has been placed!`,
      headers: {
        "X-Priority": "1",
        "X-MSMail-Priority": "High",
        Importance: "high",
      },
      html: `
        <h2>Bid Confirmation</h2>
        <hr/>
        <p><strong>Item:</strong> ${target.name}</p>
        <p><strong>Your Bid:</strong> $${bidAmountNum.toFixed(2)}</p>
        <p><strong>Minimum Price:</strong> $${target.price}</p>
        <p><strong>Current Highest Bid:</strong> $${target.highestBid.toFixed(2)}</p>
        <p><strong>Timestamp:</strong> ${new Date().toUTCString()}</p>
      `,
    };

    try {
      await transporter.sendMail(mailOptions);
      console.log("✅ Bid confirmation email sent to:", biddingUser.email);
    } catch (emailError) {
      console.error("❌ Bid confirmation email failed:", emailError.message);
    }

    res.json({
      message: "Bid placed successfully.",
      item: target,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error processing bid." });
  }
});

// ADMIN: UPDATE OPERATION
app.put("/api/admin/items/:id", upload.single("image"), async (req, res) => {
  const id = req.params.id;
  try {
    const items = await readData(ITEMS_FILE);
    const idx = items.findIndex((i) => i.id === id);
    if (idx === -1)
      return res
        .status(404)
        .json({ message: "Target structural metadata not indexed." });

    const updatedFields = {
      name: req.body.name,
      description: req.body.description,
      price: parseFloat(req.body.price),
      status: req.body.status,
      enabled: req.body.enabled === "true",
    };

    // Replace/update image logic file allocations
    if (req.file) {
      const legacyImage = items[idx].image;
      if (legacyImage && !legacyImage.endsWith("default.jpg")) {
        await fs.remove(path.join(__dirname, legacyImage)).catch(() => {});
      }
      updatedFields.image = `/images/${req.file.filename}`;
    }

    items[idx] = { ...items[idx], ...updatedFields };
    await writeData(ITEMS_FILE, items);
    res.json(items[idx]);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Mutation processes interface tracking fault." });
  }
});

// ADMIN: REMOVE OPERATION
app.delete("/api/admin/items/:id", async (req, res) => {
  const id = req.params.id;
  try {
    let items = await readData(ITEMS_FILE);
    const targetItem = items.find((i) => i.id === id);

    if (
      targetItem &&
      targetItem.image &&
      !targetItem.image.endsWith("default.jpg")
    ) {
      await fs.remove(path.join(__dirname, targetItem.image)).catch(() => {});
    }

    items = items.filter((i) => i.id !== id);
    await writeData(ITEMS_FILE, items);
    res.json({
      message: "Item Removed Successfully.",
    });
  } catch (err) {
    res.status(500).json({ message: "Drop context array integrity fault." });
  }
});

// Catch-all route to serve the SPA setup cleanly
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(
    `🚀 Sello Unified Server actively deployed and executing at context path http://localhost:${PORT}`,
  );
});
