const { verifyAccessToken } = require("../utils/jwt");

const authMiddleware = async (req, res, next) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.error("Chưa đăng nhập", 401);
  try {
    req.userId = verifyAccessToken(token).sub;
    next();
  } catch (err) {
    console.log("JWT lỗi:", err.message);
    res.error("Token không hợp lệ hoặc đã hết hạn", 401);
  }
};

module.exports = authMiddleware;
