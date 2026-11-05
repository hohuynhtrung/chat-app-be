const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const http = require("node:http");
const Module = require("node:module");
const test = require("node:test");
const express = require("express");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = "speech-test-secret";
process.env.JWT_TTL = "60";
process.env.STT_MODEL = "openai/test-transcription-model";

let transcriptionResult = { text: "  xin chào  " };
let transcriptionError = null;
const transcriptionCalls = [];
let multerOptions;

class MockMulterError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

const mockMulter = (options) => {
  multerOptions = options;
  return {
    single: (fieldName) => (req, res, next) => {
      req.body = {
        language: req.headers["x-test-language"],
      };

      if (req.headers["x-test-file"] !== "present") {
        return next();
      }

      const size = Number(req.headers["x-test-file-size"] || 16);
      if (size > options.limits.fileSize) {
        return next(new MockMulterError("LIMIT_FILE_SIZE"));
      }

      const file = {
        fieldname: fieldName,
        mimetype: req.headers["x-test-file-type"] || "audio/webm",
        buffer: Buffer.from("test audio"),
        size,
      };

      options.fileFilter(req, file, (error, accepted) => {
        if (error) return next(error);
        if (accepted) req.file = file;
        return next();
      });
    },
  };
};
mockMulter.memoryStorage = () => ({ type: "memory" });
mockMulter.MulterError = MockMulterError;

const originalLoad = Module._load;
Module._load = function loadWithMocks(request, parent, isMain) {
  if (request === "multer") return mockMulter;
  if (request === "ai") {
    return {
      experimental_transcribe: async (options) => {
        transcriptionCalls.push(options);
        if (transcriptionError) throw transcriptionError;
        return transcriptionResult;
      },
      gateway: {
        transcriptionModel: (modelId) => ({ modelId }),
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const speechRoute = require("../src/routes/speech.route");
Module._load = originalLoad;

const app = express();
app.use((req, res, next) => {
  res.success = (data, statusCode = 200) =>
    res.status(statusCode).json({ success: true, data });
  res.error = (message, statusCode = 400) =>
    res.status(statusCode).json({ success: false, message });
  next();
});
app.use("/api/speech", speechRoute);

let server;
test.before(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
});

test.after(async () => {
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

const request = async ({ userId, audio = true, mimeType, size, language } = {}) => {
  const headers = {};
  if (userId) {
    headers.authorization = `Bearer ${jwt.sign(
      { sub: userId },
      process.env.JWT_SECRET,
      { expiresIn: "1h" },
    )}`;
  }
  if (audio) headers["x-test-file"] = "present";
  if (mimeType) headers["x-test-file-type"] = mimeType;
  if (size !== undefined) headers["x-test-file-size"] = String(size);
  if (language) headers["x-test-language"] = language;

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/speech/transcribe`, {
    method: "POST",
    headers,
  });
  return { status: response.status, body: await response.json() };
};

test("upload cấu hình memoryStorage và giới hạn 5MB", () => {
  assert.deepEqual(multerOptions.storage, { type: "memory" });
  assert.equal(multerOptions.limits.fileSize, 5 * 1024 * 1024);
});

test("từ chối yêu cầu chưa đăng nhập", async () => {
  const result = await request();
  assert.equal(result.status, 401);
});

test("trả 400 khi thiếu tệp âm thanh", async () => {
  const result = await request({ userId: randomUUID(), audio: false });
  assert.equal(result.status, 400);
  assert.equal(result.body.success, false);
});

test("trả 400 khi định dạng âm thanh không được hỗ trợ", async () => {
  const result = await request({
    userId: randomUUID(),
    mimeType: "video/webm",
  });
  assert.equal(result.status, 400);
});

test("trả 413 khi tệp vượt quá 5MB", async () => {
  const result = await request({
    userId: randomUUID(),
    size: 5 * 1024 * 1024 + 1,
  });
  assert.equal(result.status, 413);
});

test("trả văn bản đã trim và truyền model, ngôn ngữ vào AI SDK", async () => {
  transcriptionError = null;
  transcriptionResult = { text: "  xin chào  " };
  const result = await request({
    userId: randomUUID(),
    language: "vi",
    mimeType: "audio/webm;codecs=opus",
  });

  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data, { text: "xin chào" });
  assert.equal(
    transcriptionCalls.at(-1).model.modelId,
    "openai/test-transcription-model",
  );
  assert.deepEqual(transcriptionCalls.at(-1).providerOptions, {
    openai: { language: "vi" },
  });
});

test("trả văn bản rỗng khi bản ghi không có lời", async () => {
  transcriptionResult = { text: "" };
  const result = await request({ userId: randomUUID() });
  assert.deepEqual(result.body.data, { text: "" });
  assert.deepEqual(transcriptionCalls.at(-1).providerOptions, {
    openai: { language: "vi" },
  });

  transcriptionError = Object.assign(new Error("no transcript"), {
    name: "AI_NoTranscriptGeneratedError",
  });
  const noTranscriptResult = await request({ userId: randomUUID() });
  assert.deepEqual(noTranscriptResult.body.data, { text: "" });
  transcriptionError = null;
  transcriptionResult = { text: "  xin chào  " };
});

test("trả 503 khi AI Gateway lỗi", async () => {
  transcriptionError = new Error("gateway unavailable");
  const result = await request({ userId: randomUUID() });
  assert.equal(result.status, 503);
  transcriptionError = null;
});

test("giới hạn 10 yêu cầu mỗi phút trên từng người dùng", async () => {
  const userId = randomUUID();
  for (let count = 0; count < 10; count += 1) {
    assert.equal((await request({ userId })).status, 200);
  }
  assert.equal((await request({ userId })).status, 429);
});

test("trim và cắt văn bản không quá 2000 ký tự", async () => {
  transcriptionResult = { text: `  ${"a".repeat(2200)}  ` };
  const result = await request({ userId: randomUUID() });
  assert.equal(result.body.data.text.length, 2000);
  transcriptionResult = { text: "  xin chào  " };
});
