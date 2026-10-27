const prisma = require("../libs/prisma");
const HttpError = require("../utils/httpError");

const isAgentConversation = {
  type: "agent",
};
const MAX_CONVERSATION_NAME_LENGTH = 100;

class AgentConversationService {
  async list(userId) {
    return prisma.conversation.findMany({
      where: {
        ...isAgentConversation,
        userConversations: { some: { userId } },
      },
      select: {
        id: true,
        name: true,
        createdAt: true,
        updatedAt: true,
        lastMessageAt: true,
        agentMessages: {
          where: { thinking: false },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 1,
          select: { content: true, createdAt: true },
        },
      },
      orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
    });
  }

  async create(userId) {
    return prisma.conversation.create({
      data: {
        type: "agent",
        name: "Cuộc trò chuyện mới",
        userConversations: {
          create: { userId },
        },
      },
      select: {
        id: true,
        name: true,
        createdAt: true,
        updatedAt: true,
        lastMessageAt: true,
      },
    });
  }

  async getMessages(userId, conversationId) {
    await this.assertOwnedConversation(userId, conversationId);

    return prisma.agentMessage.findMany({
      where: {
        userId,
        conversationId,
        thinking: false,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
  }

  async rename(userId, conversationId, name) {
    await this.assertOwnedConversation(userId, conversationId);

    if (typeof name !== "string" || !name.trim()) {
      throw new HttpError(400, "Tên cuộc trò chuyện không được để trống.");
    }

    const normalizedName = name.trim();
    if (normalizedName.length > MAX_CONVERSATION_NAME_LENGTH) {
      throw new HttpError(
        400,
        `Tên cuộc trò chuyện tối đa ${MAX_CONVERSATION_NAME_LENGTH} ký tự.`,
      );
    }

    return prisma.conversation.update({
      where: { id: conversationId },
      data: { name: normalizedName },
      select: {
        id: true,
        name: true,
        createdAt: true,
        updatedAt: true,
        lastMessageAt: true,
      },
    });
  }

  async delete(userId, conversationId) {
    await this.assertOwnedConversation(userId, conversationId);

    const result = await prisma.conversation.deleteMany({
      where: {
        id: conversationId,
        ...isAgentConversation,
        userConversations: { some: { userId } },
      },
    });

    if (result.count === 0) {
      throw new HttpError(404, "Không tìm thấy cuộc trò chuyện AI.");
    }

    return { id: conversationId };
  }

  async assertOwnedConversation(userId, conversationId) {
    if (typeof conversationId !== "string" || !conversationId.trim()) {
      throw new HttpError(400, "Thiếu conversationId hợp lệ.");
    }

    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        ...isAgentConversation,
        userConversations: { some: { userId } },
      },
      select: { id: true, name: true },
    });

    if (!conversation) {
      throw new HttpError(404, "Không tìm thấy cuộc trò chuyện AI.");
    }

    return conversation;
  }
}

module.exports = new AgentConversationService();
