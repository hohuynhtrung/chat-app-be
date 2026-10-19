require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");

const response = require("./src/middlewares/response.middleware");
const errorHandler = require("./src/middlewares/error.middleware");
const routes = require("./src/routes");

const app = express();

app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(response);

app.use("/api", routes);

app.use((req, res) => res.error("Không tìm thấy endpoint", 404));
app.use(errorHandler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API chạy tại http://localhost:${PORT}`));
