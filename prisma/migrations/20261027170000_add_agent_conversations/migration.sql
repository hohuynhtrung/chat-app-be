-- Add AI conversations and preserve existing agent messages in one conversation per user.
ALTER TABLE `conversations`
    MODIFY `type` ENUM('dm', 'group', 'agent') NOT NULL DEFAULT 'dm';

ALTER TABLE `agent_messages`
    ADD COLUMN `conversationId` VARCHAR(191) NULL;

INSERT INTO `conversations`
    (`id`, `type`, `createdAt`, `updatedAt`, `name`, `lastMessageAt`)
SELECT
    CONCAT('agent_', SHA2(`userId`, 256)),
    'agent',
    MIN(`createdAt`),
    MIN(`createdAt`),
    'Cuộc trò chuyện trước đây',
    MAX(`createdAt`)
FROM `agent_messages`
GROUP BY `userId`;

INSERT INTO `user_conversation` (`conversationId`, `userId`)
SELECT CONCAT('agent_', SHA2(`userId`, 256)), `userId`
FROM `agent_messages`
GROUP BY `userId`;

UPDATE `agent_messages`
SET `conversationId` = CONCAT('agent_', SHA2(`userId`, 256));

ALTER TABLE `agent_messages`
    MODIFY `conversationId` VARCHAR(191) NOT NULL,
    ADD INDEX `agent_messages_userId_conversationId_createdAt_idx` (`userId`, `conversationId`, `createdAt`),
    ADD CONSTRAINT `agent_messages_conversationId_fkey`
        FOREIGN KEY (`conversationId`) REFERENCES `conversations`(`id`)
        ON DELETE CASCADE ON UPDATE CASCADE;
