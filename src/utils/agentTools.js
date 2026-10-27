const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("node:crypto");
const util = require("node:util");
const childProcess = require("node:child_process");

const execAsync = util.promisify(childProcess.exec);

const PROJECT_ROOT = path.resolve(__dirname, "../..");
const SYSTEM_PATHS =
  process.platform === "win32"
    ? [
        process.env.SystemRoot || String.raw`C:\Windows`,
        process.env.ProgramFiles || String.raw`C:\Program Files`,
        process.env["ProgramFiles(x86)"] || String.raw`C:\Program Files (x86)`,
        process.env.ProgramData || String.raw`C:\ProgramData`,
      ]
    : ["/etc", "/usr", "/bin", "/sbin", "/proc", "/sys", "/dev"];
const DANGEROUS_COMMAND_PATTERNS = [
  /\b(?:sudo|su|doas)\b/i,
  /\b(?:rm|rmdir|rd|del|erase|remove-item|ri)\b/i,
  /\b(?:format|shutdown|stop-computer|restart-computer|reboot|poweroff|halt)\b/i,
  /\b(?:diskpart|mkfs(?:\.[\w-]+)?|wipefs|shred|sdelete|diskutil|mountvol|bcdedit|takeown|icacls)\b/i,
  /\bdd\b(?=\s+[^;&|]*\bof\s*=)/i,
  /\bfind\b(?=\s+[^;&|]*\s-delete(?:\s|$))/i,
  /\bgit\s+clean\b/i,
  /\bgit\s+reset\s+[^;&|]*--hard\b/i,
  /\b(?:clear-content|set-content|out-file)\b/i,
  /\breg\s+delete\b/i,
  /\bsc\s+delete\b/i,
  /\brobocopy\b(?=\s+[^;&|]*\/mir\b)/i,
];
const CLOUDFLARE_IMAGE_MODEL = "@cf/black-forest-labs/flux-1-schnell";
const CLOUDFLARE_IMAGE_API_URL =
  "https://api.cloudflare.com/client/v4/accounts";
const GENERATED_IMAGES_DIR = path.join(__dirname, "../../generated-images");
const EXEC_TIMEOUT_MS = 30_000; // prompt hứa "mỗi lệnh xong trong ~30s" thì code phải đảm bảo điều đó
const MAX_OUTPUT_CHARS = 20_000; // tránh một lần đọc file/chạy lệnh làm tràn ngữ cảnh của AI
const SEARCH_TIMEOUT_MS = 15_000;
const MAX_SEARCH_RESULTS = 5;
const MAX_SEARCH_CONTENT_CHARS = 2_000;
const MAX_WRITE_FILE_BYTES = 1 * 1024 * 1024;
const MAX_IMAGE_SIZE_BYTES = 20 * 1024 * 1024;
const CLOUDFLARE_IMAGE_TIMEOUT_MS = 60_000;

const truncate = (text = "", maxLength = MAX_OUTPUT_CHARS) =>
  text.length > maxLength
    ? `${text.slice(0, maxLength)}\n...(đã cắt bớt)`
    : text;

const getAllowedRoots = () => {
  const configuredRoots = (process.env.AGENT_ALLOWED_PATHS || "")
    .split(path.delimiter)
    .map((root) => root.trim())
    .filter(Boolean)
    .map((root) => path.resolve(PROJECT_ROOT, root));

  return [PROJECT_ROOT, ...configuredRoots];
};

