require("dotenv/config");
const { PrismaClient } = require("../../generated/prisma/client");
const { PrismaMariaDb } = require("@prisma/adapter-mariadb");

const url = new URL(process.env.DATABASE_URL);

const adapter = new PrismaMariaDb({
  // "localhost" trên Windows đôi khi bị phân giải thành IPv6 (::1) nên kết nối treo
  host: url.hostname === "localhost" ? "127.0.0.1" : url.hostname,
  port: Number(url.port) || 3306,
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: url.pathname.slice(1),
  connectionLimit: 10,
  connectTimeout: 10000,
  allowPublicKeyRetrieval: true, // MySQL 8 với user dùng caching_sha2_password
});

module.exports = new PrismaClient({ adapter });
