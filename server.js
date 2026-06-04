const express = require("express");
const fs = require("fs-extra");
const path = require("path");
const cors = require("cors");
const multer = require("multer");
const nodemailer = require("nodemailer");

const app = express();
const PORT = process.env.PORT || 3000;

// Configure CORS to accept requests from your production frontend site
app.use(
  cors({
    origin: "https://gautam958.github.io",
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
  }),
);

app.use(express.json());

// Path Definitions
const USERS_FILE = path.join(__dirname, "users.json");
const ITEMS_FILE = path.join(__dirname, "items.json");
const UPLOAD_DIR = path.resolve("./Images"); // ✅ fixed

// Ensure image upload directory exists
fs.ensureDirSync(UPLOAD_DIR);

// Serve static assets
app.use("/Images", express.static(UPLOAD_DIR));
console.log(
  `📁 Static asset hosting configured for directory: ${UPLOAD_DIR} at route path: /Images`,
);

// Multer storage engine
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});
const upload = multer({ storage });

// Nodemailer transporter
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "your-email-address@gmail.com",
    pass: "your-app-password",
  },
});

// Helpers
const readData = async (file) => JSON.parse(await fs.readFile(file, "utf8"));
const writeData = async (file, data) =>
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf8");

// ---------------- REST API ENDPOINTS ----------------

// USER REGISTRATION
app.post("/api/signup", async (req, res) => {
  const { username, email, password } = req.body;
  try {
    const users = await readData(USERS_FILE);
    if (users.find((u) => u.username === username)) {
      return res.status(400).json({ message: "Username already indexed." });
    }
    const newUser = {
      username,
      email,
      password,
      role: "user",
      createdAt: new Date().toISOString(),
    };
    users.push(newUser);
    await writeData(USERS_FILE, users);
    res.status(201).json({ message: "Account created successfully." });
  } catch {
    res
      .status(500)
      .json({ message: "Error mapping signup persistence arrays." });
  }
});

// USER LOGIN
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
        .json({ message: "Invalid operational credentials." });
    }

    const timestamp = new Date().toISOString();
    users[userIndex].lastLogin = timestamp;
    await writeData(USERS_FILE, users);

    const cleanUser = { ...users[userIndex] };
    delete cleanUser.password;

    // Email alert
    const loginMailOptions = {
      from: '"Sello Security Operations" <your-email-address@gmail.com>',
      to: "gautam958@gmail.com",
      subject: `🛡️ Security Alert: User Login Tracked [${cleanUser.username}]`,
      html: `<p>User ${cleanUser.username} logged in at ${new Date(timestamp).toUTCString()}</p>`,
    };
    transporter.sendMail(loginMailOptions, (error, info) => {
      if (error) console.error("Login alert failed:", error);
      else console.log("Login alert sent:", info.response);
    });

    res.json({ message: "Authentication successful.", user: cleanUser });
  } catch {
    res.status(500).json({ message: "Internal runtime server context error." });
  }
});

// READ ITEMS
app.get("/api/items", async (req, res) => {
  try {
    const items = await readData(ITEMS_FILE);
    res.json(items);
  } catch {
    res.status(500).json({ message: "Data fetch layer breakdown anomaly." });
  }
});

// BOOK ITEM / BID
app.post("/api/items/book/:id", async (req, res) => {
  const itemId = req.params.id;
  const { user, bidAmount } = req.body;
  try {
    const items = await readData(ITEMS_FILE);
    const target = items.find((i) => i.id === itemId);
    if (!target)
      return res.status(404).json({ message: "Target item record missing." });

    if (!target.bids) target.bids = [];
    const parsedBid = parseFloat(bidAmount);
    const currentHighestBid =
      target.bids.length > 0
        ? Math.max(...target.bids.map((b) => b.bidAmount))
        : target.price;

    if (parsedBid < currentHighestBid) {
      return res.status(400).json({
        message: `Bid must equal or exceed current high valuation of $${currentHighestBid}`,
      });
    }

    const newBidEntry = {
      userId: user,
      bidAmount: parsedBid,
      timestamp: new Date().toISOString(),
    };
    target.bids.push(newBidEntry);
    target.highestBid = parsedBid;
    await writeData(ITEMS_FILE, items);

    res.json({ message: "Bid accepted and written safely.", item: target });
  } catch {
    res
      .status(500)
      .json({ message: "Error mapping bid collection structural entries." });
  }
});

// ADMIN: CREATE PRODUCT
app.post("/api/admin/items", upload.single("Image"), async (req, res) => {
  try {
    const items = await readData(ITEMS_FILE);
    const newItem = {
      id: Date.now().toString(),
      name: req.body.name,
      description: req.body.description,
      price: parseFloat(req.body.price),
      status: "Available",
      image: req.file ? req.file.filename : "default.jpg",
      enabled: req.body.enabled === "true",
      bids: [],
      highestBid: 0,
    };
    items.push(newItem);
    await writeData(ITEMS_FILE, items);
    res.status(201).json(newItem);
  } catch {
    res
      .status(500)
      .json({
        message: "Failure appending new product configuration parameters.",
      });
  }
});

// ADMIN: UPDATE PRODUCT
app.put("/api/admin/items/:id", upload.single("Image"), async (req, res) => {
  const id = req.params.id;
  try {
    const items = await readData(ITEMS_FILE);
    const idx = items.findIndex((i) => i.id === id);
    if (idx === -1)
      return res.status(404).json({ message: "Item profile missing." });

    const priceValue = parseFloat(req.body.price);
    if (isNaN(priceValue)) {
      return res.status(400).json({ message: "Invalid price value." });
    }

    const updatedFields = {
      name: req.body.name || items[idx].name,
      description: req.body.description || items[idx].description,
      price: priceValue,
      enabled: req.body.enabled === "true",
    };

    if (req.file) {
      const legacyImage = items[idx].image;
      if (legacyImage && legacyImage !== "default.jpg") {
        await fs.remove(path.join(UPLOAD_DIR, legacyImage)).catch(() => {});
      }
      updatedFields.image = req.file.filename;
    }

    items[idx] = { ...items[idx], ...updatedFields };
    await writeData(ITEMS_FILE, items);
    res.json(items[idx]);
  } catch (error) {
    console.error("Update error:", error);
    res.status(500).json({ message: "Failed to save product." });
  }
});

// ADMIN: DELETE PRODUCT
app.delete("/api/admin/items/:id", async (req, res) => {
  const id = req.params.id;
  try {
    let items = await readData(ITEMS_FILE);
    const targetItem = items.find((i) => i.id === id);

    if (targetItem && targetItem.image && targetItem.image !== "default.jpg") {
      await fs.remove(path.join(UPLOAD_DIR, targetItem.image)).catch(() => {});
    }

    items = items.filter((i) => i.id !== id);
    await writeData(ITEMS_FILE, items);
    res.json({ message: "Item Removed Successfully." });
  } catch {
    res.status(500).json({ message: "Drop tracking mapping indices fault." });
  }
});

app.get("/", (req, res) =>
  res.send(
    "Sello Dynamic Host Engine Operational. Use API endpoints to exchange resources.",
  ),
);

app.listen(PORT, () => {
  console.log(`🚀 Sello Unified Engine online at: http://localhost:${PORT}`);
});
