const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const signAccessToken = (userId) =>
  jwt.sign({ sub: userId }, process.env.JWT_SECRET, {
    expiresIn: `${process.env.JWT_TTL}m`,
  });

const verifyAccessToken = (token) => jwt.verify(token, process.env.JWT_SECRET);

const generateRefreshToken = () => crypto.randomBytes(48).toString("hex");
const hashToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

const refreshExpiresAt = () =>
  new Date(Date.now() + Number(process.env.REFRESH_TTL) * 24 * 60 * 60 * 1000);

module.exports = {
  signAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  hashToken,
  refreshExpiresAt,
};
