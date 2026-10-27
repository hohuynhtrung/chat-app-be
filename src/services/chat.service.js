const prisma = require("../libs/prisma");
const pusher = require("../libs/pusher");
const HttpError = require("../utils/httpError");

const MAX_CONTENT = 2000;
const memberInclude = {
  userConversations: {
    include: { user: { select: { id: true, username: true } } },
  },
};

const toConversation = (c) => ({
  id: c.id,
  type: c.type,
  name: c.name,
  lastMessageAt: c.lastMessageAt,
  members: c.userConversations.map((m) => m.user),
});

class ChatService {
  async assertMember(userId, conversationId) {
    const m = await prisma.userConversation.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
    if (!m) throw new HttpError(404, "Không tìm thấy cuộc hội thoại");
  }

  async list(userId) {
    const rows = await prisma.conversation.findMany({
      where: {
        type: { in: ["dm", "group"] },
        userConversations: { some: { userId } },
      },
      include: memberInclude,
      orderBy: { lastMessageAt: "desc" },
    });
    return rows.map(toConversation);
  }

  async create(userId, body) {
    const type = body.type || "dm";
    if (type === "dm") return this.createDm(userId, body.userId);
    if (type === "group") return this.createGroup(userId, body);
    throw new HttpError(400, "type phải là dm hoặc group");
  }

  async createDm(userId, otherId) {
    if (!otherId) throw new HttpError(400, "Thiếu userId");
    if (otherId === userId)
      throw new HttpError(400, "Không thể chat với chính mình");
    const other = await prisma.user.findUnique({ where: { id: otherId } });
    if (!other) throw new HttpError(404, "Người dùng không tồn tại");

    const dmKey = [userId, otherId].sort().join(":");
    const existing = await prisma.conversation.findUnique({
      where: { dmKey },
      include: memberInclude,
    });
    if (existing) return toConversation(existing);

    const created = await prisma.conversation.create({
      data: {
        type: "dm",
        dmKey,
        userConversations: { create: [{ userId }, { userId: otherId }] },
      },
      include: memberInclude,
    });
    return toConversation(created);
  }

  async createGroup(userId, { name, memberIds }) {
    name = (name || "").trim();
    if (!name) throw new HttpError(400, "Vui lòng nhập tên nhóm");
    const ids = [...new Set([...(memberIds || []), userId])];
    if (ids.length < 3)
      throw new HttpError(400, "Nhóm cần ít nhất 3 thành viên");

    const count = await prisma.user.count({ where: { id: { in: ids } } });
    if (count !== ids.length)
      throw new HttpError(400, "Có thành viên không tồn tại");

    const created = await prisma.conversation.create({
      data: {
        type: "group",
        name,
        userConversations: { create: ids.map((id) => ({ userId: id })) },
      },
      include: memberInclude,
    });
    return toConversation(created);
  }

  async remove(userId, conversationId) {
    await this.assertMember(userId, conversationId);
    await prisma.conversation.delete({ where: { id: conversationId } }); // cascade
  }

  async listMessages(userId, conversationId, { cursor, limit }) {
    await this.assertMember(userId, conversationId);
    const take = Math.min(Math.max(parseInt(limit) || 20, 1), 50);

    const rows = await prisma.message.findMany({
      where: { conversationId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { sender: { select: { id: true, username: true } } },
    });

    const hasMore = rows.length > take;
    const page = rows.slice(0, take);
    return {
      items: page.reverse(), // cũ -> mới
      nextCursor: hasMore ? rows[take - 1].id : null,
    };
  }

  async sendMessage(userId, conversationId, content) {
    await this.assertMember(userId, conversationId);
    content = (content || "").trim();
    if (!content) throw new HttpError(400, "Tin nhắn không được để trống");
    if (content.length > MAX_CONTENT)
      throw new HttpError(400, `Tin nhắn tối đa ${MAX_CONTENT} ký tự`);

    const [message] = await prisma.$transaction([
      prisma.message.create({
        data: { content, conversationId, senderId: userId },
        include: { sender: { select: { id: true, username: true } } },
      }),
      prisma.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: new Date() },
      }),
    ]);

    try {
      await pusher.trigger(
        `conversation-${conversationId}`,
        "message:created",
        message,
      );
    } catch (err) {
      console.error("Pusher lỗi:", err.message);
    }
    return message;
  }
}

module.exports = new ChatService();
