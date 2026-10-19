const authService = require("../services/auth.service");

const COOKIE_NAME = "refresh_token";
const cookieOptions = () => ({
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  maxAge: Number(process.env.REFRESH_TTL) * 24 * 60 * 60 * 1000,
  path: "/api/auth",
});

const sendTokens = (res, { accessToken, refreshToken, user }, status = 200) => {
  res.cookie(COOKIE_NAME, refreshToken, cookieOptions());
  res.success({ accessToken, user }, status);
};

const readRefreshToken = (req) =>
  req.cookies?.[COOKIE_NAME] || req.body?.refreshToken;

const register = async (req, res) =>
  sendTokens(res, await authService.register(req.body), 201);

const login = async (req, res) =>
  sendTokens(res, await authService.login(req.body));

const refresh = async (req, res) =>
  sendTokens(res, await authService.refresh(readRefreshToken(req)));

const logout = async (req, res) => {
  await authService.logout(readRefreshToken(req));
  res.clearCookie(COOKIE_NAME, { path: "/api/auth" });
  res.success({ ok: true });
};

const me = async (req, res) => res.success(await authService.me(req.userId));

module.exports = { register, login, refresh, logout, me };
