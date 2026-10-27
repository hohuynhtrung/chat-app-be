const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("node:crypto");
const util = require("node:util");
const childProcess = require("node:child_process");

const execAsync = util.promisify(childProcess.exec);

const CLOUDFLARE_IMAGE_MODEL = "@cf/black-forest-labs/flux-1-schnell";
const CLOUDFLARE_IMAGE_API_URL =
  "https://api.cloudflare.com/client/v4/accounts";
const GENERATED_IMAGES_DIR = path.join(__dirname, "../../generated-images");
const EXEC_TIMEOUT_MS = 30_000; // prompt hứa "mỗi lệnh xong trong ~30s" thì code phải đảm bảo điều đó
const MAX_OUTPUT_CHARS = 20_000; // tránh một lần đọc file/chạy lệnh làm tràn ngữ cảnh của AI
const SEARCH_TIMEOUT_MS = 15_000;
const MAX_SEARCH_RESULTS = 5;
const MAX_SEARCH_CONTENT_CHARS = 2_000;
const MAX_IMAGE_SIZE_BYTES = 20 * 1024 * 1024;
const CLOUDFLARE_IMAGE_TIMEOUT_MS = 60_000;

const truncate = (text = "", maxLength = MAX_OUTPUT_CHARS) =>
  text.length > maxLength
    ? `${text.slice(0, maxLength)}\n...(đã cắt bớt)`
    : text;

const agentTools = {
  async readFile({ path: filePath }) {
    try {
      const content = await fs.readFile(filePath, "utf8");
      return { success: true, content: truncate(content) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  async writeFile({ path: filePath, content }) {
    try {
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(filePath, content, "utf8");
      return { success: true, content: `File written: ${filePath}` };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  async exec({ command }) {
    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout: EXEC_TIMEOUT_MS,
        windowsHide: true,
      });
      return {
        success: true,
        stdout: truncate(stdout),
        stderr: truncate(stderr),
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  async search_web({ query }) {
    if (typeof query !== "string" || !query.trim()) {
      return { success: false, error: "Từ khóa tìm kiếm không được để trống." };
    }

    if (query.trim().length > 500) {
      return {
        success: false,
        error: "Từ khóa tìm kiếm không được vượt quá 500 ký tự.",
      };
    }

    const apiKey = process.env.BRAVE_SEARCH_API_KEY;

    if (!apiKey) {
      return {
        success: false,
        error: "Chưa cấu hình BRAVE_SEARCH_API_KEY để sử dụng tìm kiếm web.",
      };
    }

    const searchUrl = new URL(process.env.BRAVE_SEARCH_BASE_URL);
    searchUrl.searchParams.set("q", query.trim());
    searchUrl.searchParams.set("count", String(MAX_SEARCH_RESULTS));

    const response = await fetch(searchUrl, {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": apiKey,
      },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Brave Search API trả về HTTP ${response.status}.`);
    }

    const data = await response.json();
    const results = data.web?.results;

    if (
      !Array.isArray(results) ||
      results.some(
        (result) =>
          !result ||
          typeof result.title !== "string" ||
          typeof result.url !== "string" ||
          typeof result.description !== "string",
      )
    ) {
      throw new Error("Brave Search API trả về dữ liệu không hợp lệ.");
    }

    return {
      success: true,
      query: query.trim(),
      results: results.slice(0, MAX_SEARCH_RESULTS).map((result) => ({
        title: truncate(result.title, 500),
        url: result.url,
        content: truncate(result.description, MAX_SEARCH_CONTENT_CHARS),
        publishedDate: result.page_age || null,
      })),
    };
  },

  async generate_image({ prompt }) {
    if (typeof prompt !== "string" || !prompt.trim()) {
      return {
        success: false,
        error: "Mô tả hình ảnh không được để trống.",
      };
    }

    const normalizedPrompt = prompt.trim();

    if (normalizedPrompt.length > 2_048) {
      return {
        success: false,
        error: "Mô tả hình ảnh không được vượt quá 2048 ký tự.",
      };
    }

    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
    const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim();

    if (!accountId || !apiToken) {
      throw new Error(
        "Chưa cấu hình CLOUDFLARE_ACCOUNT_ID và CLOUDFLARE_API_TOKEN trong file .env.",
      );
    }

    const endpoint = `${CLOUDFLARE_IMAGE_API_URL}/${encodeURIComponent(accountId)}/ai/run/${CLOUDFLARE_IMAGE_MODEL}`;
    let response;

    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ prompt: normalizedPrompt }),
        signal: AbortSignal.timeout(CLOUDFLARE_IMAGE_TIMEOUT_MS),
      });
    } catch (error) {
      console.error("Cloudflare Workers AI image request failed:", {
        name: error.name,
        message: error.message,
      });
      throw new Error(
        error.name === "TimeoutError"
          ? "Cloudflare Workers AI quá thời gian tạo ảnh. Vui lòng thử lại."
          : `Không thể kết nối Cloudflare Workers AI: ${error.message}`,
      );
    }

    let result;

    try {
      result = await response.json();
    } catch (error) {
      console.error("Cloudflare Workers AI returned invalid JSON:", {
        status: response.status,
        message: error.message,
      });
      throw new Error(
        `Cloudflare Workers AI trả về dữ liệu không hợp lệ (HTTP ${response.status}).`,
      );
    }

    if (!response.ok || result?.success !== true) {
      const apiErrors = Array.isArray(result?.errors)
        ? result.errors
            .map((item) => item?.message)
            .filter((message) => typeof message === "string" && message.trim())
        : [];
      const detail = apiErrors.slice(0, 3).join("; ");

      console.error("Cloudflare Workers AI image request was rejected:", {
        status: response.status,
        errors: apiErrors,
      });

      throw new Error(
        `Cloudflare Workers AI từ chối tạo ảnh (HTTP ${response.status})${
          detail ? `: ${detail}` : "."
        }`,
      );
    }

    const imageBase64 = result?.result?.image;
    const maxBase64Length = Math.ceil((MAX_IMAGE_SIZE_BYTES * 4) / 3);

    if (
      typeof imageBase64 !== "string" ||
      imageBase64.length === 0 ||
      imageBase64.length > maxBase64Length ||
      imageBase64.length % 4 !== 0 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        imageBase64,
      )
    ) {
      throw new Error(
        "Cloudflare Workers AI không trả về dữ liệu ảnh base64 hợp lệ.",
      );
    }

    const image = Buffer.from(imageBase64, "base64");

    if (
      image.length === 0 ||
      image.length > MAX_IMAGE_SIZE_BYTES ||
      image[0] !== 0xff ||
      image[1] !== 0xd8 ||
      image[2] !== 0xff
    ) {
      throw new Error(
        "Cloudflare Workers AI không trả về ảnh JPEG hợp lệ hoặc ảnh vượt quá dung lượng cho phép.",
      );
    }

    const fileName = `${randomUUID()}.jpg`;
    await fs.mkdir(GENERATED_IMAGES_DIR, { recursive: true });
    await fs.writeFile(path.join(GENERATED_IMAGES_DIR, fileName), image, {
      flag: "wx",
    });

    const url = `generated-images/${fileName}`;

    return {
      success: true,
      url,
      markdown: `![Ảnh được tạo](${url})`,
    };
  },
};

module.exports = agentTools;
