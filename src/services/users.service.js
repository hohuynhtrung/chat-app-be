const prisma = require("../libs/prisma");
const HttpError = require("../utils/httpError");

class UsersService {
  list() {
    return prisma.user.findMany({
      select: { id: true, username: true },
      orderBy: { username: "asc" },
    });
  }

  async getByUsername(username) {
    const user = await prisma.user.findUnique({
      where: { username },
      select: { id: true, username: true, createdAt: true },
    });
    if (!user) throw new HttpError(404, "Không tìm thấy người dùng");
    return user;
  }
}

module.exports = new UsersService();
