const fs = require("fs/promises");
const path = require("path");
const util = require("node:util");
const childProcess = require("node:child_process");

const execAsync = util.promisify(childProcess.exec);

const EXEC_TIMEOUT_MS = 30_000; // prompt hứa "mỗi lệnh xong trong ~30s" thì code phải đảm bảo điều đó
const MAX_OUTPUT_CHARS = 20_000; // tránh một lần đọc file/chạy lệnh làm tràn ngữ cảnh của AI
const SEARCH_TIMEOUT_MS = 15_000;
const MAX_SEARCH_RESULTS = 5;
const MAX_SEARCH_CONTENT_CHARS = 2_000;

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
};

module.exports = agentTools;
