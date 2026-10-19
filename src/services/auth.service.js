const bcrypt = require("bcrypt");
const prisma = require("../libs/prisma");
const HttpError = require("../utils/httpError");
const {
  signAccessToken,
  generateRefreshToken,
  hashToken,
  refreshExpiresAt,
} = require("../utils/jwt");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const publicUser = (u) => ({ id: u.id, email: u.email, username: u.username });

class AuthService {
  async register({ email, username, password }) {
    email = (email || "").trim().toLowerCase();
    username = (username || "").trim();
    if (!EMAIL_REGEX.test(email))
      throw new HttpError(400, "Email không hợp lệ");
    if (username.length < 3)
      throw new HttpError(400, "Username tối thiểu 3 ký tự");
    if (!password || password.length < 6)
      throw new HttpError(400, "Mật khẩu tối thiểu 6 ký tự");

    const exists = await prisma.user.findFirst({
      where: { OR: [{ email }, { username }] },
    });
    if (exists)
      throw new HttpError(
        409,
        exists.email === email
          ? "Email đã được sử dụng"
          : "Username đã tồn tại",
      );

    const user = await prisma.user.create({
      data: { email, username, password: await bcrypt.hash(password, 10) },
    });
    return this.issueTokens(user);
  }

  async login({ email, password }) {
    const user = await prisma.user.findUnique({
      where: { email: (email || "").trim().toLowerCase() },
    });
    // Cùng một thông báo cho cả "sai email" và "sai mật khẩu" để không lộ email nào tồn tại
    if (!user || !(await bcrypt.compare(password || "", user.password)))
      throw new HttpError(401, "Email hoặc mật khẩu không đúng");
    return this.issueTokens(user);
  }

  async issueTokens(user) {
    const refreshToken = generateRefreshToken();
    await prisma.refreshToken.create({
      data: {
        tokenHash: hashToken(refreshToken),
        userId: user.id,
        expiresAt: refreshExpiresAt(),
      },
    });
    return {
      accessToken: signAccessToken(user.id),
      refreshToken,
      user: publicUser(user),
    };
  }

  async refresh(rawToken) {
    if (!rawToken) throw new HttpError(401, "Thiếu refresh token");
    const tokenHash = hashToken(rawToken);
    const record = await prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!record || record.expiresAt < new Date()) {
      if (record) await prisma.refreshToken.delete({ where: { tokenHash } });
      throw new HttpError(401, "Refresh token không hợp lệ hoặc đã hết hạn");
    }
    await prisma.refreshToken.delete({ where: { tokenHash } }); // xoay vòng
    return this.issueTokens(record.user);
  }

  async logout(rawToken) {
    if (!rawToken) return;
    await prisma.refreshToken.deleteMany({
      where: { tokenHash: hashToken(rawToken) },
    });
  }

  async me(userId) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new HttpError(401, "Người dùng không tồn tại");
    return publicUser(user);
  }
}

module.exports = new AuthService();