const isWithinDirectory = (target, directory) => {
  const relativePath = path.relative(directory, target);
  return (
    relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
};

const isSystemPath = (target) => {
  const normalizedTarget = path.resolve(target);

  return SYSTEM_PATHS.some((systemPath) => {
    const normalizedSystemPath = path.resolve(systemPath);
    return (
      normalizedTarget.toLowerCase() === normalizedSystemPath.toLowerCase() ||
      isWithinDirectory(normalizedTarget, normalizedSystemPath)
    );
  });
};

const assertAllowedPath = (target) => {
  const normalizedTarget = path.resolve(target);
  const allowed = getAllowedRoots().some((root) =>
    isWithinDirectory(normalizedTarget, root),
  );

  if (isSystemPath(normalizedTarget) || !allowed) {
    throw new Error(
      "Truy cập bị từ chối: chỉ được đọc/ghi trong thư mục dự án hoặc các thư mục được cấu hình.",
    );
  }
};

const resolveAllowedReadPath = async (filePath) => {
  if (typeof filePath !== "string" || !filePath.trim()) {
    throw new Error("Đường dẫn file không hợp lệ.");
  }

  const target = path.resolve(PROJECT_ROOT, filePath);
  assertAllowedPath(target);

  const realTarget = await fs.realpath(target);
  assertAllowedPath(realTarget);
  return realTarget;
};

const resolveAllowedWritePath = async (filePath) => {
  if (typeof filePath !== "string" || !filePath.trim()) {
    throw new Error("Đường dẫn file không hợp lệ.");
  }

  const target = path.resolve(PROJECT_ROOT, filePath);
  const parentDirectory = path.dirname(target);
  assertAllowedPath(target);
  assertAllowedPath(parentDirectory);

  let existingParent = parentDirectory;
  while (true) {
    try {
      const realParent = await fs.realpath(existingParent);
      assertAllowedPath(realParent);
      break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;

      const nextParent = path.dirname(existingParent);
      if (nextParent === existingParent) throw error;
      existingParent = nextParent;
    }
  }

  try {
    const realTarget = await fs.realpath(target);
    assertAllowedPath(realTarget);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  await fs.mkdir(parentDirectory, { recursive: true });

  const realParentDirectory = await fs.realpath(parentDirectory);
  assertAllowedPath(realParentDirectory);

  const realTarget = path.join(realParentDirectory, path.basename(target));
  assertAllowedPath(realTarget);
  return realTarget;
};

const getDangerousCommand = (command) =>
  DANGEROUS_COMMAND_PATTERNS.some((pattern) => pattern.test(command));

const logFileOperation = (operation, filePath, details = {}) => {
  const entry = {
    event: "agent_file_operation",
    operation,
    path: typeof filePath === "string" ? filePath.slice(0, 1_000) : null,
    ...details,
    timestamp: new Date().toISOString(),
  };
  const log = entry.success ? console.info : console.warn;
  log.call(console, JSON.stringify(entry));
};

const agentTools = {
  async readFile({ path: filePath }) {
    try {
      const safePath = await resolveAllowedReadPath(filePath);
      const content = await fs.readFile(safePath, "utf8");
      logFileOperation("read", safePath, {
        success: true,
        sizeBytes: Buffer.byteLength(content, "utf8"),
      });
      return { success: true, content: truncate(content) };
    } catch (error) {
      logFileOperation("read", filePath, {
        success: false,
        error: error.message,
      });
      return { success: false, error: error.message };
    }
  },

  async writeFile({ path: filePath, content }) {
    try {
      if (typeof content !== "string") {
        throw new Error("Nội dung file phải là chuỗi.");
      }

      const sizeBytes = Buffer.byteLength(content, "utf8");

      if (sizeBytes > MAX_WRITE_FILE_BYTES) {
        throw new Error(
          `Nội dung file vượt quá giới hạn ${MAX_WRITE_FILE_BYTES} byte.`,
        );
      }

      const safePath = await resolveAllowedWritePath(filePath);
      await fs.writeFile(safePath, content, "utf8");
      logFileOperation("write", safePath, {
        success: true,
        sizeBytes,
      });
      return { success: true, content: `File written: ${safePath}` };
    } catch (error) {
      logFileOperation("write", filePath, {
        success: false,
        error: error.message,
      });
      return { success: false, error: error.message };
    }
  },

  async exec({ command }) {
    if (typeof command !== "string" || !command.trim()) {
      return { success: false, error: "Lệnh shell không hợp lệ." };
    }

    const normalizedCommand = command.replace(/\s+/g, " ").trim();

    if (getDangerousCommand(normalizedCommand)) {
      return {
        success: false,
        error:
          "Cảnh báo an toàn: lệnh bị từ chối vì chứa lệnh hoặc thao tác nguy hiểm nằm trong blacklist.",
      };
    }

    const referencesSystemPath =
      /(?:[a-z]:[\\/](?:windows|program files(?: \(x86\))?|programdata)(?:[\\/]|$))/i.test(
        normalizedCommand,
      ) ||
      /(?:^|[\s"'`])\/(?:etc|usr|bin|sbin|proc|sys|dev)(?:\/|\b)/i.test(
        normalizedCommand,
      );

    if (referencesSystemPath) {
      return {
        success: false,
        error:
          "Cảnh báo an toàn: lệnh bị từ chối vì tham chiếu tới thư mục hệ thống.",
      };
    }

    try {
      const { stdout, stderr } = await execAsync(normalizedCommand, {
        timeout: EXEC_TIMEOUT_MS,
        windowsHide: true,
        cwd: PROJECT_ROOT,
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
