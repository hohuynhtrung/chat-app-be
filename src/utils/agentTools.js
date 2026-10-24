const fs = require("fs/promises");
const path = require("path");
const util = require("node:util");
const childProcess = require("node:child_process");

const execAsync = util.promisify(childProcess.exec);

const EXEC_TIMEOUT_MS = 30_000; // prompt hứa "mỗi lệnh xong trong ~30s" thì code phải đảm bảo điều đó
const MAX_OUTPUT_CHARS = 20_000; // tránh một lần đọc file/chạy lệnh làm tràn ngữ cảnh của AI

const truncate = (text = "") =>
  text.length > MAX_OUTPUT_CHARS
    ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n...(đã cắt bớt)`
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
};

module.exports = agentTools;
